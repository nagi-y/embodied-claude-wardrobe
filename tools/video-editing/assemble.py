#!/usr/bin/env python3
"""編集プラン JSON をもとに FFmpeg で各シーンを切り出し、1本の動画に結合する。

使い方:
    python3 assemble.py edit-plan.json [--workdir .cuts] [--copy] [--chapters chapters.txt]

標準ライブラリのみ使用。システムに ffmpeg / ffprobe が必要。
プランの書式は edit-plan.example.json を参照。主なキー:

  グローバル:
    output  出力ファイル名
    size    "1920x1080" など。指定すると全シーンをこの解像度に統一（リールは "1080x1920"）
    fit     "crop"（はみ出しを切る・デフォルト）| "pad"（黒帯で収める）
    fps     フレームレートを統一したいとき（例: 30）
    filter  全シーン共通の映像フィルタ（カラーグレーディング等）
    bgm     {"file": "...", "volume": 0.25} BGM を全体にミックス

  シーン:
    type    省略時は通常カット。"card" で静止画カード（image + duration 必須）
    chosen / in / out   採用素材と切り出し区間（秒）
    filter  シーン個別の映像フィルタ（グローバルより優先）
    mute    true で元音声を消す（イベント風景まとめ＋BGM 用）
    title   --chapters 指定時にチャプター名として使う

デフォルトは再エンコード（カット点が正確・素材の解像度や音声仕様が混在していても結合できる）。
--copy はストリームコピーで高速だが、キーフレーム単位でしか切れず、素材仕様が揃っている必要がある。
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

# 中間ファイルの共通フォーマット。コーデック・音声仕様が揃っていないと concat できないため
MEZZANINE = [
    "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
]


def run(cmd: list[str]) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


def scale_chain(size: str, fit: str) -> str:
    w, h = size.split("x")
    if fit == "pad":
        return (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black"
        )
    return f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"


def build_vf(scene: dict, plan: dict) -> str | None:
    parts = []
    user_filter = scene.get("filter", plan.get("filter"))
    if user_filter:
        parts.append(user_filter)
    if plan.get("size"):
        parts.append(scale_chain(plan["size"], plan.get("fit", "crop")))
    return ",".join(parts) or None


def cut_scene(scene: dict, plan: dict, base: Path, dest: Path, copy: bool) -> None:
    src = base / scene["chosen"]
    if not src.exists():
        sys.exit(f"error: シーン{scene['scene']} の素材が見つからない: {src}")
    cmd = ["ffmpeg", "-y", "-ss", str(scene["in"]), "-to", str(scene["out"]), "-i", str(src)]
    if copy:
        if build_vf(scene, plan) or scene.get("mute"):
            print(f"warn: --copy のためシーン{scene['scene']} の filter/mute は無視される", file=sys.stderr)
        cmd += ["-c", "copy"]
    else:
        vf = build_vf(scene, plan)
        if vf:
            cmd += ["-vf", vf]
        if scene.get("mute"):
            cmd += ["-af", "volume=0"]
        if plan.get("fps"):
            cmd += ["-r", str(plan["fps"])]
        cmd += MEZZANINE
    cmd.append(str(dest))
    run(cmd)


def card_scene(scene: dict, plan: dict, base: Path, dest: Path) -> None:
    image = base / scene["image"]
    if not image.exists():
        sys.exit(f"error: シーン{scene['scene']} のカード画像が見つからない: {image}")
    size = plan.get("size", "1920x1080")
    duration = str(scene.get("duration", 3))
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-t", duration, "-i", str(image),
        "-f", "lavfi", "-t", duration, "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", scale_chain(size, plan.get("fit", "crop")),
        "-r", str(plan.get("fps", 30)),
        "-shortest",
    ] + MEZZANINE + [str(dest)]
    run(cmd)


def scene_duration(scene: dict) -> float:
    if scene.get("type") == "card":
        return float(scene.get("duration", 3))
    return float(scene["out"]) - float(scene["in"])


def write_chapters(plan: dict, path: Path) -> None:
    """YouTube の概要欄に貼れるチャプターリストを書き出す。カードは次シーンの頭出しとして扱う"""
    lines, t = [], 0.0
    for scene in plan["scenes"]:
        title = scene.get("title")
        if title and scene.get("type") != "card":
            m, s = divmod(int(t), 60)
            h, m = divmod(m, 60)
            stamp = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
            lines.append(f"{stamp} {title}")
        t += scene_duration(scene)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"チャプター: {path}")


def mix_bgm(plan: dict, base: Path, video: Path, output: Path) -> None:
    bgm = plan["bgm"]
    bgm_file = base / bgm["file"]
    if not bgm_file.exists():
        sys.exit(f"error: BGM が見つからない: {bgm_file}")
    volume = bgm.get("volume", 0.25)
    total = sum(scene_duration(s) for s in plan["scenes"])
    fade = min(float(bgm.get("fade", 2)), total)
    run([
        "ffmpeg", "-y", "-i", str(video),
        "-stream_loop", "-1", "-i", str(bgm_file),
        "-filter_complex",
        f"[1:a]volume={volume},afade=t=out:st={total - fade:.3f}:d={fade}[b];"
        f"[0:a][b]amix=inputs=2:duration=first:dropout_transition=3[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        str(output),
    ])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", help="編集プラン JSON")
    parser.add_argument("--workdir", default=".cuts", help="中間ファイル置き場 (default: .cuts)")
    parser.add_argument("--copy", action="store_true", help="再エンコードせずストリームコピーで切り出す")
    parser.add_argument("--chapters", metavar="FILE", help="YouTube チャプターリストを書き出す")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        print("error: ffmpeg が見つからない。setup.sh を実行してください", file=sys.stderr)
        return 1

    plan_path = Path(args.plan)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    base = plan_path.parent
    output = base / plan.get("output", "roughcut.mp4")

    workdir = base / args.workdir
    workdir.mkdir(parents=True, exist_ok=True)

    cut_files: list[Path] = []
    for scene in plan["scenes"]:
        dest = workdir / f"scene-{scene['scene']:03d}.mp4"
        if scene.get("type") == "card":
            card_scene(scene, plan, base, dest)
        else:
            cut_scene(scene, plan, base, dest, args.copy)
        cut_files.append(dest)

    concat_list = workdir / "concat.txt"
    concat_list.write_text(
        "".join(f"file '{p.resolve()}'\n" for p in cut_files), encoding="utf-8"
    )

    if plan.get("bgm"):
        joined = workdir / "joined.mp4"
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(joined)])
        mix_bgm(plan, base, joined, output)
    else:
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(output)])

    if args.chapters:
        write_chapters(plan, base / args.chapters)

    print(f"\n完成: {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
