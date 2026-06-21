// 依存ゼロの最小 PNG エンコーダ + 5x7 ビットマップフォント。
// ImageMagick / PIL / sharp が無い環境でもプレースホルダ画像を生成するための道具。
// truecolor(RGB, 8bit) のみ対応。node:zlib で IDAT を圧縮する。

import { deflateSync } from "node:zlib";

// ---- CRC32 (PNG 仕様) ----
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

export class Canvas {
  width: number;
  height: number;
  px: Uint8Array; // RGB

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height * 3);
  }

  set(x: number, y: number, r: number, g: number, b: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.px[i] = r;
    this.px[i + 1] = g;
    this.px[i + 2] = b;
  }

  fillRect(x0: number, y0: number, w: number, h: number, r: number, g: number, b: number) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, r, g, b);
  }

  // 上→下の縦方向グラデーション
  gradientV(top: [number, number, number], bottom: [number, number, number]) {
    for (let y = 0; y < this.height; y++) {
      const t = this.height === 1 ? 0 : y / (this.height - 1);
      const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
      const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
      const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
      this.fillRect(0, y, this.width, 1, r, g, b);
    }
  }

  // 文字列を 5x7 フォントで描画。scale 倍に拡大。
  text(str: string, x: number, y: number, scale: number, color: [number, number, number]) {
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const glyph = FONT[ch] ?? FONT[" "];
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 5; col++) {
          if (bits & (1 << (4 - col))) {
            this.fillRect(cx + col * scale, y + row * scale, scale, scale, color[0], color[1], color[2]);
          }
        }
      }
      cx += 6 * scale; // 5 + 1 spacing
    }
  }

  textWidth(str: string, scale: number): number {
    return str.length * 6 * scale - scale; // 末尾の spacing を引く
  }

  encode(): Uint8Array {
    // IHDR
    const ihdr = new Uint8Array(13);
    ihdr.set(u32(this.width), 0);
    ihdr.set(u32(this.height), 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type: truecolor RGB
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    // raw scanlines: 各行頭に filter byte 0
    const raw = new Uint8Array(this.height * (1 + this.width * 3));
    for (let y = 0; y < this.height; y++) {
      const rowStart = y * (1 + this.width * 3);
      raw[rowStart] = 0;
      raw.set(this.px.subarray(y * this.width * 3, (y + 1) * this.width * 3), rowStart + 1);
    }
    const idatData = new Uint8Array(deflateSync(raw));

    const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idatData), chunk("IEND", new Uint8Array(0))];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
}

// ---- 5x7 ビットマップフォント (各行は下位5bit, MSB が左端) ----
const FONT: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x06],
  ":": [0x00, 0x06, 0x06, 0x00, 0x06, 0x06, 0x00],
  "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
};
