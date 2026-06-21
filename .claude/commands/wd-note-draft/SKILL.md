---
name: wd-note-draft
description: "Markdown 記事を note のエディタ形式に変換し、画像をアップロードして note に「下書き」として保存する。公開はしない。フォーマット確認用のテスト投稿づくりにも使う。"
argument-hint: "[記事の Markdown ファイル | 指示]"
allowed-tools: Bash(bun run ${CLAUDE_SKILL_DIR}/scripts/note-draft.ts:*), Bash(bun run ${CLAUDE_SKILL_DIR}/scripts/markdown-to-note.ts:*), Bash(bun run ${CLAUDE_SKILL_DIR}/scripts/gen-placeholder.ts:*)
---

# /wd-note-draft — note に下書きを作る

Markdown で書いた記事を note（ https://note.com/relife_rerun ）に**下書き**として保存する。
note は公式 API を持たないため、非公式 API（Cookie 認証 + 2 段階の下書き保存）を使う。
**公開はしない。** 最終確認と公開は人間がやる、という分担。

> note の仕様調査の経緯は参考記事を踏まえている: https://note.com/a_g_e_n_t_b_o_t/n/n86da8314430b

## できること

- Markdown → note のエディタ形式 HTML（UUID 付きブロック）に変換
  - 見出し / 段落 / 太字 / リンク / インラインコード / 箇条書き / 番号リスト / 引用 / コードブロック / 水平線 / 画像
- 本文中の画像を note にアップロードして埋め込む
- 見出し画像（eyecatch）の設定（ベストエフォート）
- 画像が無いときはプレースホルダを自動生成（依存ゼロの PNG ジェネレータ）

## 前提

本番投稿には note のログイン Cookie が必要。`README.md` を見て `.env`（このスキル直下、gitignore 対象）に `NOTE_COOKIE` を設定する。
**Cookie が無くても `--dry-run` で変換結果は確認できる。**

## 手順

### 1. 記事を用意する

front-matter 付きの Markdown を作業ディレクトリに置く。新規記事は `tmp/wd-note-draft/<名前>/article.md`（gitignore 対象）に書くこと。リポジトリの追跡対象（`.claude/commands/` 配下など）に記事 `.md` を置かない（スキルとして誤登録される）。

```markdown
---
title: 記事タイトル
eyecatch: ./assets/eyecatch.png   # 見出し画像（任意・ローカルパス）
tags: [タグ1, タグ2]
---

本文。**太字** や [リンク](https://...) が使える。

## 見出し

- 箇条書き
```

画像は `![説明](./assets/foo.png)` で本文に挿入する。ファイルが無ければプレースホルダが自動生成される。

### 2. ドライランで変換を確認する（API を叩かない）

```bash
bun run ${CLAUDE_SKILL_DIR}/scripts/note-draft.ts <article.md> --dry-run
```

タイトル・本文 HTML・送信するリクエスト内容が表示される。フォーマットがおかしくないか必ず一度見る。

### 3. 本番：下書きとして保存する

```bash
bun run ${CLAUDE_SKILL_DIR}/scripts/note-draft.ts <article.md>
```

- 画像をアップロード → 記事を作成 → 下書き保存、まで自動で進む。
- 完了すると編集 URL（`https://note.com/notes/{key}/edit`）が出る。
- **下書きのまま。公開はされない。** note を開いて内容を確認してから、人間が公開する。

### 4. 結果を伝える

編集 URL をユーザーに渡し、「下書きまで作った。公開前に確認して」と伝える。

## サンプル（引数なし）

```bash
# サンプル記事 + プレースホルダ画像でフォーマット確認用の下書きを作る
bun run ${CLAUDE_SKILL_DIR}/scripts/note-draft.ts --dry-run   # まず変換を確認
bun run ${CLAUDE_SKILL_DIR}/scripts/note-draft.ts             # 下書き作成（要 .env）
```

引数なしだと `templates/sample-article.md.tmpl` を `tmp/wd-note-draft/sample/` にコピーして使う。

## 部品

- `scripts/note-draft.ts` — エントリポイント（変換 → 画像 → 2 段階保存）
- `scripts/markdown-to-note.ts` — Markdown → note HTML 変換（単体でも `bun run` 可）
- `scripts/note-client.ts` — note 非公式 API クライアント（Cookie 認証）
- `scripts/gen-placeholder.ts` / `scripts/png.ts` — プレースホルダ画像生成（依存ゼロ）
- `templates/sample-article.md.tmpl` — フォーマット見本

## 注意

- **非公式 API。** フィールド名やレスポンス形状が変わると壊れる。`note-client.ts` の `[TUNE]` コメント箇所を見直す。失敗時はステータスコードとレスポンスが `--verbose` で見える。
- Cookie には有効期限がある（30 日程度）。切れたら `.env` を更新する。
- `.env` は絶対にコミットしない（gitignore 済み）。

入力: $ARGUMENTS
