# 動画編集ワークフロー — 撮影素材から完成動画まで

撮影した複数テイクの動画素材を、Claude が解析・選定・結合して1本に仕上げるワークフロー。
Anthropic の動画（Claude 自身が編集したもの）で話者本人が解説した手法を、このリポジトリで再現できる形に整理した。

スクリプト一式は [`tools/video-editing/`](../../tools/video-editing/) にある。
初回は `bash tools/video-editing/setup.sh` で前提（ffmpeg / uv）を確認すること。

## 全体像

```
撮影素材（複数シーン × 複数テイク）
  │ ① transcribe.py — Whisper で全テイクを単語単位で文字起こし
  ▼
transcripts/*.json
  │ ② Claude — 文字起こしを読み、シーン分類・ベストテイク選定
  ▼
edit-plan.json（シーン・候補・採用理由・in/out・カラーフィルタ）
  │ ③ assemble.py — FFmpeg で切り出し・結合（＋カラーグレーディング）
  ▼
roughcut.mp4
  │ ④ Remotion — 文字起こし JSON に同期した UI オーバーレイ（オプション）
  │ ⑤ Figma MCP — デザインチームの更新を動画 UI に反映（オプション）
  ▼
完成動画
```

## フェーズ1: 解析 — 素材を渡して文字起こし

素材フォルダ（整理不要。どのテイクがどのシーンかは伝えなくてよい）を用意し、Claude にこう指示する:

> 大量の動画録画を処理しています。`~/footage` にあります。これらに文字起こしを実行し、ベストショットをつなぎ合わせて、1本の最終クリップにしてください。

Claude 側の最初の一手:

```bash
uv run tools/video-editing/transcribe.py ~/footage --out transcripts --language ja
```

- モデルは `--model small` がデフォルト。精度が欲しければ `medium` / `large-v3`（その分遅い）
- 出力 JSON には `segments`（文単位）と `words`（単語単位タイムスタンプ）の両方が入る。`words` は後段の Remotion 同期にそのまま使う

## フェーズ2: 選定 — シーン分類とベストテイク選び

人間はシーンの対応もテイクの良し悪しも事前に教えない。Claude が `transcripts/*.json` を読んで判断する:

1. **シーン分類** — 発話内容が似ている・重複しているテイクを同じシーンとしてグルーピングする
2. **ベストテイク選定** — 各シーンの候補を比較する。「あー」等の言い淀みの少なさは目安だが、それだけで決めない（テンポ、言い直しの有無、台本への忠実さも見る）
3. **編集プランの作成** — 判断結果を `edit-plan.json` に書く。タイムラインではなく構造化データが編集の記録になる

書式は [`tools/video-editing/edit-plan.example.json`](../../tools/video-editing/edit-plan.example.json) を参照。各シーンに **候補テイク・採用テイク・採用理由・開始/終了時刻** を必ず残す（理由を残すことで人間が後からプランだけ見て差し替え判断できる）。

シーンの途中を細かく刻む編集も、scenes に同一素材のエントリを複数並べれば可能。

## フェーズ3: 結合 — ラフカットとカラーグレーディング

```bash
python3 tools/video-editing/assemble.py edit-plan.json
```

- デフォルトは再エンコードでカット点が正確。`--copy` は高速だがキーフレーム単位でずれる
- **カラーグレーディング**はプランの `filter` に FFmpeg フィルタとして書く（全体と各シーンの両方に指定可、シーン側が優先）。専門知識がなくても、Claude に複数の設定を書かせて見比べればよい。出発点の例:
  - くすみ解消・ニュートラル寄せ: `eq=contrast=1.05:saturation=1.1:brightness=0.02`
  - もう少し攻める: `curves=preset=increase_contrast,eq=saturation=1.15`
  - 数パターンを短い区間（`in`/`out` を10秒程度に絞る）で出力して比較するのが速い

## フェーズ4: 演出 — Remotion で UI オーバーレイ（オプション）

[Remotion](https://www.remotion.dev/) は React コンポーネントを動画として書き出すライブラリ。表示・切り替え・フェードをすべてコードで制御できる。

```bash
npx create-video@latest   # テンプレートは Blank か Hello World
```

ポイントは **文字起こし JSON 駆動の同期**。手動でタイムラインに置くのではなく、`words` のタイムスタンプから表示タイミングを計算する:

```tsx
// transcripts/<採用テイク>.json の words を import し、
// 「特定の言葉を言った瞬間」に UI を切り替える
const trigger = words.find((w) => w.word.includes("正しい作業"));
const visible = frame >= Math.round(trigger.start * fps);
```

注意: ラフカットは元素材から切り出されているため、Remotion 側で使うタイムスタンプは **シーンの `in` を引いたオフセット後の値**にする（このオフセット計算も Claude にやらせればよい）。

デザインアセット（説明用 UI・グラフィック）は、台本を先に Claude に渡して作らせる。

## フェーズ5: デザイン連携 — Figma との往復（オプション）

1. Claude が作った初稿デザインを Figma に書き出し、デザインチームが Figma 上で洗練させる
2. 更新後、Claude に「Figma 上のデザインが更新されました。動画もそれに合わせて更新できますか？」と指示する
3. Claude が Figma MCP で更新後のデザインを読み取り、Remotion の React コンポーネントに反映する

Figma MCP（公式 Dev Mode MCP サーバー）は `.mcp.json` に追加する。Figma デスクトップアプリの設定で MCP サーバーを有効化した上で:

```json
{
  "mcpServers": {
    "figma": { "type": "http", "url": "http://127.0.0.1:3845/mcp" }
  }
}
```

## 試すときのチェックリスト

- [ ] `bash tools/video-editing/setup.sh` が「準備完了」を出す
- [ ] 素材フォルダを用意（参考: 元の事例は 4シーン × 計17テイク、約25GB。少量でも流れは試せる）
- [ ] ディスク残量を確認（再エンコードの中間ファイルで素材と同程度の空きが要る）
- [ ] Whisper モデルの初回ダウンロードがあるためネットワーク必須（small で約500MB）
- [ ] Remotion / Figma 連携まで試すなら Node.js と Figma MCP の設定
