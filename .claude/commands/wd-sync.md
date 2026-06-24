---
name: wd-sync
description: "wardrobe-self（個人リポジトリ）と同期する。記憶 draft の取り込み・状態の書き戻し・PR 作成。"
argument-hint: "[pull|push|ingest|status] (省略時は status)"
user_invocable: true
---

# /wd-sync — 個人リポジトリ wardrobe-self と同期する

システム（この配布リポジトリ）と個人データ（SOUL/state/FLASH/TODO/記憶）を分離し、
個人データを別 private リポジトリ `wardrobe-self` で永続化するための同期スキル。

非対称 writer モデル:
- **local ロール** — sqlite DB の唯一の writer。inbox を DB に ingest し、default ブランチへ直 push。
- **remote ロール**（web/ephemeral）— inbox に記憶 draft を積むだけ。DB は触らない。書き戻しは session ブランチ + PR。

エンジンは `.claude/scripts/self-sync.sh`、ingest は `.claude/mcps/memory-mcp/scripts/ingest_inbox.py`。
`WARDROBE_SELF_REPO` が未設定なら同期は無効（graceful skip）。

## 引数による分岐

### status（デフォルト）
現在の設定とロール・ブランチ・inbox 件数を表示する。

```
bash .claude/scripts/self-sync.sh status
```

### pull
個人リポジトリを clone/pull し、個人ファイルを本体へ symlink する。
通常は session-boot が自動実行するので、手動で張り直したいときに使う。

```
bash .claude/scripts/self-sync.sh pull
```

### ingest（local ロールのみ）
リモートが積んだ inbox draft を DB に取り込み、archive へ退避する。
取り込み後は push して DB を commit する。

```
WARDROBE_SELF_DIR="${WARDROBE_SELF_DIR:-$HOME/wardrobe-self}" \
  uv run --project .claude/mcps/memory-mcp python .claude/mcps/memory-mcp/scripts/ingest_inbox.py
bash .claude/scripts/self-sync.sh push "ingest inbox $(date -u +%F)"
```

不安なら先に `--dry-run` を付けて何が取り込まれるか確認する。

### push
個人リポジトリ側の変更（state/FLASH/TODO/inbox 等）を commit/push する。
- **remote ロール** — session ブランチへ push し、draft PR を作成する（token があれば自動、無ければ compare URL を案内）。
- **local ロール** — default ブランチへ直 push する。

```
bash .claude/scripts/self-sync.sh push "セッションの記録 $(date -u +%F)"
```

## いつ使うか

- **セッション終了時（日記）** — state.md を更新したあと `push` で書き戻す（BOOT_SHUTDOWN.md 参照）
- **local 環境の起動時** — リモートが積んだ記憶があれば `ingest` で取り込む
- **設定や同期状態の確認** — `status`

## 注意

- remote ロールでは DB は sparse-checkout で除外され、commit もされない。記憶は inbox 経由でのみ伝わる。
- token が無い環境では push/PR はできない。`status` で `token: absent` なら、ローカルの git 認証か `GH_TOKEN` を確認する。

入力: $ARGUMENTS
