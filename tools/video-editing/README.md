# video-editing — 動画編集ワークフローの道具箱

撮影素材の文字起こし → ベストテイク選定 → 結合・仕上げまでを支える最小ツール群。
ふだんは `/wd-video-edit` スキル経由で使う。全体の流れは [docs/guides/video-editing-workflow.md](../../docs/guides/video-editing-workflow.md) を参照。

## ファイル

| ファイル | 役割 |
|---|---|
| `setup.sh` | 前提ツール（ffmpeg / uv / node）の確認。`--install` で導入も試みる |
| `transcribe.py` | フォルダ内の全動画を Whisper で文字起こし。単語タイムスタンプ付き JSON を出力 |
| `edit-plan.example.json` | 編集プラン JSON の書式例（候補テイク・採用理由・in/out・カード・BGM・縦横変換） |
| `make_card.py` | 区切り・タイトルカードの PNG を生成（日本語フォント自動検出） |
| `assemble.py` | 編集プラン JSON から FFmpeg で切り出し・結合。カード挿入・BGM ミックス・9:16 変換・YouTube チャプター出力に対応 |

## クイックスタート

```bash
bash setup.sh                                  # 前提確認
uv run transcribe.py ~/footage --language ja   # 1. 全テイクを文字起こし
# 2. Claude が transcripts/ を読んでシーン分類・テイク選定 → edit-plan.json を作成
uv run make_card.py "第1部" cards/01.png       # 3. 必要なら区切りカード生成
python3 assemble.py edit-plan.json --chapters chapters.txt  # 4. 結合＋チャプター出力
```

## 編集プランの主なキー

- `size` / `fit` — 出力解像度の統一。リールは `"1080x1920"`、`fit` は `crop`（切る）/ `pad`（黒帯）
- `bgm` — `{"file": "...", "volume": 0.2}` を全体にミックス。シーン側 `"mute": true` で元音声を消す
- `type: "card"` — 静止画カードをシーンとして挿入（`image` + `duration`）
- `filter` — FFmpeg フィルタによるカラーグレーディング（全体／シーン個別）
- `title` — `--chapters` 指定時に YouTube チャプター名になる
