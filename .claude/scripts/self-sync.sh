#!/bin/bash
# self-sync.sh — wardrobe-self（個人リポジトリ）同期エンジン
#
# システム（この配布リポジトリ）と個人データ（人格・記憶・状態）を分離し、
# 個人データを別 private リポジトリ wardrobe-self で永続化するための同期ツール。
#
# 非対称 writer モデル:
#   local  ロール = sqlite DB の唯一の writer。default ブランチへ直 push。inbox を ingest する。
#   remote ロール = inbox に draft を積むだけ。DB は sparse-checkout で除外し push しない。
#                   書き戻しは session ブランチ + PR。
#
# サブコマンド:
#   pull            clone/pull して個人ファイルを本体へ symlink（session-boot から呼ばれる）
#   link            symlink の張り直しのみ
#   inbox <text>    記憶 draft を memory/inbox/ に積む（remote ロール用。/wd-remember から）
#   push [message]  個人リポジトリ側の変更を commit/push。remote は PR も作成（best-effort）
#   status          現在の設定と状態を表示
#
# 設定の解決順: 環境変数 → self-sync.conf → デフォルト
# 個人リポジトリが未設定（WARDROBE_SELF_REPO が空）なら何もせず正常終了する（graceful skip）。

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CONF_FILE="$PROJECT_DIR/self-sync.conf"
BRANCH_MARKER="$PROJECT_DIR/.claude/.self-branch"

log() { echo "[self-sync] $*"; }

# --- 設定の解決（env を優先し、無ければ conf、無ければデフォルト） ---
resolve_config() {
  # conf ファイルの値は env が未設定のときだけ採用する
  if [ -f "$CONF_FILE" ]; then
    # shellcheck disable=SC1090
    set -a; source "$CONF_FILE"; set +a
  fi
  SELF_REPO="${WARDROBE_SELF_REPO:-}"
  SELF_DIR="${WARDROBE_SELF_DIR:-$HOME/wardrobe-self}"
  SELF_ROLE="${WARDROBE_SELF_ROLE:-remote}"
  SELF_BASE="${WARDROBE_SELF_BASE:-main}"
  SELF_BRANCH_PREFIX="${WARDROBE_SELF_BRANCH_PREFIX:-session}"
}

enabled() {
  [ -n "$SELF_REPO" ]
}

# --- 認証付き URL を組み立てる（GH_TOKEN があれば埋め込む） ---
remote_url() {
  local host="${GH_HOST:-github.com}"
  if [ -n "${GH_TOKEN:-}" ]; then
    echo "https://x-access-token:${GH_TOKEN}@${host}/${SELF_REPO}.git"
  else
    echo "https://${host}/${SELF_REPO}.git"
  fi
}

# --- 本体へ流し込む個人ファイルの対応表（本体パス|個人リポジトリ内パス） ---
# ディレクトリ symlink は末尾に / を付けない。memory/db はロールに応じて扱う。
link_map() {
  cat <<'MAP'
SOUL.md|SOUL.md
state.md|state.md
FLASH.md|FLASH.md
TODO.md|TODO.md
ROUTINES.md|ROUTINES.md
desires.conf|conf/desires.conf
schedule.conf|conf/schedule.conf
.claude/memories|memory/db
MAP
}

# --- symlink を張る（既存の実体はバックアップしてから） ---
create_links() {
  local mapping src dst target
  while IFS='|' read -r dst src; do
    [ -z "$dst" ] && continue
    target="$SELF_DIR/$src"
    local linkpath="$PROJECT_DIR/$dst"
    mkdir -p "$(dirname "$target")" "$(dirname "$linkpath")"
    # 既に正しい symlink ならスキップ
    if [ -L "$linkpath" ] && [ "$(readlink "$linkpath")" = "$target" ]; then
      continue
    fi
    # 実体（非 symlink）が存在したら退避
    if [ -e "$linkpath" ] && [ ! -L "$linkpath" ]; then
      mv "$linkpath" "${linkpath}.pre-sync.bak"
      log "backed up existing $dst → ${dst}.pre-sync.bak"
    fi
    # 古い symlink は消す
    [ -L "$linkpath" ] && rm -f "$linkpath"
    ln -s "$target" "$linkpath"
  done < <(link_map)
  log "symlinks linked into $PROJECT_DIR"
}

