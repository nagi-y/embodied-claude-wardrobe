#!/usr/bin/env bash
# 動画編集ワークフローの前提ツールを確認する。
# 使い方: bash setup.sh [--install]   (--install で不足分のインストールを試みる)
set -u

INSTALL=0
[ "${1:-}" = "--install" ] && INSTALL=1
OK=1

note() { printf '  %s\n' "$1"; }

check() { # check <コマンド> <説明> <インストールヒント>
  if command -v "$1" >/dev/null 2>&1; then
    echo "[ok] $1 — $2"
  else
    echo "[NG] $1 が見つからない — $2"
    note "→ $3"
    OK=0
    return 1
  fi
}

echo "== 必須 =="
if ! check ffmpeg "動画の切り出し・結合・カラーグレーディング" "macOS: brew install ffmpeg / Debian系: sudo apt-get install -y ffmpeg"; then
  if [ "$INSTALL" = 1 ]; then
    if command -v apt-get >/dev/null 2>&1; then
      (sudo apt-get update && sudo apt-get install -y ffmpeg) || apt-get install -y ffmpeg
    elif command -v brew >/dev/null 2>&1; then
      brew install ffmpeg
    fi
    command -v ffmpeg >/dev/null 2>&1 && { echo "[ok] ffmpeg をインストールした"; OK=1; }
  fi
fi
check uv "transcribe.py の実行（faster-whisper を自動取得）" "https://docs.astral.sh/uv/getting-started/installation/"

echo
echo "== 文字起こし依存の事前取得（Whisper モデル本体は初回実行時に取得される）=="
if command -v uv >/dev/null 2>&1; then
  if uv run "$(dirname "$0")/transcribe.py" --check; then
    echo "[ok] faster-whisper 準備完了"
  else
    echo "[NG] faster-whisper の取得に失敗（ネットワークを確認）"
    OK=0
  fi
fi

echo
echo "== オプション（Remotion / デザイン連携）=="
check node "Remotion（React ベースの動画 UI）" "https://nodejs.org/ または brew install node" || true
note "Remotion プロジェクトの作成: npx create-video@latest"
note "Figma 連携: Figma MCP を .mcp.json に追加（ガイド参照）"

echo
if [ "$OK" = 1 ]; then
  echo "準備完了。docs/guides/video-editing-workflow.md の手順で開始できる。"
else
  echo "不足あり。上記の NG を解消してから再実行: bash setup.sh"
  exit 1
fi
