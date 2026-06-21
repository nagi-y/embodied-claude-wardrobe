# wd-note-draft — note 自動下書きフロー

Markdown 記事を **note のエディタ形式に変換し、画像つきで「下書き」として保存**するスキル。
note（ https://note.com/relife_rerun ）には公式 API が無いため、ブラウザの通信を再現した
非公式 API（Cookie 認証 + 2 段階の下書き保存）を使う。**公開はしない。**

参考にした調査記事: https://note.com/a_g_e_n_t_b_o_t/n/n86da8314430b

## クイックスタート

```bash
cd .claude/commands/wd-note-draft

# 1) 認証なしで変換だけ試す（サンプル記事 + プレースホルダ画像）
bun run scripts/note-draft.ts --dry-run

# 2) 本番投稿の準備：Cookie を設定
cp .env.example .env
#   .env を編集して NOTE_COOKIE を貼る（取得方法は下記）

# 3) 下書きを作る
bun run scripts/note-draft.ts            # サンプル記事で下書き作成
bun run scripts/note-draft.ts 記事.md     # 自分の記事で下書き作成
```

## セットアップ：note の Cookie を取得する

note は公式 API を公開していないので、ログイン済みブラウザの Cookie を借りる。

1. ブラウザで https://note.com にログインする
2. `F12`（デベロッパーツール）→ **Network** タブを開く
3. ページを再読み込みし、`note.com` 宛のリクエストを 1 つクリック
4. **Request Headers** の `cookie:` の値を**丸ごと**コピー
   - `_note_session_v5=...` と `XSRF-TOKEN=...` が含まれていることを確認
5. `.env` の `NOTE_COOKIE="..."` に貼り付ける

```env
NOTE_COOKIE="_note_session_v5=xxxxx; XSRF-TOKEN=yyyyy; ..."
```

- `XSRF-TOKEN` は Cookie 文字列から自動で取り出し、`X-XSRF-TOKEN` ヘッダに復号して入れる。手動指定は不要。
- Cookie の有効期限はおよそ 30 日。投稿が 401/403 で失敗したら `.env` を取り直す。
- `.env` は `.gitignore` 済み。**絶対にコミットしない。**

## 記事の書き方

front-matter 付き Markdown。`tmp/` などリポジトリ追跡外の作業ディレクトリに置く。

```markdown
---
title: 記事タイトル
eyecatch: ./assets/eyecatch.png   # 見出し画像（任意）
tags: [タグ1, タグ2]
---

本文。**太字**、[リンク](https://example.com)、`コード` が使える。

## 見出し（h2）
### 小見出し（h3）

- 箇条書き
1. 番号リスト

> 引用

![本文画像の説明](./assets/zu.png)

​```ts
const x = 1; // コードブロック
​```
```

対応している記法：見出し / 段落 / 太字 / リンク / インラインコード / 箇条書き / 番号リスト /
引用 / コードブロック / 水平線（`---`）/ 画像。

画像はローカルの相対パス（Markdown ファイルからの相対）で書く。**ファイルが存在しなければ
プレースホルダ画像が自動生成される**ので、フォーマット確認用のテスト投稿はそのまま作れる。

## コマンド

| コマンド | 説明 |
| --- | --- |
| `bun run scripts/note-draft.ts <md> --dry-run` | 変換のみ。API を叩かない（認証不要） |
| `bun run scripts/note-draft.ts <md>` | 画像アップロード → 作成 → 下書き保存 |
| `bun run scripts/note-draft.ts <md> --verbose` | API 通信ログを表示（デバッグ用） |
| `bun run scripts/note-draft.ts <md> --no-placeholders` | 不足画像を自動生成しない |
| `bun run scripts/note-draft.ts <md> --out-html out.html` | 変換した本文 HTML を保存 |
| `bun run scripts/markdown-to-note.ts <md>` | 変換だけ単体実行 |
| `bun run scripts/gen-placeholder.ts --out x.png --label "TEST" --theme teal` | プレースホルダ生成 |

## 仕組み（2 段階投稿）

1. **作成** `POST /api/v1/text_notes` に `{name, body}` → `id` が返る
2. **下書き保存** `POST /api/v1/text_notes/draft_save?id={id}&is_temp_saved=true` に
   `{name, body, body_length, index, is_lead_form}` を送る
3. 画像は事前に `POST /api/v1/image_upload/note_picture`（multipart, field=`file`）で
   アップロードし、本文 HTML の `<figure><img src="..."></figure>` に URL を埋める

> エンドポイントは note のフロントエンド JS（Nuxt バンドル）を解析して確認した実エンドポイント。
> 参考記事にある `/api/v1/upload_image` は現行コードに存在しないため `note_picture` を使う。

## トラブルシュート

- **401 / 403** → Cookie 切れ。`.env` を取り直す。
- **422（作成/保存）** → 非公式 API の仕様変更。`scripts/note-client.ts` の `[TUNE]` 箇所
  （送信フィールド）を見直す。`--verbose` でレスポンスを確認。
- **画像アップロードが失敗** → `NOTE_UPLOAD_ENDPOINT` / `NOTE_UPLOAD_FIELD` を変えるか、
  レスポンスの URL キー取り出し（`note-client.ts` の `[TUNE]`）を調整。`--verbose` で生レスポンス確認。
- **本文は出るが画像が出ない** → 下書きはできているので、note のエディタで画像だけ差し替えても良い。

## ファイル構成

```
wd-note-draft/
├── SKILL.md                       # スキル定義（/wd-note-draft）
├── README.md                      # このファイル
├── .env.example                   # 認証情報テンプレ（.env は gitignore）
├── scripts/
│   ├── note-draft.ts              # エントリポイント
│   ├── markdown-to-note.ts        # Markdown → note HTML 変換
│   ├── note-client.ts             # note 非公式 API クライアント
│   ├── gen-placeholder.ts         # プレースホルダ画像 CLI
│   └── png.ts                     # 依存ゼロ PNG エンコーダ + ビットマップフォント
└── templates/
    └── sample-article.md.tmpl     # フォーマット見本
```