# --- remote ロールのセッションブランチ名（コンテナ内で固定） ---
session_branch() {
  if [ -f "$BRANCH_MARKER" ]; then
    cat "$BRANCH_MARKER"
    return
  fi
  local id
  id="$(date -u +%Y%m%d)-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  local name="${SELF_BRANCH_PREFIX}/${id}"
  echo "$name" > "$BRANCH_MARKER"
  echo "$name"
}

# --- remote ロールで DB を除外する sparse-checkout 設定 ---
apply_sparse() {
  git -C "$SELF_DIR" config core.sparseCheckout true
  git -C "$SELF_DIR" sparse-checkout init >/dev/null 2>&1 || true
  # memory/db 以外をすべて含める
  git -C "$SELF_DIR" sparse-checkout set --no-cone '/*' '!/memory/db' >/dev/null 2>&1 \
    || printf '/*\n!/memory/db/\n' > "$SELF_DIR/.git/info/sparse-checkout"
}

cmd_pull() {
  resolve_config
  if ! enabled; then
    log "disabled (WARDROBE_SELF_REPO 未設定のためスキップ)"
    return 0
  fi
  local url; url="$(remote_url)"

  if [ ! -d "$SELF_DIR/.git" ]; then
    log "cloning $SELF_REPO → $SELF_DIR (role=$SELF_ROLE)"
    if [ "$SELF_ROLE" = "remote" ]; then
      # DB を除外して浅く取得
      git clone --depth 1 --filter=blob:none --sparse "$url" "$SELF_DIR" 2>/dev/null \
        || git clone --depth 1 "$url" "$SELF_DIR" 2>/dev/null
      [ -d "$SELF_DIR/.git" ] && apply_sparse && git -C "$SELF_DIR" checkout HEAD -- . >/dev/null 2>&1 || true
    else
      git clone "$url" "$SELF_DIR" 2>/dev/null
    fi
    if [ ! -d "$SELF_DIR/.git" ]; then
      log "clone に失敗（token/ネットワーク/ポリシーを確認）。symlink はスキップ"
      return 0
    fi
  else
    git -C "$SELF_DIR" remote set-url origin "$url" 2>/dev/null
    git -C "$SELF_DIR" fetch --depth 1 origin "$SELF_BASE" 2>/dev/null \
      && git -C "$SELF_DIR" reset --hard "origin/$SELF_BASE" 2>/dev/null \
      || log "fetch に失敗。キャッシュを使用"
  fi

  # ブランチ選択
  if [ "$SELF_ROLE" = "remote" ]; then
    local br; br="$(session_branch)"
    git -C "$SELF_DIR" checkout -B "$br" 2>/dev/null && log "on session branch: $br"
  else
    git -C "$SELF_DIR" checkout "$SELF_BASE" 2>/dev/null || true
  fi

  create_links
  log "pull done (role=$SELF_ROLE)"
}

cmd_link() {
  resolve_config
  enabled || { log "disabled"; return 0; }
  [ -d "$SELF_DIR" ] || { log "$SELF_DIR が無い。先に pull せよ"; return 0; }
  create_links
}

cmd_inbox() {
  resolve_config
  enabled || { log "disabled — inbox draft は書けない"; return 0; }
  local content="$*"
  if [ -z "$content" ]; then
    content="$(cat)"  # stdin から
  fi
  [ -z "$content" ] && { log "内容が空"; return 1; }
  local inbox="$SELF_DIR/memory/inbox"
  mkdir -p "$inbox"
  local ts file
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  file="$inbox/${ts}.md"
  cat > "$file" <<EOF
---
created: ${ts}
source: ${WARDROBE_SELF_ROLE:-remote}
ingested: false
emotion: neutral
importance: 3
category: daily
---
${content}
EOF
  log "inbox draft 作成: memory/inbox/${ts}.md"
  echo "$file"
}

