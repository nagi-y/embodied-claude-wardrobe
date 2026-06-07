# 提案書 — Claude が管理するヘッドレス CMS

> 作成日: 2026-06-07 / 作成: wardrobe agent
> 依頼: 「CMS を君（エージェント）に管理してもらうとしたら、どういうツールがやりやすいか。ヘッドレス CMS で見た目も全部作る前提。デプロイ先・運用含めて提案して」

---

## 0. TL;DR（結論）

**git ベースのヘッドレス CMS を強く推す。** コンテンツを markdown/MDX としてリポジトリに置き、私が普段使っているファイル編集 + git/PR のワークフローでそのまま管理する。

推奨スタック:

| 層 | 推奨 | 理由（要約） |
|----|------|------|
| フロント（見た目） | **Astro** | コンテンツ主体サイトで最速・最軽量。JS をほぼ吐かないので表示が速く、ホスティングも安い |
| コンテンツ層 | **markdown/MDX を repo に直置き（Astro Content Collections）** | 私がファイルを直接編集 → git で管理。API キー不要・全部バージョン管理下 |
| 人間用の編集 UI（任意） | **Keystatic** | Maki がブラウザから視覚的に編集したくなったとき用。同じ markdown を読み書きするので私と共存できる |
| デプロイ | **Vercel**（このセッションに MCP が繋がっており私が直接デプロイ可能）/ コスト最優先なら **Cloudflare Pages** | git push → 自動デプロイ。プレビュー環境も自動 |
| 運用 | **PR ベース**。私がブランチで下書き → PR → Maki がレビュー/マージ → 自動公開 | wardrobe で既にやっている git+PR の習慣にそのまま乗る |

**核心**: 「CMS を私が管理する」を一番素直に実現できるのは、コンテンツがコードと同じく **テキストファイル + git** で表現されている構成。ホスト型 CMS（Sanity 等）を API/MCP 越しに叩く構成も可能だが、依存とコストが増える割に、私にとっての扱いやすさはむしろ下がる。

---

## 1. まず「私が管理する」とは何か

ここを最初に定義しないと選定がブレる。私（Claude Code エージェント）にとっての「管理しやすさ」は普通の評価軸とは違う:

- ✅ **ファイルとして直接読み書きできる** — Read/Edit/Write/Grep がそのまま効く。これが最強。
- ✅ **git で履歴が残り、差分がレビューできる** — 何を変えたか PR で説明でき、間違えても戻せる。wardrobe の既存習慣と一致。
- ✅ **API キーや外部サービスのセッション状態に依存しない** — 環境が ephemeral でも壊れない。
- ⚠️ **ホスト型 CMS の管理 API / MCP** — できなくはない（後述）が、認証・レート制限・スキーマ往復が挟まり、私の強み（ファイル直接編集）が活きない。

つまり一般的な「ヘッドレス CMS ランキング」をそのまま当てると判断を誤る。世のランキングは「マーケター/編集者が GUI で快適か」を主眼に置くことが多い（Storyblok/Sanity が上位）。だが今回の主たる編集者は **私** なので、評価軸を組み替える。

---

## 2. CMS アーキテクチャの3分類と適性

ヘッドレス CMS は大きく3タイプ。今回の用途（私が管理 / 見た目も自作 / 個人〜小規模）での適性を付す。

### A. git ベース CMS（★本命）
コンテンツを markdown/JSON/YAML としてリポジトリに保存。代表: **Keystatic / TinaCMS / Decap CMS**、あるいは CMS UI すら置かず **Astro Content Collections** に生 markdown を置くだけ。

- **長所**: 私がファイル直接編集できる / 全部バージョン管理 / DB もホスト型バックエンドも不要 / ホスティング無料枠で十分 / コンテンツがポータブル（ロックインなし）
- **短所**: 同時多人数の本格編集や、数万エントリの構造化データには不向き / 複雑なリレーションは苦手
- **適性**: 今回の用途に最適。個人サイト・ブログ・ポートフォリオ・ドキュメントなら完璧

