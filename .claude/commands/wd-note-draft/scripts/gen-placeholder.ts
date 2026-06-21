#!/usr/bin/env bun
// プレースホルダ画像を生成する。note のテスト投稿に入れる本文画像・見出し画像用。
// 依存ゼロ（png.ts のみ）。グラデーション背景 + 中央ラベル + 枠の装飾。
//
// 使い方:
//   bun run gen-placeholder.ts --out eyecatch.png --label "NOTE TEST" --w 1280 --h 670 --theme indigo
//   bun run gen-placeholder.ts --out body01.png --label "IMG 01" --theme teal

import { Canvas } from "./png.ts";

type Theme = { top: [number, number, number]; bottom: [number, number, number]; fg: [number, number, number]; accent: [number, number, number] };

export const THEMES: Record<string, Theme> = {
  indigo: { top: [76, 81, 191], bottom: [30, 27, 75], fg: [240, 240, 255], accent: [129, 140, 248] },
  teal: { top: [13, 148, 136], bottom: [4, 47, 46], fg: [236, 254, 255], accent: [45, 212, 191] },
  rose: { top: [225, 29, 72], bottom: [76, 5, 25], fg: [255, 241, 242], accent: [251, 113, 133] },
  slate: { top: [71, 85, 105], bottom: [15, 23, 42], fg: [248, 250, 252], accent: [148, 163, 184] },
};

export interface PlaceholderOptions {
  out: string;
  label?: string;
  w?: number;
  h?: number;
  theme?: string;
}

// プレースホルダ PNG を生成して out に書き出す。
export function generatePlaceholder(opts: PlaceholderOptions): void {
  const w = opts.w ?? 1280;
  const h = opts.h ?? 670;
  const label = opts.label ?? "NOTE TEST";
  const theme = THEMES[opts.theme ?? "indigo"] ?? THEMES.indigo;

  const c = new Canvas(w, h);
  c.gradientV(theme.top, theme.bottom);

  // 角のアクセント目印（プレースホルダだと一目でわかる装飾）
  const m = Math.round(Math.min(w, h) * 0.06);
  const t = Math.max(3, Math.round(m * 0.18));
  for (const [ox, oy, dx, dy] of [
    [m, m, 1, 1],
    [w - m, m, -1, 1],
    [m, h - m, 1, -1],
    [w - m, h - m, -1, -1],
  ] as const) {
    c.fillRect(Math.min(ox, ox + dx * m), oy - (dy < 0 ? t : 0), m, t, ...theme.accent); // 横棒
    c.fillRect(ox - (dx < 0 ? t : 0), Math.min(oy, oy + dy * m), t, m, ...theme.accent); // 縦棒
  }

  // 中央ラベル。はみ出さないよう scale を自動調整。
  let scale = Math.max(4, Math.round(h / 12));
  while (c.textWidth(label, scale) > w * 0.82 && scale > 2) scale--;
  const tw = c.textWidth(label, scale);
  const th = 7 * scale;
  c.text(label, Math.round((w - tw) / 2), Math.round((h - th) / 2), scale, theme.fg);

  // ラベル下の細いアクセントライン
  const lineW = Math.round(tw * 0.6);
  c.fillRect(Math.round((w - lineW) / 2), Math.round((h - th) / 2) + th + scale * 2, lineW, Math.max(2, Math.round(scale / 2)), ...theme.accent);

  Bun.write(opts.out, c.encode());
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const w = parseInt(args.w ?? args.width ?? "1280", 10);
  const h = parseInt(args.h ?? args.height ?? "670", 10);
  const label = args.label ?? "NOTE TEST";
  const out = args.out ?? "placeholder.png";
  const theme = args.theme ?? "indigo";
  generatePlaceholder({ out, label, w, h, theme });
  console.log(`✅ generated ${out} (${w}x${h}, theme=${theme}, label="${label}")`);
}
