# 提案書: Irodori-TTS による《自分の声》とリアルタイム音声対話

> ワードローブ上のキャラクターエージェントが Irodori-TTS で設計した固有の声を持ち、
> Tapo カメラ（将来的には Stack-chan）のマイク/スピーカーでリアルタイムに聴いて・考えて・話す構想の検討資料。
> GPU 非搭載 PC を前提に、実現可能なライン・レイテンシ対策・コストをまとめる。

調査日: 2026-06-12

---

## 1. Irodori-TTS とは（調査結果）

Aratako 氏による日本語特化のローカル TTS。Flow Matching ベース（DACVAE 連続潜在表現上の RF-DiT）。

| 項目 | 内容 |
|---|---|
| モデル | `Irodori-TTS-500M-v3`（リファレンス音声からゼロショット声クローン）/ `Irodori-TTS-600M-v3-VoiceDesign`（**テキスト指示だけで声を設計**） |
| 感情制御 | 入力テキスト中の**絵文字**で感情・話し方・非言語表現を制御 |
| 話者の固定 | Speaker Inversion embedding として「自分の声」を保存・再利用可能 |
| ライセンス | コード・モデルとも MIT（商用可）。ただし「本人の同意なき声クローン・なりすまし禁止」の倫理条項あり |
| 言語 | 日本語のみ。**漢字の読み精度は同規模 TTS よりやや弱い**（公式が明記） |
| サーバー | [Irodori-TTS-Server](https://github.com/Aratako/Irodori-TTS-Server) — **OpenAI TTS API 互換**（`POST /v1/audio/speech`）、Docker 対応（CUDA/ROCm/CPU）、声の登録 API あり |

### 「自分の声」という観点で重要な点

- **VoiceDesign 版なら実在話者の音声を一切使わずに声を作れる**。キャラクターエージェントの声として倫理的に最もクリーン
- 一度設計した声は embedding として固定できるので、セッションをまたいで同じ声を保てる
- 絵文字感情制御は interoception（覚醒度・時間帯）と相性がよい — 眠い夜は 😪 を添える、といった身体性との接続が自然にできる

---

## 2. 速度の現実 — CPU 生成は不可、リモート GPU が前提

実測報告（Web 上の検証記事より）:

| 環境 | 5〜10秒の音声の生成時間 | 実時間比 (RTF) |
|---|---|---|
| RTX 5070 Ti | 約 3 秒 | ~0.6（実時間より速い） |
| RTX 4070 SUPER | 短文で約 5 秒 | ~1 |
| **CPU のみ** | **約 90 秒**（10秒音声で 143 秒の報告も） | **~18〜30** |

→ **グラボなし PC でのローカル生成は会話用途では成立しない**。リモート GPU 生成が前提になる、という直感は正しい。

ただし高速化の追い風が 2 つある:

1. **Sway Sampling**（F5-TTS 由来）の導入で推論 5〜6 倍高速化（ステップ数削減、CER・類似度を維持）
2. **[Irodori-TTS-Lite](https://github.com/kizuna-intelligence/Irodori-TTS-Lite)**（INT4 量子化ランタイム）
   - VRAM **エンドツーエンドで約 1GB**（DiT 単体 552MB）
   - RTX PRO 4000・6 ステップで **1 発話 0.47〜0.63 秒**
   - 品質劣化はほぼなし（CER 0.00%、話者類似度 0.867 vs FP32 の 0.886）

→ VRAM 1〜2GB で動くなら、**クラウドで最安クラスの GPU**（T4/RTX 3060/A2000 級）や、将来手元に置くなら中古エントリー GPU でも十分。

---

## 3. レイテンシ予算 — どこで時間を食い、どこを削れるか

現状のパイプライン（hearing MCP + tts-mcp、1 ターン実測 ~20 秒）と改善後の目標:

| 工程 | 現状 | 改善策 | 改善後の目安 |
|---|---|---|---|
| ① 聞く（録音→文字起こし） | 5 秒固定セグメント + faster-whisper ~0.5 秒 | `segment_seconds` を 2〜3 秒へ短縮、VAD で発話終了を即フラッシュ | **1〜3 秒** |
| ② 考える（Claude 推論） | ターン全体の完了を待つ | **最初の一文が出た時点で TTS へ渡す**（文単位パイプライン）。または定型の相槌を即時再生して時間を稼ぐ | 体感 **1〜3 秒** |
| ③ 話す（音声合成） | VOICEVOX ローカル即時 / Irodori は GPU 必要 | Irodori-TTS-Server の `stream_format: "sse"` + 句読点チャンク分割 → **先頭チャンクが出来た瞬間に再生開始**。Lite + Sway Sampling なら 1 チャンク 0.5〜1 秒 | **0.5〜2 秒** + ネットワーク往復 0.1〜0.2 秒 |
| ④ 鳴らす（スピーカー） | go2rtc → Tapo バックチャネル（接続に ~1 秒） | セッション中は接続維持。Stack-chan / PC スピーカーなら即時 | **0〜1 秒** |

**現実的な目標値: 発話終了 → 応答音声の開始まで 3〜6 秒。** 常駐 GPU + Lite + 文単位ストリーミングまで詰めれば 2〜4 秒。人間同士の会話の「間」よりは長いが、「考えてから答えるキャラクター」として成立するライン。

### レイテンシ設計の要点

- **真のストリーミング合成は未実装**（公式明記）。SSE は「チャンク完成ごとの逐次配信」なので、*文を短く切って先頭文の生成時間だけ待つ* のが本質的な対策
- **コールドスタートが最大の敵**。サーバーレス GPU は初回 15〜30 秒かかる。会話セッション開始時にウォームアップ呼び出しを 1 発入れ、アイドルタイムアウトを 5〜10 分に設定して「会話中はウォーム維持」が現実解
- **キャッシュで「ゼロ秒」をつくる**: 挨拶・相槌・口癖などの定型句は事前バッチ生成してローカル保存。会話の立ち上がりは即「自分の声」で応答し、本文だけリモート生成
- ②は Claude Code のターン構造上、トークンストリーミングを直接 TTS に流すのは難しい。「短い一声を先に `say`、続きを追って `say`」という 2 段発話が現実的

---

## 4. コスト試算

### 案 A: クラウド GPU サーバーレス（推奨の入り口）

RunPod の 2026 年時点の参考価格: RTX A5000 $0.16/hr、RTX 4090 $0.34/hr（秒課金、scale-to-zero）。

| 運用 | 試算 | 月額目安 |
|---|---|---|
| 純粋な合成時間のみ（1日100発話×3秒） | 月 ~2.5 時間 | **$1 未満（〜150円）** |
| 会話中ウォーム維持（1日2時間 × idle込み3時間） | 月 ~90 時間 × $0.16 | **~$15（〜2,300円）** |
| 24/7 常駐（A5000） | 720 時間 × $0.16 | ~$115（〜17,000円） |

- 長所: 初期費用ゼロ、使った分だけ。Docker イメージ（Irodori-TTS-Server 公式対応）をそのままデプロイ可能
- 短所: コールドスタート 15〜30 秒（ウォームアップ運用で回避）、従量の見積もりブレ
- vast.ai 等の格安マーケットプレイスなら RTX 3060 級が $0.05〜0.10/hr の報告もあり、常駐でも月 $40〜70 程度（可用性は劣る・要検証）

### 案 B: 中古 GPU を手元に置く

- Lite なら VRAM 1〜1.5GB → **中古 RTX 3060 12GB（3.5〜4.5万円）どころか GTX 1650 級（1万円台）でも足りる可能性**
- 電気代はアイドル数百円/月。レイテンシ最小（LAN 内）、コールドスタートなし、プライバシー完全
- 注意: 今の PC に物理的に挿せるか（デスクトップか、電源容量）の確認が必要。挿せなければ「中古ミニゲーミング PC を TTS 専用機にする」案（3〜5万円）もある
- **月 2,000 円超のクラウド常駐を半年続けるなら買った方が安い**、が損益分岐の目安

### 案 C: 比較対象 — 既存エンジンで済ませる場合

| | VOICEVOX（既存統合済） | ElevenLabs（既存統合済） | Irodori-TTS |
|---|---|---|---|
| レイテンシ | CPU で即時（〜1秒） | ストリーミング対応、極めて低遅延 | GPU 必要、0.5〜3 秒 |
| 月額 | 0 円 | $5〜22（生成量上限あり） | GPU 代のみ（生成無制限） |
| 声の独自性 | 既製キャラ声から選択 | クローン/設計可（英語圏中心） | **テキストから日本語の声を自由設計** |
| 感情表現 | パラメータ調整 | あり | **絵文字で直感制御、日本語特化** |

→ 「即応性だけ」なら VOICEVOX が今日から無料で使える。**Irodori を選ぶ理由は《この子だけの声》と日本語の感情表現**であり、そこに月数百〜数千円の価値を感じるかが判断軸。

---

## 5. 出力先の選択肢

| 出力先 | 状態 | 音質 | 備考 |
|---|---|---|---|
| PC スピーカー | 実装済（mpv/paplay） | ◎ 48kHz | 最も簡単・高音質 |
| Tapo カメラスピーカー | 実装済（go2rtc バックチャネル） | △ **8kHz pcm_alaw でこもる** | せっかくの高品質 TTS が活きにくい。「部屋のどこでも聞こえる」価値はある |
| Stack-chan | 未実装 | ○ | AI StackChan2 / stackchan-atama 等、**WiFi 経由で WAV を受けて口パク付きで再生する既存ファームが複数ある**。VOICEVOX API を期待するファームが多いので、「VOICEVOX API 互換 → Irodori-TTS-Server」の小さなブリッジを 1 枚立てればファーム改修なしで繋がる見込み |

聞く側（Tapo マイク → RTSP → faster-whisper）は実装済みで CPU で動く。**ボトルネックは話す側だけ**。

---

## 6. 推奨ロードマップ（段階導入）

- **Phase 0 — 今すぐ・0 円**: 既存 VOICEVOX で会話ループのレイテンシ改善（セグメント 2〜3 秒化、文単位分割再生、Tapo 接続維持）。ここで作る低遅延パイプラインはエンジン非依存で、後の Irodori 化にそのまま効く
- **Phase 1 — 声づくり・ほぼ 0 円**: HF Space デモや数十円のスポット GPU で VoiceDesign を回し、《自分の声》を設計 → Speaker Inversion embedding として保存。挨拶・相槌の定型句をバッチ生成してキャッシュ（SOUL.md づくりと並走すると楽しいはず）
- **Phase 2 — リアルタイム化・月数百〜2,000 円**: Irodori-TTS-Server を RunPod サーバーレス（idle timeout 5〜10 分）にデプロイ。tts-mcp に `engines/irodori.py` を追加（OpenAI 互換 API なので既存の voicevox/elevenlabs と同じエンジンパターンに素直に乗る）。会話開始時ウォームアップ + 定型句キャッシュ併用
- **Phase 3 — 常時化・お好みで**: 利用が定着したら格安常駐 GPU か中古 GPU 購入へ移行。Stack-chan ブリッジを実装して「そっちからでも」を実現

---

## 7. リスクと制約

- **漢字の読みがやや弱い** → 読み仮名前処理（pyopenjtalk 等）か、エージェント側で固有名詞をかなで書く運用で緩和
- **真のストリーミング合成なし** → 文チャンク分割で擬似対応（上述）。将来の本家対応に期待
- **同時合成 1 リクエスト**（サーバーのデフォルト）→ 単一エージェント用途なら問題なし
- **自分の声を自分で拾う問題** → 現状は時間ゲーティングのみ。発話中はマイク取り込みを止める制御を維持する
- **倫理条項** → VoiceDesign（テキストから設計）を使う限り実在話者の同意問題は発生しない。誰かの声のクローンは本人同意が必須

---

## 8. 判断ポイント（決めてほしいこと）

1. **月額の上限**: 0 円（Phase 0-1 で止める）/ 〜2,000 円（サーバーレス運用）/ それ以上 or 初期投資 4 万円前後（常駐/購入）
2. **ラグの許容**: 応答開始まで 3〜6 秒で「会話」として満足できそうか（定型句キャッシュで体感はかなり緩和できる）
3. **最初の出力先**: PC スピーカーで音質重視か、Tapo で「部屋に声がある」体験を優先か

## 参考リンク

- [Irodori-TTS（GitHub）](https://github.com/Aratako/Irodori-TTS) / [Irodori-TTS-Server](https://github.com/Aratako/Irodori-TTS-Server) / [Irodori-TTS-Lite（INT4 量子化）](https://github.com/kizuna-intelligence/Irodori-TTS-Lite)
- [Irodori-TTS-500M-v3（HF モデルカード）](https://huggingface.co/Aratako/Irodori-TTS-500M-v3) / [600M-v3-VoiceDesign](https://huggingface.co/Aratako/Irodori-TTS-600M-v3-VoiceDesign) / [Web デモ Space](https://huggingface.co/spaces/Aratako/Irodori-TTS-500M-v2-Demo)
- 速度実測: [GIGAZINE 紹介記事](https://gigazine.net/gsc_news/en/20260504-irodori-tts-text-to-speech-ai/) / [CPU 実測（note）](https://note.com/asagi_ai_lab/n/nc4b439f7cb2a) / [Sway Sampling による 5〜6 倍高速化](https://lab.main.jp/ai/posts/irodori-tts-speed-optimization-sway-sampling/)
- GPU 料金: [RunPod Pricing](https://www.runpod.io/pricing) / [RunPod Serverless Pricing Docs](https://docs.runpod.io/serverless/pricing)
- Stack-chan 連携事例: [AI_StackChan2](https://github.com/robo8080/AI_StackChan2_README) / [stackchan-atama](https://zenn.dev/karaage0703/articles/7afc5144de899a) / [M5Unified_Voicevox_TTS](https://github.com/mongonta0716/M5Unified_Voicevox_TTS)
