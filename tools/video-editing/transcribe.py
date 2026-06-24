# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "faster-whisper>=1.0",
# ]
# ///
"""フォルダ内の全動画を Whisper で文字起こしし、単語タイムスタンプ付き JSON を出力する。

使い方:
    uv run transcribe.py <動画フォルダ> [--out transcripts] [--model small] [--language ja]

各動画ごとに <out>/<動画名>.json を生成する。JSON には以下が含まれる:
    - file / duration / language
    - segments: [{start, end, text}]
    - words:    [{start, end, word}]   ← Remotion の UI 同期にそのまま使える
"""

import argparse
import json
import sys
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".mts", ".m4v", ".webm"}


def find_videos(root: Path) -> list[Path]:
    return sorted(
        p for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXTS and p.is_file()
    )


def transcribe_all(args: argparse.Namespace) -> int:
    from faster_whisper import WhisperModel

    src = Path(args.source)
    if not src.is_dir():
        print(f"error: フォルダが見つからない: {src}", file=sys.stderr)
        return 1

    videos = find_videos(src)
    if not videos:
        print(f"error: 動画ファイルが見つからない: {src}", file=sys.stderr)
        return 1

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"model={args.model} を読み込み中…")
    model = WhisperModel(args.model, device="auto", compute_type="auto")

    for i, video in enumerate(videos, 1):
        dest = out_dir / (video.stem + ".json")
        if dest.exists() and not args.force:
            print(f"[{i}/{len(videos)}] skip(済): {video.name}")
            continue
        print(f"[{i}/{len(videos)}] {video.name} …", flush=True)

        segments, info = model.transcribe(
            str(video),
            language=args.language,
            word_timestamps=True,
            vad_filter=True,
        )

        seg_list, word_list = [], []
        for seg in segments:
            seg_list.append(
                {"start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip()}
            )
            for w in seg.words or []:
                word_list.append(
                    {"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word}
                )

        result = {
            "file": str(video),
            "duration": round(info.duration, 3),
            "language": info.language,
            "segments": seg_list,
            "words": word_list,
        }
        dest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"    → {dest} ({len(seg_list)} segments, {len(word_list)} words)")

    print("完了。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", help="動画フォルダ")
    parser.add_argument("--out", default="transcripts", help="出力先フォルダ (default: transcripts)")
    parser.add_argument("--model", default="small", help="Whisper モデル (tiny/base/small/medium/large-v3)")
    parser.add_argument("--language", default=None, help="言語コード。未指定なら自動判定 (例: ja, en)")
    parser.add_argument("--force", action="store_true", help="既存の JSON を上書きする")
    parser.add_argument("--check", action="store_true", help="依存関係の確認のみ行い終了する")
    args = parser.parse_args()

    if args.check:
        import faster_whisper  # noqa: F401

        print(f"ok: faster-whisper {faster_whisper.__version__} 利用可能")
        return 0

    if not args.source:
        parser.error("動画フォルダを指定してください（--check のみの場合は不要）")
    return transcribe_all(args)


if __name__ == "__main__":
    sys.exit(main())
