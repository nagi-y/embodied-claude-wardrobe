# note 非公式 API（下書き投稿）

`/wd-note-draft` スキルが使う note の内部 API。公式 API は存在しないため、
フロントエンド（Nuxt バンドル `frontend.st-note.com/nuxt/production/note.*.js`）を解析して再現した。

## わかったこと

### 認証
- Cookie ベース。`_note_session_v5` 等のセッション Cookie が必要。
- POST/PUT/DELETE には `X-XSRF-TOKEN` ヘッダが要る。値は `XSRF-TOKEN` Cookie を `decodeURIComponent` したもの。
- ブラウザの devtools で Request Headers の `cookie:` を丸ごとコピーして使うのが手堅い。有効期限 ~30 日。

### エンドポイント（フロント JS の Vuex actions から確認）
- `D = { TextNote: "text_notes" }` — noteType → パスの対応
- **新規作成**: `POST /api/v1/text_notes` （params。`CREATE_NOTE` で isDraft=false）→ `{ data: { id, key } }`
- **下書き保存**: `POST /api/v1/text_notes/draft_save?id={id}` （`UPDATE_NOTE` で isDraft=true）
- **下書き削除**: `DELETE /api/v1/text_notes/draft_delete?id={id}`
- **公開削除**: `DELETE /api/v1/notes/{id}`
- **本文画像アップロード**: `POST /api/v1/image_upload/note_picture` （`UPLOAD_IMAGE_FILE_OLD`）
  - multipart/form-data、ファイルの **field 名は `file`**
  - 新方式 `UPLOAD_IMAGE_FILE` は presigned-POST（先に `{action, post}` を取得 → その URL に `file` を POST、`credentials:"omit"`）。直叩きするなら OLD の note_picture が単純。
- 音声カバー: `POST /api/v1/image_upload/sound_cover`、ストックフォト: `POST /api/v2/image_upload/stock_photo_images`

### 本文 HTML の形式（実 API レスポンス `GET /api/v3/notes/{key}` の `body` を観察）
ブロック要素ごとに同一 UUID を `name` と `id` 属性に持つ:
- 段落 `<p name id>…</p>`、見出し `<h2|h3 name id>…</h2>`、水平線 `<hr name id>`
- 箇条書き `<ul name id><li><p name id>…</p></li>…</ul>`（`<ol>` も同様。`<li>` に属性なし）
- コード `<pre name id><code>…</code></pre>`（`<code>` に属性なし、改行はそのまま）
- 引用 `<figure name id><blockquote><p name id>…</p></blockquote><figcaption></figcaption></figure>`
- 画像 `<figure name id><img src="…"><figcaption>caption</figcaption></figure>`
- インライン: `<strong>`、`<a href target rel>`、`<code>`、改行 `<br>`、エンティティは `&amp;` 等にエスケープ
- 記事タイトルは body ではなく `name` フィールド。eyecatch（見出し画像）は note の `eyecatch` プロパティ（別物）

### ハマりどころ
- 参考記事（a_g_e_n_t_b_o_t）の `POST /api/v1/upload_image` は**現行フロントに存在しない**。実際は `image_upload/note_picture`。
- 参考記事の作成時 422 は、step1 に `status:'draft'` 等の余計なパラメータを送ったため。**作成は `{name, body}` のみ**が安全。
- 下書き保存の payload は、参考記事の検証済み形（`{name, body, body_length, index, is_lead_form}` + `?is_temp_saved=true`）を採用。現行フロントは `is_temp_saved`/`body_length` を送らない（サーバ側計算）leaner 版だが、検証済みの形を既定にしている。

## やり方
2 段階: `text_notes` で作成して `id` を得る → `text_notes/draft_save?id={id}` で本文を保存。
画像は先に `image_upload/note_picture` で上げて URL を本文の `<figure><img>` に埋める。**公開はしない**（下書きまで）。

実装は `.claude/commands/wd-note-draft/scripts/`。仕様変更で壊れたら `note-client.ts` の `[TUNE]` 箇所と、
`frontend.st-note.com/nuxt/production/note.*.js` を `text_notes` / `image_upload` / `draft_save` で grep して突き合わせる。

## キーワード
note, 非公式API, draft_save, text_notes, image_upload, note_picture, XSRF, Cookie認証, eyecatch, 下書き投稿