# --- PR を作成（best-effort。失敗したら compare URL を返す） ---
create_pr() {
  local branch="$1" title="$2"
  local host="${GH_HOST:-github.com}"
  if [ -z "${GH_TOKEN:-}" ]; then
    log "PR 自動作成は token 無しのため不可。手動で: https://${host}/${SELF_REPO}/compare/${SELF_BASE}...${branch}?expand=1"
    return 0
  fi
  local payload resp
  payload=$(printf '{"title":"%s","head":"%s","base":"%s","draft":true}' "$title" "$branch" "$SELF_BASE")
  resp=$(curl -sS -X POST \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.${host}/repos/${SELF_REPO}/pulls" \
    -d "$payload" 2>/dev/null)
  local prurl
  prurl=$(echo "$resp" | grep -o '"html_url"[ ]*:[ ]*"[^"]*"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
  if [ -n "$prurl" ]; then
    log "draft PR 作成: $prurl"
  else
    log "PR 自動作成に失敗（REST 応答を確認）。手動で: https://${host}/${SELF_REPO}/compare/${SELF_BASE}...${branch}?expand=1"
  fi
}

cmd_push() {
  resolve_config
  enabled || { log "disabled"; return 0; }
  [ -d "$SELF_DIR/.git" ] || { log "$SELF_DIR が clone されていない"; return 1; }
  local msg="${1:-wardrobe-self update $(date -u +%FT%TZ)}"

  # remote ロールは DB を絶対に commit しない（sparse でも保険でパスを除外）
  if [ "$SELF_ROLE" = "remote" ]; then
    git -C "$SELF_DIR" add -A -- ':!memory/db' 2>/dev/null || git -C "$SELF_DIR" add -A
  else
    git -C "$SELF_DIR" add -A
  fi

  if git -C "$SELF_DIR" diff --cached --quiet; then
    log "変更なし。push スキップ"
    return 0
  fi
  git -C "$SELF_DIR" commit -m "$msg" >/dev/null 2>&1 || { log "commit 失敗"; return 1; }

  local branch
  if [ "$SELF_ROLE" = "remote" ]; then
    branch="$(git -C "$SELF_DIR" rev-parse --abbrev-ref HEAD)"
  else
    branch="$SELF_BASE"
  fi

  local n=1 ok=0
  while [ $n -le 4 ]; do
    if git -C "$SELF_DIR" push -u origin "$branch" 2>/dev/null; then ok=1; break; fi
    log "push 失敗（$n 回目）。${n}s 後に再試行"
    sleep $((n * 2)); n=$((n + 1))
  done
  [ $ok -eq 1 ] || { log "push が 4 回失敗"; return 1; }
  log "pushed → $SELF_REPO@$branch"

  if [ "$SELF_ROLE" = "remote" ]; then
    create_pr "$branch" "$msg"
  fi
}

cmd_status() {
  resolve_config
  echo "repo  : ${SELF_REPO:-<未設定>}"
  echo "role  : $SELF_ROLE"
  echo "dir   : $SELF_DIR"
  echo "base  : $SELF_BASE"
  echo "token : $([ -n "${GH_TOKEN:-}" ] && echo present || echo absent)"
  if [ -d "$SELF_DIR/.git" ]; then
    echo "branch: $(git -C "$SELF_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    echo "inbox : $(ls "$SELF_DIR/memory/inbox" 2>/dev/null | wc -l | tr -d ' ') 件"
  else
    echo "state : not cloned"
  fi
  enabled || echo "→ disabled（WARDROBE_SELF_REPO を設定すると有効化）"
}

case "${1:-}" in
  pull)   cmd_pull ;;
  link)   cmd_link ;;
  inbox)  shift; cmd_inbox "$@" ;;
  push)   shift; cmd_push "$@" ;;
  status) cmd_status ;;
  *) echo "usage: self-sync.sh {pull|link|inbox <text>|push [message]|status}"; exit 1 ;;
esac
