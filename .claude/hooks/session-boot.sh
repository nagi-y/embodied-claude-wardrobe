#!/bin/bash
# session-boot.sh — セッション開始時の身支度フック
# SessionStart(startup|resume) で発火する
# SOUL.md と state.md の内容をコンテキストに注入し、BOOT_SHUTDOWN.md の身支度手順を案内する
# stdout の内容がコンテキストに追加される

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# --- matcher を JSON stdin から取得 ---
INPUT=$(cat)
MATCHER=$(echo "$INPUT" | grep -o '"matcher":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null)

echo "[session-boot] type=${MATCHER:-unknown}"
echo ""

# --- wardrobe-self（個人リポジトリ）同期 ---
# WARDROBE_SELF_REPO が未設定なら graceful skip。
# clone/pull に成功すると SOUL.md/state.md 等が symlink で流し込まれ、以降の注入に乗る。
if [ -x "$PROJECT_DIR/.claude/scripts/self-sync.sh" ]; then
  /bin/bash "$PROJECT_DIR/.claude/scripts/self-sync.sh" pull 2>&1 | sed 's/^/  /'
  echo ""
fi

# --- SOUL.md 注入 ---
if [ -f "$PROJECT_DIR/SOUL.md" ]; then
  echo "--- SOUL.md ---"
  cat "$PROJECT_DIR/SOUL.md"
  echo ""
  echo "--- end SOUL.md ---"
  echo ""
else
  echo "[SOUL.md が見つかりません。/wd-setup を実行してください]"
  echo ""
fi

# --- state.md 注入 ---
if [ -f "$PROJECT_DIR/state.md" ]; then
  echo "--- state.md ---"
  cat "$PROJECT_DIR/state.md"
  echo ""
  echo "--- end state.md ---"
  echo ""
fi

# --- ROUTINES.md 注入 ---
if [ -f "$PROJECT_DIR/ROUTINES.md" ]; then
  echo "--- ROUTINES.md ---"
  cat "$PROJECT_DIR/ROUTINES.md"
  echo ""
  echo "--- end ROUTINES.md ---"
  echo ""
fi

# --- 身支度の案内 ---
echo "SOUL.md と state.md は自動注入済み。BOOT_SHUTDOWN.md の身支度手順に従い、残りを実行してください。"
