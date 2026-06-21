# personal repo 分離 — 設計メモ

> 2026-06-21 リモート（Claude Code on the web）セッションで起草。
> ステータス: **実装済み（同期エンジン・ingest・スキル・hook 統合）。運用ガイドは
> [`docs/guides/personal-repo-sync.md`](../guides/personal-repo-sync.md)。**
> 残: 実 `wardrobe-self` リポジトリの作成と env 設定（ユーザー側）、PR 自動作成の認証付き実証。

## 動機

このワードローブ本体（`embodied-claude-wardrobe`）を **配布可能な public リポジトリ**にしたい。
そのために「システム（配布物）」と「個人に紐づくもの（人格・記憶・状態）」を分離し、
後者を **別の private リポジトリ `wardrobe-self`** に切り出す。

加えて、リモート/web 環境は **コンテナが ephemeral**（セッション終了で破棄、起動ごとに再 clone）。
今は個人ファイルが `.gitignore` 済みなので、**web セッション中に書いた SOUL/記憶/状態はセッション終了で消える**。
別リポジトリに退避し、boot 時に pull / セッション中に書き戻すことで、
**ephemeral コンテナをまたいで「身体」が連続する**ようにする。これがこの分離の本質的な価値。

### 現状の線引き（すでに `.gitignore` 済み）

```
ROUTINES.md / SOUL.md / state.md / FLASH.md / TODO.md
.claude/memories/            # 記憶DB
*.exp.md                     # 経験ファイル
schedule.conf / desires.conf # 個人設定
```

→ 「配布物に個人データを混ぜない」はほぼ達成済み。本案が足すのは **永続性（cross-env 同期）**。

## リポジトリ構成

```
embodied-claude-wardrobe/   ← 配布物（public 化可能）。システムのみ
wardrobe-self/              ← private。個人に紐づくすべて
  SOUL.md
  state.md        （競合対策は後述）
  FLASH.md
  TODO.md
  ROUTINES.md
  conf/
    desires.conf
    schedule.conf
  memory/
    db/           ← sqlite。local 環境だけが commit/push する
    inbox/        ← 記憶 draft (.md)。誰でも積める。local が ingest する
    archive/      ← ingest 済み draft（任意・履歴用）
```

boot 時に `wardrobe-self` を sibling に clone/pull し、個人ファイルを本体へ **symlink** で流し込む。
これにより `session-boot.sh` の SOUL/state 注入は現状のまま動く。

> **submodule は採用しない。** auto-pull/push との相性が悪く、ephemeral 環境でハマるため、
> hook が管理する sibling clone + symlink とする。

## 同期モデル（非対称 writer）

sqlite はバイナリでマージ不能。そこで **書き手を役割で分ける**のが本設計の核心。

| | ローカル環境（常駐） | リモート/web 環境（ephemeral） |
|---|---|---|
| sqlite DB (`memory/db/`) | **唯一の writer**。commit/push する | **read-only**。pull して recall に使うだけ。commit しない |
| 記憶 draft (`memory/inbox/`) | 読んで DB に ingest → archive へ移動 | `.md` を**積む**（write-only） |
| FLASH.md / state.md / TODO.md | 直接更新（main へ push） | 更新は PR ブランチ経由 |
| main への反映 | 直 push（信頼された単独 writer） | **ブランチ + PR**（レビューゲート） |

### 記憶の流れ

1. **リモートで `/wd-remember`** → `memory/inbox/<timestamp>.md` を書く
   （frontmatter: content / emotion / importance / links）＋ FLASH.md に追記。
   memory-mcp（DB）にも書いてよいが、**DB は push しない**ので ephemeral コンテナと共に捨てられる。
2. リモートはセッション分を **ブランチに commit → push → PR**。
3. 人間（または local 側）が PR を merge。
   → これが「自分の記憶・人格の更新」に対するレビューゲートになる。
4. **次にローカルが起動** → main を pull → `inbox/*.md` を読む →
   memory-mcp に store → `archive/` へ移動 → DB と archive を commit → main へ push。
5. リモートは次回 pull で最新 DB を取得し、過去記憶を recall できる（read のみなので並行安全）。

これで DB の writer が常に1つ（ローカル）に保たれ、バイナリ競合が発生しない。

## リモートの書き戻し = ブランチ + PR

