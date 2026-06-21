#!/usr/bin/env bun
// note 下書き作成フローのエントリポイント。
//   Markdown → note HTML 変換 → 画像アップロード → 2 段階で下書き保存。
//
// 使い方:
//   bun run note-draft.ts                          # サンプル記事をドライランの一歩手前まで
//   bun run note-draft.ts --dry-run                # 変換だけ。API は叩かない（認証不要）
//   bun run note-draft.ts <article.md> --dry-run   # 自分の記事をプレビュー
//   bun run note-draft.ts <article.md>             # 本番。下書きを note に保存（要 .env）
//   bun run note-draft.ts <article.md> --verbose   # API のやりとりを表示
//
// オプション:
//   --dry-run        API を呼ばず、変換結果とリクエスト内容だけ表示
//   --no-placeholders  参照画像が無くても自動生成しない
//   --verbose        API 通信のログを出す
//   --out-html PATH  変換した本文 HTML をファイルに保存

import { convert } from "./markdown-to-note.ts";
import { generatePlaceholder } from "./gen-placeholder.ts";
import { loadAuth, NoteClient } from "./note-client.ts";
import { dirname, isAbsolute, join, basename, extname } from "node:path";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";

const SKILL_DIR = dirname(import.meta.dir); // .../wd-note-draft
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? join(SKILL_DIR, "..", "..", "..");
const TEMPLATE = join(SKILL_DIR, "templates", "sample-article.md.tmpl");
const ENV_PATH = join(SKILL_DIR, ".env");

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--no-placeholders" || a === "--verbose" || a === "--convert-only") {
      flags.add(a);
    } else if (a === "--out-html" || a === "--title") {
      opts[a.slice(2)] = argv[++i];
    } else if (!a.startsWith("--") && !file) {
      file = a;
    }
  }
  return { flags, opts, file };
}

// alt/ファイル名から ASCII ラベルを作る（5x7 フォントは英数字のみ）
function labelFor(path: string, fallback: string): string {
  const stem = basename(path, extname(path));
  const ascii = stem.toUpperCase().replace(/[^A-Z0-9 .:/!-]/g, " ").trim();
  return ascii || fallback;
}