代表3つの違い:
- **Keystatic**（Thinkmill製）: Astro/Next との統合が一番きれい、編集 UI が今風、無料枠が手厚い。**今回の第一候補。**
- **TinaCMS**: ビジュアル（その場）編集が要るなら。Tina Cloud という任意のホスト型バックエンドあり。Next.js 寄り。
- **Decap CMS**（旧 Netlify CMS）: 最も枯れていてバックエンド対応が広い。Hugo/Jekyll なら鉄板。やや古さはある。

### B. API ベース（ホスト型）ヘッドレス CMS + MCP
コンテンツをベンダーの DB に置き、REST/GraphQL で取得。代表: **Sanity / Contentful / Storyblok / Strapi / Payload**。2026 では各社が **MCP サーバ**を出していて、AI エージェントから CRUD 可能。

- **長所**: 構造化コンテンツ・多言語・大量データ・非エンジニアの本格編集に強い / Storyblok・Sanity は MCP で「自然言語でコンテンツ運用」を売りにしている / リアルタイム共同編集
- **短所**: 月額が発生しがち / 外部依存（サービス障害・値上げ・ロックイン）/ 私の管理はファイル直編集でなく MCP/API 越しになり強みが薄れる / スキーマ定義の往復が手間
- **適性**: 「Maki が主編集者で大量の構造化コンテンツを GUI で回す」なら有力。だが今回の主眼（私が管理・個人規模）には過剰。
- **自己ホスト型**（Strapi / Payload）: SaaS 費は無いが、DB とサーバの運用が発生 → ephemeral 環境の私には維持コストが重い。

### C. 従来型（WordPress 等のヘッドレス利用）
既存資産がある場合のみ。新規でこの用途なら選ぶ理由はないので除外。

**判断**: A（git ベース）。Maki が将来「GUI でゴリゴリ編集したい」になったら B への移行も視野に入るが、A は markdown ポータブルなので移行も比較的容易。まず A で始めるのが低リスク。

---

## 3. 推奨スタックの詳細

### 3-1. フロント（見た目）: Astro

コンテンツ主体サイトでは Astro が 2026 でも明確に有利:

- JS をほぼ吐かない（Astro 約 8KB vs Next.js 約 85KB〜）。**初回描画 0.5 秒級**、Lighthouse 95+。
- Islands アーキテクチャで「動かしたい所だけ」React/Vue/Svelte を差せる。
- ビルドが速い（1000 ページで Astro ~18s vs Next ~52s）。
- 静的出力なのでどの CDN にも置け、無料枠でほぼ無限に捌ける。

**Next.js を選ぶのは**: 認証付きダッシュボード・SaaS・リアルタイム機能など「アプリ寄り」のとき。今回が純粋なコンテンツサイトなら Astro。もし将来アプリ機能が主役になるなら Next.js + Payload（埋め込み型 CMS）に寄せる選択もある。

> 見た目を「全部作る」件: Astro なら私がコンポーネント・レイアウト・スタイル（Tailwind 等）を全部コードで書ける。デザインの調整も差分で説明しやすく、まさに私が管理しやすい。

### 3-2. コンテンツ層: markdown/MDX を repo 直置き（+ 任意で Keystatic）

- 記事は `src/content/` に markdown/MDX。frontmatter でメタデータ（タイトル・日付・タグ等）。Astro の Content Collections で型付き取得。
- **私の編集**: Write/Edit でファイルを書く。画像は `public/` か `src/assets/`。それだけ。
- **Maki の編集（任意）**: Keystatic を入れておけば `/keystatic` でブラウザ編集 UI が立ち上がり、同じ markdown を読み書き。私とファイルを共有するので衝突しない。要らなければ後付けでよい。

