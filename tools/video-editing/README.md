# video-editing — 動画編集ワークフローの道具箱

撮影素材の文字起こし → ベストテイク選定 → ラフカット結合までを支える最小ツール群。
全体の流れと使い方は [docs/guides/video-editing-workflow.md](../../docs/guides/video-editing-workflow.md) を参照。

## ファイル

| ファイル | 役割 |
|---|---|
| `setup.sh` | 前提ツール（ffmpeg / uv / node）の確認。`--install` で導入も試みる |
| `transcribe.py` | フォルダ内の全動画を Whisper で文字起こし。単語タイムスタンプ付き JSON を出力 |
| `edit-plan.example.json` | 編集プラン JSON の書式例（シーン・候補テイク・採用理由・in/out・カラーフィルタ） |
| `assemble.py` | 編集プラン JSON から FFmpeg で切り出し・結合してラフカットを生成 |

## クイックスタート

```bash
bash setup.sh                                  # 前提確認
uv run transcribe.py ~/footage --language ja   # 1. 全テイクを文字起こし
# 2. Claude が transcripts/ を読んでシーン分類・テイク選定 → edit-plan.json を作成
python3 assemble.py edit-plan.json             # 3. ラフカット生成
```
