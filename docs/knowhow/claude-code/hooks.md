# Claude Code Hooks — 最新仕様まとめ

> 出典: https://code.claude.com/docs/en/hooks + CHANGELOG 1.0.0〜2.1.167 (2026-06-06 取得)

## 導入・進化の経緯

| バージョン | 変更 |
|---|---|
| 1.0.38 | hooks リリース |
| 1.0.41 | Stop/SubagentStop 分離、timeout 設定、hook_event_name 追加 |
| 1.0.48 | PreCompact フック追加 |
| 1.0.54 | UserPromptSubmit フック追加、cwd を入力に追加 |
| 1.0.58 | CLAUDE_PROJECT_DIR 環境変数追加 |
| 1.0.59 | PermissionDecision を hooks に公開（"ask" 含む） |
| 1.0.62 | SessionStart フック追加 |
| 1.0.85 | SessionEnd フック追加 |
| 2.0.10 | PreToolUse で updatedInput（ツール入力の書き換え）が可能に |
| 2.0.30 | prompt ベースの stop hooks 追加 |
| 2.0.37 | Notification フックに matcher 追加 |
| 2.0.43 | SubagentStart フック追加、agent frontmatter に hooks 対応 |
| 2.0.45 | PermissionRequest フック追加 |
| 2.1.0 | skill/slash command frontmatter に hooks 対応、once: true、additionalContext |
| 2.1.9 | PreToolUse で additionalContext 返却可能 |
| 2.1.10 | Setup フック追加（--init, --maintenance） |
| 2.1.33 | TeammateIdle, TaskCompleted フック追加 |
| 2.1.47 | last_assistant_message が Stop/SubagentStop 入力に追加 |
| 2.1.49 | ConfigChange フック追加、WorktreeCreate/WorktreeRemove フック追加 |
| 2.1.63 | HTTP フック追加（URL に POST/JSON） |
| 2.1.69 | InstructionsLoaded フック追加、agent_id/agent_type をフック入力に追加 |
| 2.1.85 | 条件付き `if` フィールド追加 |
| 2.1.133 | フック入力に `effort.level` フィールドと `$CLAUDE_EFFORT` 環境変数を追加 |
| 2.1.139 | `args: string[]` フィールド追加（exec form: シェルを介さずコマンド起動） |
| 2.1.141 | hook JSON 出力に `terminalSequence` フィールド追加（デスクトップ通知・ウィンドウタイトル用） |
| 2.1.143 | Stop フックの最大ブロック回数を8回に制限（`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`） |
| 2.1.152 | PostToolUse: `continueOnBlock: true` で拒否理由をモデルに返して続行可能に |
| 2.1.152 | SessionStart: `reloadSkills: true` でスキル再スキャン、`hookSpecificOutput.sessionTitle` でセッションタイトル設定可能 |
| 2.1.163 | Stop/SubagentStop: `hookSpecificOutput.additionalContext` でフィードバックを返してターンを継続可能に |

## イベント一覧（27種類）

| イベント | 発火タイミング | ブロック可能 | matcher 対象 |
|---|---|---|---|
| Setup | --init/--maintenance 時 | - | - |
| SessionStart | セッション開始/再開 | - | startup, resume, clear, compact |
| SessionEnd | セッション終了 | - | clear, logout, other |
| UserPromptSubmit | ユーザー入力前処理 | Yes | - |
| PreToolUse | ツール実行前 | Yes | ツール名 |
| PostToolUse | ツール成功後 | Yes | ツール名 |
| PostToolUseFailure | ツール失敗後 | - | ツール名 |
| PermissionRequest | パーミッションダイアログ表示時 | Yes | - |
| Stop | Claude 応答完了時 | Yes | - |
| StopFailure | API エラー時 | - | rate_limit, authentication_failed |
| SubagentStart | サブエージェント起動 | - | エージェント型 |
| SubagentStop | サブエージェント終了 | Yes | エージェント型 |
| TaskCreated | タスク作成 | Yes | - |
| TaskCompleted | タスク完了 | Yes | - |
| TeammateIdle | チームメイト待機 | Yes | - |
| Notification | 通知送信 | - | permission_prompt, idle_prompt |
| InstructionsLoaded | CLAUDE.md 読込 | - | - |
| ConfigChange | 設定ファイル変更 | Yes | user_settings, project_settings |
| CwdChanged | 作業ディレクトリ変更 | - | - |
| FileChanged | 監視ファイル変更 | - | ファイル名 |
| WorktreeCreate | ワークツリー作成 | Yes | - |
| WorktreeRemove | ワークツリー削除 | - | - |
| PreCompact | コンパクト前 | - | - |
| PostCompact | コンパクト後 | - | - |
| Elicitation | MCP ユーザー入力要求 | Yes | - |
| ElicitationResult | MCP ユーザー入力応答 | Yes | - |

## フックタイプ（4種類）

| タイプ | 追加時期 | 説明 | 主なフィールド |
|---|---|---|---|
| command | 1.0.38 | シェルコマンド実行 | command, async, shell |
| http | 2.1.63 | HTTP POST | url, headers, allowedEnvVars |
| prompt | 2.0.30 | LLM プロンプト検証 | prompt, model |
| agent | 2.0.30 | エージェント型検証 | prompt, model |

### `args: string[]` — exec form（2.1.139〜）

`command` フィールドの代わりに `args` を使うとシェルを介さずコマンドを起動する。
パスにスペースが含まれる場合やクォート問題を避けたいときに使う。

```json
{
  "type": "command",
  "args": ["/path/to/script.sh", "--flag", "value"]
}
```

