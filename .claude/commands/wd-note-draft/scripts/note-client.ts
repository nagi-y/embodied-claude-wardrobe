#!/usr/bin/env bun
// note の非公式 API クライアント。Cookie 認証 + 2 段階の下書き保存。
//
// note は公式 API を公開していない。ブラウザ ⇄ サーバ間の通信を再現して使う:
//   画像アップロード : POST /api/v1/upload_image            (multipart)
//   記事の新規作成   : POST /api/v1/text_notes              → { data: { id, key } }
//   下書き保存       : POST /api/v1/text_notes/draft_save?id={id}&is_temp_saved=true
//
// 認証は Cookie ベース。_note_session_v5 等のセッション Cookie と、
// XSRF-TOKEN Cookie を復号した X-XSRF-TOKEN ヘッダが必要。
//
// ⚠ 非公式 API のため、フィールド名やレスポンス形状は予告なく変わりうる。
//    調整が必要になりがちな箇所には [TUNE] を付けてある。

const BASE = "https://note.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface NoteAuth {
  cookie: string;
  xsrfToken: string;
}

export interface CreateResult {
  id: string | number;
  key?: string;
  raw: unknown;
}

// .env を読み、認証情報を組み立てる。process.env が優先。
export function loadAuth(envPath: string): NoteAuth | null {
  const fileEnv: Record<string, string> = {};
  try {
    const fs = require("node:fs");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
        if (!m || line.trim().startsWith("#")) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        fileEnv[m[1]] = v;
      }
    }
  } catch {
    /* ignore */
  }

  const cookie = process.env.NOTE_COOKIE ?? fileEnv.NOTE_COOKIE ?? "";
  if (!cookie) return null;

  let xsrf = process.env.NOTE_XSRF_TOKEN ?? fileEnv.NOTE_XSRF_TOKEN ?? "";
  if (!xsrf) {
    const m = cookie.match(/XSRF-TOKEN=([^;]+)/);
    if (m) {
      try {
        xsrf = decodeURIComponent(m[1]);
      } catch {
        xsrf = m[1];
      }
    }
  }
  return { cookie, xsrfToken: xsrf };
}

export class NoteClient {
  constructor(private auth: NoteAuth, private verbose = false) {}

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {
      Cookie: this.auth.cookie,
      Accept: "application/json",
      Origin: BASE,
      Referer: `${BASE}/notes/new`,
      "User-Agent": UA,
    };
    if (this.auth.xsrfToken) h["X-XSRF-TOKEN"] = this.auth.xsrfToken;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  private log(...a: unknown[]) {
    if (this.verbose) console.error("[note-client]", ...a);
  }

  // 画像をアップロードして CDN URL を返す。
  async uploadImage(filePath: string): Promise<string> {
    const fs = require("node:fs");
    const bytes = fs.readFileSync(filePath);
    const name = filePath.split("/").pop() ?? "image.png";
    const ext = (name.split(".").pop() ?? "png").toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/png";

    const fd = new FormData();
    // [TUNE] フィールド名。note のエディタは "file" を使う想定。環境変数で上書き可能。
    fd.append(process.env.NOTE_UPLOAD_FIELD ?? "file", new Blob([bytes], { type: mime }), name);

    const res = await fetch(`${BASE}/api/v1/upload_image`, {
      method: "POST",
      headers: this.headers(false), // Content-Type は fetch が boundary 付きで設定
      body: fd,
    });
    const txt = await res.text();
    this.log("upload_image", res.status, txt.slice(0, 300));
    if (!res.ok) throw new Error(`upload_image failed: ${res.status} ${txt.slice(0, 200)}`);
    let data: any = {};
    try {
      data = JSON.parse(txt);
    } catch {
      /* ignore */
    }
    // [TUNE] レスポンスの URL 取り出し。よくある形をいくつか試す。
    const url = data?.data?.url ?? data?.url ?? data?.data?.image_url ?? data?.image_url ?? data?.data?.key;
    if (!url) throw new Error(`upload_image: URL を取得できませんでした: ${txt.slice(0, 200)}`);
    return url;
  }

  // Step 1: 記事の新規作成（最小限）。返却 id を Step 2 で使う。
  async createNote(name: string, body: string): Promise<CreateResult> {
    const res = await fetch(`${BASE}/api/v1/text_notes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ name, body }),
    });
    const txt = await res.text();
    this.log("text_notes", res.status, txt.slice(0, 300));
    if (!res.ok) throw new Error(`text_notes create failed: ${res.status} ${txt.slice(0, 300)}`);
    const data = JSON.parse(txt);
    const d = data?.data ?? data;
    const id = d?.id;
    if (id == null) throw new Error(`text_notes: id を取得できませんでした: ${txt.slice(0, 200)}`);
    return { id, key: d?.key, raw: data };
  }

  // Step 2: 下書き保存（詳細）。
  async draftSave(
    id: string | number,
    payload: { name: string; body: string; bodyLength: number; eyecatchKey?: string },
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      name: payload.name,
      body: payload.body,
      body_length: payload.bodyLength,
      index: false,
      is_lead_form: false,
    };
    // [TUNE] 見出し画像。アップロードした key を渡す想定（不確実）。
    if (payload.eyecatchKey) body.eyecatch_image_key = payload.eyecatchKey;

    const res = await fetch(`${BASE}/api/v1/text_notes/draft_save?id=${encodeURIComponent(String(id))}&is_temp_saved=true`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    this.log("draft_save", res.status, txt.slice(0, 300));
    if (!res.ok) throw new Error(`draft_save failed: ${res.status} ${txt.slice(0, 300)}`);
    try {
      return JSON.parse(txt);
    } catch {
      return txt;
    }
  }
}
