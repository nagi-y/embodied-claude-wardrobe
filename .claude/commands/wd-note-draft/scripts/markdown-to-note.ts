#!/usr/bin/env bun
// Markdown を note のエディタが解釈する HTML 形式に変換する。
//
// note の本文 HTML は、ブロック要素ごとに同一の UUID を name/id 属性に持つ:
//   <p name="UUID" id="UUID">段落</p>
//   <h2 name="UUID" id="UUID">大見出し</h2>  / <h3> 小見出し
//   <hr name="UUID" id="UUID">
//   <ul name="UUID" id="UUID"><li><p name="UUID" id="UUID">項目</p></li>...</ul>
//   <pre name="UUID" id="UUID"><code>コード</code></pre>
//   <figure name="UUID" id="UUID"><blockquote><p name="UUID" id="UUID">引用</p></blockquote><figcaption></figcaption></figure>
//   <figure name="UUID" id="UUID"><img src="URL"><figcaption>caption</figcaption></figure>
// インラインは <strong>、<a href ...>、<br>。
// (実際の note API レスポンスを観察して再現したフォーマット)
//
// CLI: bun run markdown-to-note.ts <file.md> [--title "..."]  → 変換 HTML を表示

const genId = () => crypto.randomUUID();

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

export interface FrontMatter {
  title?: string;
  eyecatch?: string;
  tags: string[];
  [k: string]: unknown;
}

export interface ImageRef {
  src: string;
  alt: string;
}

export interface ConvertOptions {
  title?: string;
  // ローカル画像をアップロードして note の URL に解決する関数。
  // 未指定なら src をそのまま使う（ドライラン / リモート URL 用）。
  imageResolver?: (src: string, alt: string) => Promise<string> | string;
}

export interface ConvertResult {
  title: string;
  body: string;
  bodyLength: number;
  frontMatter: FrontMatter;
  imageRefs: ImageRef[];
}

// ---- front-matter ----
function parseFrontMatter(md: string): { fm: FrontMatter; rest: string } {
  const fm: FrontMatter = { tags: [] };
  if (!md.startsWith("---")) return { fm, rest: md };
  const end = md.indexOf("\n---", 3);
  if (end === -1) return { fm, rest: md };
  const block = md.slice(md.indexOf("\n") + 1, end);
  const rest = md.slice(md.indexOf("\n", end + 1) + 1);
  for (const line of block.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (key === "tags") {
      val = val.replace(/^\[|\]$/g, "");
      fm.tags = val
        .split(/[,、]/)
        .map((t) => t.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return { fm, rest };
}

// ---- inline ----
function inline(text: string): string {
  let s = escapeHtml(text);
  // インライン画像 ![alt](src) は alt テキストに落とす（note は段落内に画像を埋めない）
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1");
  // リンク [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${escapeAttr(u)}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  // 太字 **x** / __x__
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // インラインコード `x`
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

// ---- block parser ----
export async function convert(markdown: string, opts: ConvertOptions = {}): Promise<ConvertResult> {
  const { fm, rest } = parseFrontMatter(markdown.replace(/\r\n/g, "\n"));
  const resolver = opts.imageResolver ?? ((src) => src);
  const imageRefs: ImageRef[] = [];
  const lines = rest.split("\n");
  const out: string[] = [];
  let title = opts.title ?? fm.title;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 空行スキップ
    if (line.trim() === "") continue;

    // コードフェンス ```
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      const id = genId();
      out.push(`<pre name="${id}" id="${id}"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // 見出し # ## ###  ( # は本文の大見出し h2、## も h2、### 以降は小見出し h3 )
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const txt = h[2].trim();
      // 先頭の H1 でタイトル未確定なら、それをタイトルにして本文から除く
      if (level === 1 && !title) {
        title = txt;
        continue;
      }
      const tag = level <= 2 ? "h2" : "h3";
      const id = genId();
      out.push(`<${tag} name="${id}" id="${id}">${inline(txt)}</${tag}>`);
      continue;
    }

    // 水平線 --- *** ___
    if (/^([-*_])\1{2,}\s*$/.test(line)) {
      const id = genId();
      out.push(`<hr name="${id}" id="${id}">`);
      continue;
    }

    // 単独画像 ![alt](src)
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      const alt = img[1];
      const rawSrc = img[2].trim();
      imageRefs.push({ src: rawSrc, alt });
      const url = await resolver(rawSrc, alt);
      const id = genId();
      const caption = alt ? escapeHtml(alt) : "";
      out.push(`<figure name="${id}" id="${id}"><img src="${escapeAttr(url)}"><figcaption>${caption}</figcaption></figure>`);
      continue;
    }

    // 引用 >
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      i--;
      const fid = genId();
      const pid = genId();
      const inner = quote.map((q) => inline(q)).join("<br>");
      out.push(`<figure name="${fid}" id="${fid}"><blockquote><p name="${pid}" id="${pid}">${inner}</p></blockquote><figcaption></figcaption></figure>`);
      continue;
    }

    // リスト（順序なし / 順序つき）
    const ulItem = line.match(/^\s*[-*+]\s+(.*)$/);
    const olItem = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ulItem || olItem) {
      const ordered = !!olItem;
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(re);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      i--;
      const listId = genId();
      const tag = ordered ? "ol" : "ul";
      const li = items
        .map((it) => {
          const pid = genId();
          return `<li><p name="${pid}" id="${pid}">${inline(it)}</p></li>`;
        })
        .join("");
      out.push(`<${tag} name="${listId}" id="${listId}">${li}</${tag}>`);
      continue;
    }

    // 段落（空行までの連続行を <br> で結合）
    const para: string[] = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() !== "" && !isBlockStart(lines[i + 1])) {
      para.push(lines[++i]);
    }
    const pid = genId();
    out.push(`<p name="${pid}" id="${pid}">${para.map((p) => inline(p)).join("<br>")}</p>`);
  }

  const body = out.join("");
  const plain = body
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  return {
    title: title ?? "無題",
    body,
    bodyLength: [...plain].length,
    frontMatter: fm,
    imageRefs,
  };
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s/.test(line) ||
    /^```/.test(line) ||
    /^([-*_])\1{2,}\s*$/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^!\[[^\]]*\]\([^)]+\)\s*$/.test(line)
  );
}

// ---- CLI ----
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  const titleIdx = argv.indexOf("--title");
  const title = titleIdx >= 0 ? argv[titleIdx + 1] : undefined;
  if (!file) {
    console.error("usage: bun run markdown-to-note.ts <file.md> [--title \"...\"]");
    process.exit(1);
  }
  const md = await Bun.file(file).text();
  const r = await convert(md, { title });
  console.log("TITLE:", r.title);
  console.log("BODY_LENGTH:", r.bodyLength);
  if (r.frontMatter.eyecatch) console.log("EYECATCH:", r.frontMatter.eyecatch);
  if (r.frontMatter.tags.length) console.log("TAGS:", r.frontMatter.tags.join(", "));
  if (r.imageRefs.length) console.log("IMAGES:", r.imageRefs.map((x) => x.src).join(", "));
  console.log("\n--- BODY HTML ---\n" + r.body);
}