## 条件付き `if` フィールド（2.1.85〜）

ツールイベント（PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest）でのみ有効。
プロセス生成を避け、パターンマッチだけでフック実行を条件分岐できる。

```json
{
  "type": "command",
  "if": "Bash(rm *)",
  "command": "validate.sh"
}
```

パターン例:
- `"Bash"` — 全 Bash コマンド
- `"Edit|Write"` — Edit または Write
- `"Bash(git *)"` — git コマンド
- `"Edit(*.ts)"` — TypeScript ファイル編集
- `"mcp__memory__.*"` — memory MCP の全ツール

## PreToolUse の高度な出力

- `permissionDecision`: allow/deny/ask (1.0.59〜)
- `updatedInput`: ツール入力の書き換え (2.0.10〜)
- `additionalContext`: モデルへの追加コンテキスト (2.1.9〜)

## PostToolUse — continueOnBlock（2.1.152〜）

`continueOnBlock: true` を返すと、ブロック理由を Claude に渡してターンを継続できる。
単純に止めるのではなく「なぜ禁止か」を伝えて修正を促す場合に有効。

```json
{
  "decision": "block",
  "reason": "このコマンドは許可されていません",
  "continueOnBlock": true
}
```

## SessionStart フックの高度な出力（2.1.152〜）

- `reloadSkills: true`: フック実行後にスキルディレクトリを再スキャン
- `hookSpecificOutput.sessionTitle`: セッションタイトルをプログラムで設定

## Stop/SubagentStop — additionalContext（2.1.163〜）

`hookSpecificOutput.additionalContext` を返すことで、Stop フックがフィードバックをモデルに渡しながらターンを継続させられる。
単にブロックするのではなく「まだやることがある」と伝えて作業を続けさせる。

## エフォートレベル（2.1.133〜）

フック入力に `effort` フィールドが追加された:
- `effort.level`: `low` / `medium` / `high` / `max`

環境変数でも参照可能:
- `$CLAUDE_EFFORT`: 現在のエフォートレベル

## Stop/SubagentStop の入力

- `last_assistant_message`: 最後のアシスタント応答テキスト (2.1.47〜)
- `agent_id`, `agent_transcript_path`: サブエージェント情報 (2.0.42〜)
- `effort.level`: エフォートレベル (2.1.133〜)

## Stop フックのブロック上限（2.1.143〜）

Stop フックが繰り返しブロックし続ける場合、最大8回でブロックを終了する。
上限は `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` 環境変数でオーバーライド可能。

## 環境変数

全フックで使える:
- `CLAUDE_PROJECT_DIR` — プロジェクトルート (1.0.58〜)
- `CLAUDE_CODE_REMOTE` — リモート環境なら "true"
- `CLAUDE_EFFORT` — 現在のエフォートレベル (2.1.133〜)
- `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` — Stop フック最大ブロック回数（デフォルト: 8）(2.1.143〜)

SessionStart/CwdChanged/FileChanged で追加:
- `CLAUDE_ENV_FILE` — 環境変数永続化ファイル

フック入力に含まれる追加フィールド:
- `agent_id`, `agent_type` (2.1.69〜)
- `worktree` (2.1.69〜): name, path, branch, original repo dir
- `effort.level` (2.1.133〜): low / medium / high / max

## once: true（2.1.0〜）

セッション内で1回だけ実行するフック。

## disableAllHooks（1.0.68〜）

全フックを無効化。managed settings が設定した hooks は非managed から無効化できない (2.1.49〜)。

## Exit Code

| Code | 意味 | 動作 |
|---|---|---|
| 0 | 成功 | JSON 処理、ツール実行許可 |
| 2 | ブロック | ツール中断/拒否/停止ブロック |
| その他 | エラー | 実行継続（stderr 表示） |

## 設定ファイル優先順

1. `~/.claude/settings.json`（ユーザー）
2. `.claude/settings.json`（プロジェクト）
3. `.claude/settings.local.json`（ローカル）
4. Managed policy（管理者）
5. Plugin hooks
6. Skill/Agent frontmatter

## ワードローブ固有のメモ

- 現在 settings.json に未登録のフック: statusline.ts, continue-check.sh
- SessionStart(startup) で SOUL.md + state.md を注入する SessionStart フックが実装済み
- `if` フィールドを使えば interoception.sh の条件付き実行が可能（プロセス生成を回避）
- `CLAUDE_ENV_FILE` を使えば SessionStart で環境変数を永続化できる
- `http` タイプフック (2.1.63〜) を使えばシェル不要で外部 API にイベント送信可能
- `last_assistant_message` (2.1.47〜) で Stop hook から応答テキストを直接取得可能（continue-check.sh の改善に使える）
- `InstructionsLoaded` (2.1.69〜) で CLAUDE.md 読み込み時にカスタム処理が可能
- hooks の timeout デフォルトは 10分 (2.1.3〜、以前は60秒)
- `continueOnBlock: true` (2.1.152〜) を continue-check.sh に使うと Stop ブロック後もターンを継続できる
- `effort.level` (2.1.133〜) を interoception に含めると覚醒度と組み合わせた身体状態が豊かになる
- `SessionStart` から `reloadSkills: true` を返す (2.1.152〜) ことで動的スキル生成が可能に
- `args: string[]` (2.1.139〜) でスクリプトパスにスペースがあっても安全に呼び出せる
- Stop フックが無限ブロックに入らないよう上限 8 が設定された (2.1.143〜)。continue-check.sh も影響を受ける
