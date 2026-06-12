# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "Pillow>=10",
# ]
# ///
"""区切り・タイトルカードの PNG を生成する。

使い方:
    uv run make_card.py "第2部 実践編" cards/02.png --size 1920x1080
    uv run make_card.py "イベントまとめ" cards/title.png --size 1080x1920 --subtitle "2026.06 大阪" \
        --bg "#1a1a2e" --fg "#eaeaea"

日本語フォントは fc-match で自動検出する。見つからなければ --font でパスを指定する。
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

FALLBACK_FONTS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "C:/Windows/Fonts/meiryob.ttc",
]


def find_font(explicit: str | None) -> str:
    if explicit:
        if Path(explicit).exists():
            return explicit
        sys.exit(f"error: フォントが見つからない: {explicit}")
    if shutil.which("fc-match"):
        out = subprocess.run(
            ["fc-match", "-f", "%{file}", ":lang=ja:weight=bold"],
            capture_output=True, text=True,
        ).stdout.strip()
        if out and Path(out).exists():
            return out
    for path in FALLBACK_FONTS:
        if Path(path).exists():
            return path
    sys.exit("error: 日本語フォントを検出できなかった。--font <ttf/ttcパス> を指定してください")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", help="メインテキスト（\\n で改行）")
    parser.add_argument("output", help="出力 PNG パス")
    parser.add_argument("--size", default="1920x1080", help="WxH (default: 1920x1080)")
    parser.add_argument("--subtitle", default=None, help="サブテキスト（小さめに下へ表示）")
    parser.add_argument("--bg", default="#101820", help="背景色 (default: #101820)")
    parser.add_argument("--fg", default="#f2f2f2", help="文字色 (default: #f2f2f2)")
    parser.add_argument("--accent", default="#4cc9f0", help="アクセント線の色")
    parser.add_argument("--font", default=None, help="フォントファイルのパス")
    args = parser.parse_args()

    from PIL import Image, ImageDraw, ImageFont

    w, h = (int(v) for v in args.size.split("x"))
    font_path = find_font(args.font)
    main_text = args.text.replace("\\n", "\n")

    img = Image.new("RGB", (w, h), args.bg)
    draw = ImageDraw.Draw(img)

    # メインテキストは幅の85%に収まるまでサイズを下げる
    size = h // 8
    while size > 12:
        font = ImageFont.truetype(font_path, size)
        box = draw.multiline_textbbox((0, 0), main_text, font=font, align="center")
        if box[2] - box[0] <= w * 0.85:
            break
        size = int(size * 0.9)

    cy = h // 2 - (h // 14 if args.subtitle else 0)
    draw.multiline_text((w / 2, cy), main_text, font=font, fill=args.fg, anchor="mm", align="center")

    # テキスト下のアクセント線
    box = draw.multiline_textbbox((w / 2, cy), main_text, font=font, anchor="mm", align="center")
    line_y = box[3] + h // 30
    draw.rectangle([w / 2 - w // 14, line_y, w / 2 + w // 14, line_y + max(4, h // 240)], fill=args.accent)

    if args.subtitle:
        sub_font = ImageFont.truetype(font_path, max(14, size // 3))
        draw.text((w / 2, line_y + h // 12), args.subtitle, font=sub_font, fill=args.fg, anchor="mm")

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"カード生成: {out} ({w}x{h}, font={Path(font_path).name})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