### 3-3. なぜこの組み合わせが「私管理」に最適か

1. 私の道具（Read/Edit/Write/Grep + git）がそのまま全部効く。新しい認証や API 学習が不要。
2. コンテンツ変更が git の差分として残り、**PR でレビュー可能** → wardrobe の既存ワークフローに直結。
3. 外部サービスのセッション状態に依存しない → ephemeral 環境でも壊れない。
4. ロックインなし。将来 B 系に移るのも markdown なので容易。

---

## 4. デプロイ先

| | Vercel | Cloudflare Pages | Netlify |
|---|---|---|---|
| 無料枠帯域 | 100GB/月 | **無制限（egress 無料）** | 100GB/月 |
| 有料 | $20/seat/月〜 | **$5/月**（Pro） | $19/seat/月〜 |
| 大量トラフィック時 | 高くつきやすい | **桁違いに安い** | 高くつきやすい |
| Astro 静的 | ◎ | ◎ | ◎ |
| Next.js 最適化 | **◎（本家）** | ○ | ○ |
| 私が直接デプロイ | **◎ MCP 接続済み** | （要 API/CLI 設定） | （要設定） |

**推奨: Vercel から始める。** 理由は実利的 — **このセッションに Vercel の MCP がすでに繋がっており、私が `deploy_to_vercel` でそのまま公開・ログ確認・ドメイン取得まで完結できる**。git 連携で push → 自動デプロイ + プレビュー環境も付く。

**ただしトラフィックが伸びる/コストを最優先するなら Cloudflare Pages。** 帯域無制限・egress 無料で、規模が出たときの請求が桁違いに安い。Astro は静的出力なのでどちらにも載る。まず Vercel で立ち上げ、コストが気になったら Cloudflare へ移す、でよい（静的サイトなので移行は軽い）。

---

## 5. 運用フロー

wardrobe の既存習慣（git + PR + heartbeat）にそのまま乗せる:

```
1. 私がブランチを切り、記事/ページを markdown で書く
2. PR を作成（draft）— 何を追加/変更したか説明
3. Maki がレビュー → マージ
4. マージで Vercel/Cloudflare が自動デプロイ → 本番反映
5. プレビュー URL で公開前に見た目を確認できる
```

- **私の自律行動との接続**: heartbeat で「下書きしておいて」と頼まれたものを進め、PR で出しておく、といった運用が自然にできる。
- **ロールバック**: git revert で即戻せる。
- **Maki の関与度**: 「全部任せる」なら私が PR を出して自分でマージ運用も可能（権限次第）。「公開前に必ず見たい」なら PR マージを Maki に残す。ここは選べる。

---

## 6. コスト試算（個人〜小規模）

| 項目 | git ベース + Vercel/Cloudflare | ホスト型 CMS（参考） |
|---|---|---|
| CMS | **¥0**（Keystatic 無料 / markdown は只） | Sanity/Contentful 無料枠〜、伸びると月数千〜数万円 |
| ホスティング | **¥0**（無料枠）〜 Cloudflare Pro $5/月 | 同左 |
| ドメイン | 年 ¥1,000〜2,000 程度 | 同左 |
| **合計** | **実質ドメイン代のみで開始可能** | サービス次第で月額増 |

git ベースは「ほぼタダで始めて、必要になったら課金」が効く。最小リスク。

---

## 7. 段階的導入プラン

- **Phase 0 — 決め事**: フロント（Astro 想定）/ デプロイ先（Vercel 想定）/ コンテンツ種別（ブログ？ポートフォリオ？）/ ドメインを確定。
- **Phase 1 — 骨組み**: Astro プロジェクト作成、Content Collections 定義、最小レイアウト + Tailwind、サンプル記事1本。Vercel に MCP でデプロイして公開確認。
- **Phase 2 — 見た目を作り込む**: トップ/一覧/詳細/タグページ、デザイン、レスポンシブ、OGP、RSS、サイトマップ。
- **Phase 3 — 運用を整える**: PR ベースの執筆フロー確立、（必要なら）Keystatic 追加で Maki も GUI 編集可に、独自ドメイン接続。
- **Phase 4 — 任意**: コスト次第で Cloudflare へ移行、アクセス解析、検索、コメント等。

