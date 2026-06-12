---
name: wd-video-edit
description: "撮影素材から動画を編集する。イベント風景のまとめ、講座アーカイブのシーン割り・区切りカード挿入、リール用ダイジェストなど。文字起こし→選定→結合を Claude が行い、判断は編集プラン JSON に残す。"
argument-hint: "<素材フォルダ> [用途のメモ]"
---

# /wd-video-edit — 素材から動画を仕上げる

撮影素材（複数テイク・分割録画・風景クリップ）を解析し、選定・結合して1本の動画にする。
道具は `tools/video-editing/` にある。詳しい背景は `docs/guides/video-editing-workflow.md`。

編集ソフトのタイムラインではなく **編集プラン JSON が判断の記録**になる。
候補・採用理由・in/out を必ず残し、人間が後からプランだけ見て差し替えできるようにする。

## 手順

### 1. 前提確認と素材の把握

```bash
bash tools/video-editing/setup.sh
```

素材フォルダの中身を ffprobe で把握する（尺・解像度・縦横・音声の有無）:

```bash
for f in <素材フォルダ>/*; do
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,r_frame_rate:format=duration \
    -of csv=p=0 "$f" | tr '\n' ' ' && echo "$f"
done
```

### 2. ヒアリング — 足りない情報を聞く

引数の用途メモで判断できないことは AskUserQuestion で確認する。**全部は聞かない**。
用途から推測できるものは推測し、確認が要るものだけ聞く。聞く候補:

- **用途**: イベント風景まとめ / 講座アーカイブ / 講座ダイジェスト（リール用） / その他
- **プラットフォーム**: YouTube（16:9, 1920x1080）/ インスタリール（9:16, 1080x1920, 推奨60〜90秒・最大3分）
- **目標尺**: リールなら必須。アーカイブは基本ノーカット前提かも確認
- **BGM**: 有無とファイルの場所（イベントまとめではほぼ必須。元音声はミュートするか）
- **区切りカード**: 講座アーカイブで章ごとのカードを入れるか。タイトル文言は台本があるか
- **色味**: こだわりがあるか（なければニュートラル補正をこちらで提案）

### 3. 素材解析 — 用途で手段を変える

**発話が主役（講座アーカイブ・ダイジェスト）** → 文字起こし:

```bash
uv run tools/video-editing/transcribe.py <素材フォルダ> --out transcripts --language ja
```

transcripts/*.json を読み、内容の重複・連続性から「どの動画がどの部分か」を判断する。

**映像が主役（イベント風景まとめ）** → 文字起こしは効かない。サムネイルで見る:

```bash
mkdir -p tmp/thumbs
for f in <素材フォルダ>/*; do
  ffmpeg -y -loglevel error -i "$f" -vf "fps=1/5,scale=480:-1,tile=4x3" \
    "tmp/thumbs/$(basename "${f%.*}").png"
done
```

タイル画像を Read で見て、各クリップの見どころと使える区間を選ぶ。細部が気になれば `/wd-look`。

### 4. 編集プランを作る

`tools/video-editing/edit-plan.example.json` の書式で `edit-plan.json` を書く。用途別レシピ:

**イベント風景まとめ**
- 1クリップ 2〜5秒でテンポよく。導入→盛り上がり→締めの流れを意識する
- 全シーン `"mute": true` + グローバル `"bgm"`。冒頭にタイトルカードがあると締まる
- リール向けなら `"size": "1080x1920", "fit": "crop"`（横素材の縦切り出しは被写体が中央にあるか確認）

**講座アーカイブ**
- 分割録画を文字起こしで正しい順序に並べ、章の切れ目に区切りカードを挿入する:
  ```bash
  uv run tools/video-editing/make_card.py "第2部 実践編" cards/02.png --size 1920x1080
  ```
- 録画ミス・長い無言・雑談カットを除く程度で、本編は刻みすぎない
- 各シーンに `"title"` を付け、`--chapters` で YouTube チャプターを出力する

**講座ダイジェスト（リール用）**
- 文字起こしから「単体で意味が通る・引きが強い」発言を選ぶ。合計が目標尺（60〜90秒）に収まるように
- `"size": "1080x1920"`。話者が画面端にいる素材は `"fit": "pad"` も検討
- 字幕焼き込みは transcripts の segments から SRT を書き、シーンの `filter` に `subtitles=digest.srt` を追加（タイムスタンプはシーンの `in` を引いてオフセットすること）

### 5. プランを見せて確認 → 実行

実行前にプランの要約（シーン構成・採用理由・落としたもの）を人間に見せる。OK が出たら:

```bash
python3 tools/video-editing/assemble.py edit-plan.json            # 通常
python3 tools/video-editing/assemble.py edit-plan.json --chapters chapters.txt  # 講座アーカイブ
```

### 6. 確認と調整ループ

- 完成ファイルの尺・解像度を ffprobe で確認し、結果を報告する
- 色味の比較が要るときは、`in`/`out` を10秒に絞った小プランで複数フィルタを書き出して見比べてもらう
- 直しはプラン JSON の編集 → 再実行。`.cuts/` の中間ファイルは残るので再エンコードは差分だけにしたければ workdir を分ける

## 注意

- 素材は消さない・上書きしない。出力とプランは素材と別の場所に置く
- 25GB 級の素材では中間ファイルも大きい。実行前にディスク残量を確認する
- リールの音楽は著作権に注意（ライセンスのある音源か確認を取る）

入力: $ARGUMENTS
