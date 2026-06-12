#!/usr/bin/env python3
"""編集プラン JSON をもとに FFmpeg で各シーンを切り出し、1本のラフカットに結合する。

使い方:
    python3 assemble.py edit-plan.json [--workdir .cuts] [--copy]

標準ライブラリのみ使用。システムに ffmpeg / ffprobe が必要。
プランの書式は edit-plan.example.json を参照。

デフォルトでは再エンコード（カット点が正確）。--copy はストリームコピーで高速だが、
キーフレーム単位でしか切れないためカット点がずれることがある。
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

# 中間ファイルの共通フォーマット。解像度・コーデックが揃っていないと concat できないため
MEZZANINE = ["-c:v", "libx264", "-crf", "18", "-preset", "fast", "-c:a", "aac", "-b:a", "192k"]


def run(cmd: list[str]) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", help="編集プラン JSON")
    parser.add_argument("--workdir", default=".cuts", help="中間ファイル置き場 (default: .cuts)")
    parser.add_argument("--copy", action="store_true", help="再エンコードせずストリームコピーで切り出す")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        print("error: ffmpeg が見つからない。setup.sh を実行してください", file=sys.stderr)
        return 1

    plan_path = Path(args.plan)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    base = plan_path.parent
    output = base / plan.get("output", "roughcut.mp4")
    global_filter = plan.get("filter")

    workdir = base / args.workdir
    workdir.mkdir(parents=True, exist_ok=True)

    cut_files: list[Path] = []
    for scene in plan["scenes"]:
        src = base / scene["chosen"]
        if not src.exists():
            print(f"error: シーン{scene['scene']} の素材が見つからない: {src}", file=sys.stderr)
            return 1

        cut = workdir / f"scene-{scene['scene']:03d}.mp4"
        cmd = ["ffmpeg", "-y", "-ss", str(scene["in"]), "-to", str(scene["out"]), "-i", str(src)]

        vf = scene.get("filter", global_filter)
        if args.copy:
            if vf:
                print(f"warn: --copy のためシーン{scene['scene']} の filter は無視される", file=sys.stderr)
            cmd += ["-c", "copy"]
        else:
            if vf:
                cmd += ["-vf", vf]
            cmd += MEZZANINE
        cmd.append(str(cut))
        run(cmd)
        cut_files.append(cut)

    concat_list = workdir / "concat.txt"
    concat_list.write_text(
        "".join(f"file '{p.resolve()}'\n" for p in cut_files), encoding="utf-8"
    )
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(output)])

    print(f"\n完成: {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
