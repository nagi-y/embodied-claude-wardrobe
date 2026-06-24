"""ingest_inbox.py — wardrobe-self の記憶 draft を DB に取り込む（local ロール用）

リモート/web セッションが memory/inbox/ に積んだ .md draft を読み、
memory-mcp の store に save_with_auto_link で取り込み、archive/ へ退避する。

非対称 writer モデルの「local 側 ingest」を担う。sqlite DB の唯一の writer は
このスクリプトを動かす local 環境。取り込み後は self-sync.sh push で DB を commit する。

使い方（memory-mcp ディレクトリから）:
    WARDROBE_SELF_DIR=~/wardrobe-self uv run python scripts/ingest_inbox.py
    uv run python scripts/ingest_inbox.py --inbox /path/to/inbox --dry-run

DB パスは memory-mcp の通常解決（MEMORY_DB_PATH / CLAUDE_PROJECT_DIR）に従う。
local ロールでは .claude/memories → wardrobe-self/memory/db が symlink されているので、
CLAUDE_PROJECT_DIR を本体に向けて実行すれば自動的に個人リポジトリの DB に書かれる。
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

# memory_mcp パッケージを import path に追加
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from memory_mcp.config import MemoryConfig  # noqa: E402
from memory_mcp.memory import MemoryStore  # noqa: E402


def parse_draft(text: str) -> dict:
    """frontmatter 付き draft をパースする。content と meta を返す。"""
    meta = {"emotion": "neutral", "importance": 3, "category": "daily", "ingested": "false"}
    body = text
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            front, body = parts[1], parts[2]
            for line in front.strip().splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    meta[k.strip()] = v.strip()
    try:
        meta["importance"] = int(meta.get("importance", 3))
    except (ValueError, TypeError):
        meta["importance"] = 3
    return {"content": body.strip(), "meta": meta}


async def ingest(inbox: Path, archive: Path, dry_run: bool) -> int:
    drafts = sorted(p for p in inbox.glob("*.md") if p.is_file())
    pending = []
    for p in drafts:
        parsed = parse_draft(p.read_text(encoding="utf-8"))
        if str(parsed["meta"].get("ingested", "false")).lower() == "true":
            continue
        if not parsed["content"]:
            continue
        pending.append((p, parsed))

    if not pending:
        print("[ingest] 取り込む draft なし")
        return 0

    print(f"[ingest] {len(pending)} 件の draft を取り込む" + (" (dry-run)" if dry_run else ""))
    if dry_run:
        for p, parsed in pending:
            m = parsed["meta"]
            print(f"  - {p.name}: imp={m['importance']} emo={m['emotion']} :: {parsed['content'][:60]}")
        return 0

    config = MemoryConfig.from_env()
    store = MemoryStore(config)
    await store.connect()
    print(f"[ingest] DB: {config.db_path}")
    archive.mkdir(parents=True, exist_ok=True)

    count = 0
    try:
        for p, parsed in pending:
            m = parsed["meta"]
            memory = await store.save_with_auto_link(
                content=parsed["content"],
                emotion=str(m.get("emotion", "neutral")),
                importance=int(m["importance"]),
                category=str(m.get("category", "daily")),
            )
            p.rename(archive / p.name)
            count += 1
            print(f"  ✓ {p.name} → memory {memory.id} (linked {len(memory.linked_ids)})")
    finally:
        await store.disconnect()

    print(f"[ingest] 完了: {count} 件取り込み、archive へ移動")
    return count


def main() -> None:
    self_dir = os.environ.get("WARDROBE_SELF_DIR", str(Path.home() / "wardrobe-self"))
    ap = argparse.ArgumentParser(description="wardrobe-self の inbox を DB に取り込む")
    ap.add_argument("--inbox", default=str(Path(self_dir) / "memory" / "inbox"))
    ap.add_argument("--archive", default=str(Path(self_dir) / "memory" / "archive"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    inbox = Path(args.inbox)
    if not inbox.is_dir():
        print(f"[ingest] inbox が無い: {inbox}（何もしない）")
        return
    asyncio.run(ingest(inbox, Path(args.archive), args.dry_run))


if __name__ == "__main__":
    main()
