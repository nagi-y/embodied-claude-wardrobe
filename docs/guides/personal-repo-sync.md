# 個人リポジトリ同期ガイド（wardrobe-self）

> システム（この配布リポジトリ）と個人データ（人格・記憶・状態）を分離し、
> 個人データを別の private リポジトリ `wardrobe-self` で永続化する。
> これにより本体リポジトリは配布可能になり、ephemeral なリモート/web 環境でも身体が連続する。

設計の背景は [`docs/plans/personal-repo-split.md`](../plans/personal-repo-split.md) を参照。

---

## なぜ必要か

リモート（Claude Code on the web）のコンテナは **ephemeral** で、セッション終了で破棄される。
個人ファイル（SOUL.md / state.md / FLASH.md / TODO.md / `.claude/memories/`）は `.gitignore` 済みなので、
何もしなければ web セッション中に書いた記憶・状態は消える。

個人データを別 private リポジトリに退避し、boot 時に pull / 終了時に push することで、
コンテナをまたいで「自分」が連続する。

---

## 非対称 writer モデル

sqlite はバイナリでマージ不能なので、**DB の書き手を1つに固定**する。

| | local ロール（常駐環境） | remote ロール（web/ephemeral） |
|---|---|---|
| sqlite DB | **唯一の writer**。commit/push する | sparse-checkout で除外。触らない・push しない |
| 記憶 draft (`memory/inbox/`) | 読んで DB に ingest → archive | `.md` を積む（write-only） |
| 書き戻し | default ブランチへ直 push | session ブランチ + draft PR（レビューゲート） |

記憶の流れ:

```
[remote] /wd-remember
   → DB（破棄される） + memory/inbox/<ts>.md（個人リポジトリへ）
   → /wd-sync push（session ブランチ + PR）
[人間] PR を merge
[local] 起動 → /wd-sync ingest（inbox → DB → archive）→ /wd-sync push（DB を commit）
```

---

## 個人リポジトリの構成

```
wardrobe-self/   (private)
  SOUL.md  state.md  FLASH.md  TODO.md  ROUTINES.md
  conf/        desires.conf  schedule.conf
  memory/
    db/        # sqlite。local だけが commit
    inbox/     # 記憶 draft。誰でも積める。local が ingest
    archive/   # ingest 済み
```

> `state.md` は環境ごとに `## self (local)` / `## self (remote)` の小節を併記し、
> 各環境は自分の小節だけ書き換える（行衝突を避け auto-merge しやすくする）。

---

## セットアップ

### 1. 個人リポジトリを作る

`wardrobe-self`（任意の名前）を **private** で作成し、上記の構成で初期化する。

### 2. 環境を設定する

**ローカル環境** — `self-sync.conf.sample` を `self-sync.conf` にコピーして編集:

```bash
cp self-sync.conf.sample self-sync.conf
# WARDROBE_SELF_REPO="you/wardrobe-self"
# WARDROBE_SELF_ROLE="local"
```

**リモート/web 環境** — gitignore されたファイルは ephemeral コンテナで再現されないため、
[Claude Code on the web の環境変数設定](https://code.claude.com/docs/en/claude-code-on-the-web) に入れる:

```
WARDROBE_SELF_REPO=you/wardrobe-self
WARDROBE_SELF_ROLE=remote
```

認証は `GH_TOKEN`（web では自動で存在）またはローカルの git credential helper を使う。

### 3. 確認

```
/wd-sync status
```

`repo` と `role` が表示され、`token: present` なら準備完了。

---

## 日常の運用

- **boot** — session-boot が自動で `self-sync.sh pull` を実行し、個人ファイルを symlink で流し込む
- **記憶** — `/wd-remember` が remote ロールでは inbox にも draft を積む
- **セッション終了** — `/wd-sync push` で state/FLASH/TODO/inbox を書き戻す（BOOT_SHUTDOWN.md 第七手）
- **local 起動時** — `/wd-sync ingest` でリモートが積んだ記憶を DB に取り込む

---

## 注意・前提

- 個人リポジトリは必ず **private**。
- リモートの clone/pull/push はネットワークポリシーに依存する。直接 GitHub に到達できないポリシーでは無効。
- token が無い環境では push/PR はできない（`/wd-sync status` で `token: absent`）。pull / inbox 退避は可能。
- 既存の実体ファイルがあった場合、symlink 化の際に `*.pre-sync.bak` へ退避される。
- `WARDROBE_SELF_REPO` 未設定なら全コマンドが graceful skip するので、同期を使わない場合も本体は普通に動く。