async function main() {
  const { flags, opts, file } = parseArgs(process.argv.slice(2));
  const dryRun = flags.has("--dry-run") || flags.has("--convert-only");
  const verbose = flags.has("--verbose");
  const genPlaceholders = !flags.has("--no-placeholders");

  // 入力 Markdown を決める。未指定ならサンプルを作業ディレクトリにコピーして使う。
  let mdFile: string;
  if (file) {
    mdFile = isAbsolute(file) ? file : join(process.cwd(), file);
  } else {
    const workDir = join(PROJECT_DIR, "tmp", "wd-note-draft", "sample");
    mkdirSync(join(workDir, "assets"), { recursive: true });
    mdFile = join(workDir, "article.md");
    copyFileSync(TEMPLATE, mdFile);
    console.error(`ℹ️  サンプル記事を使用: ${mdFile}`);
  }

  const mdDir = dirname(mdFile);
  const md = await Bun.file(mdFile).text();

  // 参照画像の解決。ローカルの相対パスは Markdown の隣を基準にする。
  const resolveLocal = (src: string) => (isAbsolute(src) || /^https?:\/\//.test(src) ? src : join(mdDir, src));

  // 不足しているローカル画像をプレースホルダで補う
  const ensurePlaceholder = (src: string, label: string, w: number, h: number, theme: string) => {
    if (/^https?:\/\//.test(src)) return;
    const abs = resolveLocal(src);
    if (existsSync(abs)) return;
    if (!genPlaceholders) {
      console.error(`⚠️  画像が見つかりません（--no-placeholders 指定中）: ${abs}`);
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    generatePlaceholder({ out: abs, label, w, h, theme });
    console.error(`🖼️  プレースホルダ生成: ${abs} (label="${label}")`);
  };

  // front-matter とブロックを下見して、必要な画像を先に用意する
  const peek = await convert(md, { title: opts.title });
  if (peek.frontMatter.eyecatch) {
    ensurePlaceholder(peek.frontMatter.eyecatch, labelFor(peek.frontMatter.eyecatch, "NOTE TEST"), 1280, 670, "indigo");
  }
  const bodyThemes = ["teal", "rose", "slate"];
  peek.imageRefs.forEach((ref, i) => {
    ensurePlaceholder(ref.src, labelFor(ref.src, `IMG ${String(i + 1).padStart(2, "0")}`), 1000, 560, bodyThemes[i % bodyThemes.length]);
  });

  // ===== ドライラン =====
  if (dryRun) {
    const r = await convert(md, { title: opts.title }); // identity resolver（ローカルパスのまま）
    console.log("\n========== DRY RUN ==========");
    console.log("TITLE       :", r.title);
    console.log("BODY_LENGTH :", r.bodyLength);
    console.log("EYECATCH    :", r.frontMatter.eyecatch ?? "(なし)");
    console.log("TAGS        :", r.frontMatter.tags.join(", ") || "(なし)");
    console.log("IMAGES      :", r.imageRefs.map((x) => x.src).join(", ") || "(なし)");
    console.log("\n--- POST /api/v1/text_notes (step 1) ---");
    console.log(JSON.stringify({ name: r.title, body: "(本文 HTML)" }, null, 2));
    console.log("\n--- POST /api/v1/text_notes/draft_save?id={id}&is_temp_saved=true (step 2) ---");
    console.log(JSON.stringify({ name: r.title, body: "(本文 HTML)", body_length: r.bodyLength, index: false, is_lead_form: false }, null, 2));
    console.log("\n--- BODY HTML ---\n" + r.body);
    if (opts["out-html"]) {
      writeFileSync(opts["out-html"], r.body);
      console.error(`\n💾 HTML を保存: ${opts["out-html"]}`);
    }
    console.log("\n(ドライラン: API は呼んでいません。本番投稿は --dry-run を外してください)");
    return;
  }

  // ===== 本番 =====
  const auth = loadAuth(ENV_PATH);
  if (!auth) {
    console.error(`\n❌ 認証情報がありません。${ENV_PATH} に NOTE_COOKIE を設定してください。`);
    console.error(`   取得方法は ${join(SKILL_DIR, "README.md")} を参照。まずは --dry-run で変換結果を確認できます。`);
    process.exit(1);
  }
  const client = new NoteClient(auth, verbose);

  // 画像をアップロードしながら変換
  const r = await convert(md, {
    title: opts.title,
    imageResolver: async (src) => {
      if (/^https?:\/\//.test(src)) return src;
      const abs = resolveLocal(src);
      console.error(`⬆️  画像アップロード: ${abs}`);
      return await client.uploadImage(abs);
    },
  });

  if (opts["out-html"]) writeFileSync(opts["out-html"], r.body);

  // 見出し画像（ベストエフォート）
  let eyecatchKey: string | undefined;
  if (r.frontMatter.eyecatch && !/^https?:\/\//.test(r.frontMatter.eyecatch)) {
    try {
      const abs = resolveLocal(r.frontMatter.eyecatch);
      console.error(`⬆️  見出し画像アップロード: ${abs}`);
      eyecatchKey = await client.uploadImage(abs);
    } catch (e) {
      console.error(`⚠️  見出し画像の設定に失敗（本文は続行）: ${(e as Error).message}`);
    }
  }

  // Step 1: 作成
  console.error("📝 記事を作成中...");
  const created = await client.createNote(r.title, r.body);
  console.error(`✅ 作成成功: id=${created.id}${created.key ? ` key=${created.key}` : ""}`);

  // Step 2: 下書き保存
  console.error("💾 下書き保存中...");
  await client.draftSave(created.id, { name: r.title, body: r.body, bodyLength: r.bodyLength, eyecatchKey });

  const editUrl = created.key ? `https://note.com/notes/${created.key}/edit` : `https://note.com/notes/${created.id}/edit`;
  console.log("\n✅ 下書き保存完了！");
  console.log(`   タイトル: ${r.title}`);
  console.log(`   編集 URL: ${editUrl}`);
  console.log("   （公開はされていません。note で内容を確認してから公開してください）");
}

main().catch((e) => {
  console.error("\n❌ エラー:", e instanceof Error ? e.message : e);
  process.exit(1);
});