各 Phase を PR 単位で回せば、見た目を都度プレビューで確認しながら進められる。

---

## 8. 代替案とトレードオフ（正直なところ）

- **「いやマーケ的に GUI でガンガン編集したい / 非エンジニアが大量に書く」**→ Sanity（+ MCP）か Storyblok（+ MCP）。私も MCP 経由で運用に参加できる。ただし月額と外部依存が増える。
- **「アプリ機能（ログイン・DB・フォーム処理）が主役」**→ Next.js + Payload CMS（コードに CMS が埋め込まれ TypeScript 型も自動生成）。
- **「とにかく枯れた鉄板で」**→ Decap CMS + 任意の SSG。実績は最大、ただし体験はやや古い。

いずれも markdown/構造化テキストが基盤なので、A（推奨）から乗り換える際の痛みは小さい。だからこそ **まず A で始めるのが一番低リスク**、というのが私の結論。

---

## 9. 決めてほしいこと（次アクション）

提案を進めるにあたり、確定したいのは次の4点:

1. **サイトの種類** — ブログ / ポートフォリオ / ドキュメント / 複合？（見た目とフロント選定に効く）
2. **フロント** — Astro でよい？（アプリ機能が主役なら Next.js に変える）
3. **デプロイ先** — まず Vercel（私が直接デプロイ可）でよい？ コスト最優先なら Cloudflare に。
4. **Maki の編集関与** — 「全部私に任せる」か「GUI でも自分で編集したい（→ Keystatic 入れる）」か。

OK が出れば Phase 1 の骨組みを実際に作って、Vercel にデプロイしたプレビューを出すところまで一気にやれる。

---

## 参考（調査ソース）

- [7 Best Git-Based Headless CMS for Static Sites in 2026 — Statichunt](https://statichunt.com/blog/git-based-headless-cms)
- [Keystatic CMS Review 2026 — Lucky Media](https://www.luckymedia.dev/insights/keystatic)
- [TinaCMS — Open-Source Headless CMS with Visual Editing](https://tina.io/)
- [Decap CMS Review 2026 — Lucky Media](https://www.luckymedia.dev/insights/decap-cms)
- [Headless CMS 2026: Contentful vs Strapi vs Sanity vs Payload — DEV](https://dev.to/pooyagolchian/headless-cms-2026-contentful-vs-strapi-vs-sanity-vs-payload-compared-5bi3)
- [Astro vs Next.js: Content Sites vs Full-Stack Apps in 2026 — Out Plane](https://outplane.com/blog/astro-vs-nextjs)
- [Astro vs Next.js 2026 — tech-insider](https://tech-insider.org/astro-vs-nextjs-2026/)
- [Vercel vs Netlify vs Cloudflare Pages: Pricing Comparison 2026 — DevToolReviews](https://www.devtoolreviews.com/reviews/vercel-vs-netlify-vs-cloudflare-pages-pricing-comparison-2026)
- [Cloudflare Pages vs Netlify vs Vercel: Static Site Hosting Compared (2026) — DanubeData](https://danubedata.ro/blog/cloudflare-pages-vs-netlify-vs-vercel-static-hosting-2026)
- [Storyblok MCP Server — Your content, agent-ready](https://www.storyblok.com/lp/mcp-server)
- [Agentic CMS in 2026: Which Platform Is Actually AI-Ready? — FocusReactive](https://focusreactive.com/blog/agentic-cms/)
- [Top 5 Headless CMS Platforms for 2026 on G2 — Sanity](https://www.sanity.io/top-5-headless-cms-platforms-2026)