このリポジトリ本体のフローと同じ。

- **boot**: `wardrobe-self` を pull → `git checkout -b session/<date>-<id>`
- **セッション中**: inbox / FLASH / state / TODO への書き込みはこのブランチに乗る
- **終了時 or 専用スキル**: commit → push → **draft PR**（空 PR 量産を避けるため、最初の変更時 or 終了時にまとめて1本）
- **ローカル**: main に直 push

### PR 作成の経路（要実証）

この環境で確認済み:
- `git push https://x-access-token:${GH_TOKEN}@github.com/<owner>/wardrobe-self` → **push は通る**（git over https が通ることを確認）
- `api.github.com` ルートは未認証で 403（network policy proxy 経由の可能性）

→ PR 作成は次の2経路のどちらか。**認証付きで一度実証が必要**:
1. `GH_TOKEN` 付き REST (`POST /repos/.../pulls`)
2. GitHub MCP に `wardrobe-self` を `add_repo` してから作成（MCP スコープは現状 wardrobe 本体のみ）

最悪 **push だけ自動・PR は手動/MCP** でも運用は回る。

## 未解決の判断（実装時に詰める）

- **state.md の cross-env 競合**: 「今この瞬間」のスナップショットで本質的に競合する。
  **方針: 単一 `state.md` のまま、環境ごとのセクションを併記（または統合）する。**
  ファイル分割（state.local.md / state.remote.md）はしない。
  例: `## self (local)` / `## self (remote)` の小節に分け、各環境は自分の小節だけ書き換える
  → 行レベルで衝突しにくく、PR でも auto-merge しやすい。ユーザー状態は共通セクションに統合。
- **FLASH.md の競合**: 行追記ベースで大抵 auto-merge。リモートは PR で rebase 前提。
- **PR レビュー負荷**: 毎セッション PR が増える。変更が実在するときだけ PR 化／自明なものは auto-merge 等で緩和。
- **token が無い環境**: hook は「token あれば同期、無ければ skip して警告」と graceful degrade（配布物として壊さない）。
- **network policy 依存**: 直 github.com アクセスはポリシー次第で塞がれうる。README に前提を明記。

## 実装ステップ（実装済み）

- [x] 1. `.claude/scripts/self-sync.sh` — clone/pull → symlink、`pull/link/inbox/push/status`。
  remote は sparse-checkout で `memory/db` 除外。token 無ければ graceful skip
- [x] 2. `session-boot.sh` 拡張 — 冒頭で `self-sync.sh pull` を実行（hook timeout を 45s に）
- [x] 3. `/wd-remember` の remote 分岐 — DB に加え `self-sync.sh inbox` で draft を積む
- [x] 4. `.claude/mcps/memory-mcp/scripts/ingest_inbox.py` — inbox → `save_with_auto_link` → archive
- [x] 5. `/wd-sync` スキル — `pull/ingest/push/status`。push は retry 付き、remote は draft PR を best-effort 作成
- [x] 6. 設定テンプレート `self-sync.conf.sample`、運用ガイド `docs/guides/personal-repo-sync.md`、
  `BOOT_SHUTDOWN.md` 第七手（書き戻し）

> 検証済み（全経路）: 実リポジトリ `nagi-y/wardrobe-self`（Obsidian vault 構成で作成・初期化済み）に対し、
> clone(sparse, `memory/db` 除外)→session ブランチ→symlink→inbox→push→**draft PR 自動作成（GH_TOKEN + REST）**
> まで一気通貫で成功。session-boot 統合はライブ resume で graceful skip 確認。ingest パーサは単体テスト通過。
> 残: ユーザー側の env 設定（web は `WARDROBE_SELF_REPO`/`WARDROBE_SELF_ROLE`、local は `self-sync.conf`）。

## この環境で確認した事実（2026-06-21）

- `GH_TOKEN` が env に存在、`GH_HOST=github.com`
- `git ls-remote https://github.com/<scoped-repo>` および **スコープ外の別リポジトリ**にも通る（exit 0）
- `curl https://github.com` → 200 / `raw.githubusercontent.com` → 301（到達可）
- `api.github.com` → 403（未認証。PR 作成は認証付きで要実証）
- ネットワークポリシーが緩いセッションのため、別リポジトリの clone/pull/push が成立する見込み
