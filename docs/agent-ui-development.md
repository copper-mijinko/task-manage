# Agent GUI 開発・検証

→ [outline.md](outline.md)

## 目的と境界

この手順は、Codex Desktop または Claude Code が開発中の task-manage を実 Electron 上で対話的に確認するためのものです。通常ブラウザで `http://localhost:5173` を開いても preload bridge と Electron IPC がないため、GUI/runtime 検証にはなりません。

```text
source edit
  -> dev:agent（Vite + 実 Electron）
  -> Electron CDP 127.0.0.1:9222
  -> Playwright MCP
  -> accessibility/DOM snapshot
  -> 操作
  -> snapshot + console 確認
  -> 必要なら再修正
```

Codex Browser、Browser skill、Claude の通常 Browser 操作、Chrome、通常の browser tab は、この経路の代替として使用しません。Electron または MCP が利用できない場合もフォールバックせず、`GUI verification: unavailable` として不足条件を報告します。

この interactive Agent GUI と、Linux/Xvfb を含む自動 Playwright E2E は別の仕組みです。前者は修正中の実機確認、後者は回帰テストであり、相互の代替ではありません。

## 構成

| 構成要素 | 責務 |
| --- | --- |
| `npm run dev:agent` | Agent 向けの canonical command。Vite の agent mode と実 Electron を同時に起動する |
| `scripts/agent-ui-launch.mjs` | 開発起動時の環境差を吸収する（ヘッドレス時の Xvfb、root 実行時の `--no-sandbox`、CDP port の二重起動回避） |
| `npm run dev:web` | 現在は `dev:agent` と同一実装の互換 alias。既存プロセスがあれば再利用できる |
| `npm run verify:agent-ui` | Vite、CDP、task-manage renderer、Electron identity、preload bridge の準備状態を診断する |
| Electron CDP | agent mode のときだけ `127.0.0.1:9222` で実 Electron renderer を公開する |
| Playwright MCP | CDP に接続し、snapshot、操作、console、必要な screenshot を提供する |

## 初回セットアップ

`.node-version` と `package.json` に従い、Node.js 22.12 以上かつ major 22 を使います。

```text
npm ci
```

### Codex Desktop

リポジトリの `.codex/config.toml.example` に次の設定があります。新規環境では `.codex/config.toml` に取り込み、Codex Desktop を再起動して `task_manage_ui` が利用可能なことを確認します。既存のローカル設定は上書きせず、この section だけを統合します。

```toml
[mcp_servers.task_manage_ui]
command = "node"
args = ["node_modules/@playwright/mcp/cli.js", "--cdp-endpoint=http://127.0.0.1:9222"]
startup_timeout_sec = 20
```

Codex の共通作業ルールはリポジトリ直下の `AGENTS.md` にあります。MCP がロードされていない場合、通常 Browser では代替せず、設定不足として報告します。

### Claude Code

Claude Code は `CLAUDE.md` から `@AGENTS.md` を読み、Codex と同じ共通ルールを適用します。Playwright MCP は project-local の `.mcp.json` に定義済みで、サーバー名は `task-manage-ui` です。プロジェクト MCP の承認またはクライアント再起動が必要な場合があります。

## 毎回の起動と診断

**順序が重要です。Agent UI を先に起動し、そのあとで Playwright MCP を接続します。** どちらの client も session 開始時に MCP server へ接続するため、`127.0.0.1:9222` が listen していない状態で始まった session では、その server はその session の間ずっと接続失敗のままになります。MCP が failed / closed と表示された場合は、まず依存関係と起動順序を直し、そのうえで MCP を再接続（Codex は MCP server の再読み込み、Claude Code はプロジェクト MCP 設定の再承認または session 再起動）します。

既存の Agent UI プロセスが正常なら再利用します。なければリポジトリ root の継続する terminal で起動します。

```text
npm run dev:agent
```

`dev:agent` は開発起動時の環境差を自分で吸収します。

- `$DISPLAY` が無い環境では `Xvfb` を 1 つ起動し、その display を Electron にだけ渡す（`Xvfb` が無い場合は警告のみ）
- root 実行では `--no-sandbox` を付与する（Electron は root で `--no-sandbox` なしの起動を拒否する）
- `127.0.0.1:9222` が既に listen している場合は Electron を起動せず、既存プロセスの再利用を促す

いずれも `vite.config.js` の開発 plugin 経由でのみ適用され、`npm run start` 単体や package build、CI には影響しません。

別 terminal から最大 30 秒待って readiness を確認します。

```text
npm run verify:agent-ui -- --wait=30000
```

machine-readable output が必要な Agent は `--json` を加えます。

```text
npm run verify:agent-ui -- --wait=30000 --json
```

成功時の `checks` は、Vite、CDP、Electron user agent、`window.electronAPI` の必須 method を個別に示します。失敗時は `errorCode`、`stage`、`timedOut`、`details` を返します。

| 主な `errorCode` | 意味 | 対応 |
| --- | --- | --- |
| `NODE_VERSION_UNSUPPORTED` | Node.js の version が対象外 | major 22、minor 12 以上へ切り替える |
| `MCP_PACKAGE_MISSING` | repository-local Playwright MCP がない | `npm ci` を実行する |
| `VITE_UNAVAILABLE` | Vite の 5173 endpoint がない | `npm run dev:agent` の出力と port を確認する |
| `CDP_UNAVAILABLE` | Electron CDP に接続できない | Electron 起動、9222 の競合、agent mode を確認する |
| `RENDERER_NOT_FOUND` | CDP はあるが task-manage renderer がない | stale process を停止し Agent UI を再起動する |
| `NOT_ELECTRON` | target が Electron と識別できない | 通常 Browser を使わず Agent UI を再起動する |
| `PRELOAD_MISSING` | `window.electronAPI` がない、または不完全 | preload/main process の error を確認し再起動する |
| `RENDERER_NOT_READY` | renderer document が操作可能状態でない | 起動完了を待って再実行する |

`--wait` の期限まで準備できない場合は、最後の根本原因を保持したまま `timedOut: true` になります。exit code だけでなく diagnostic を読んで対処します。

## MCP が使えないときの fallback

MCP 経路が優先です。依存関係と起動順序を直しても MCP client を接続できない session に限り、同じ CDP endpoint に Playwright から直接接続して実 Electron renderer を操作できます。

```js
import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
```

満たしている条件は MCP 経路と同じ（実 Electron renderer、preload bridge、IPC が生きている状態）です。通常 Browser や Vite URL への直接アクセスで代替することは引き続き禁止です。この fallback を使った場合は、MCP ではなく直接 CDP 接続で確認した旨とその理由を最終回答に明記します。

## 標準操作フロー

1. Playwright MCP の accessibility/DOM snapshot を取得し、task-manage のメイン画面であることを確認する。
2. Workspace、project、task、detail window など変更対象に対応する操作を行う。
3. 操作後の snapshot と console message を確認する。
4. レイアウト、色、位置、切れ、重なりなど視覚判断が必要な場合だけ screenshot を取得する。
5. source を修正し、renderer の変更は Vite HMR を待つ。`electron/**`（preload、main process、startup、window creation）は HMR の対象外なので、変更したら必ず `dev:agent` を再起動してから確認する。
6. 同じ操作を繰り返し、修正結果と新しい重大 error がないことを確認する。

確認対象は CSS だけではありません。Svelte UI、preload、IPC、workspace 読み書き、task detail window、memo、attachment、image、startup、window creation、cache、filesystem interaction、error handling、体感性能・responsiveness も user operation に影響するため対象です。純粋な document や runtime に影響しない変更は省略でき、その理由を最終回答に記載します。

## 最終回答

`AGENTS.md` に従い、毎回次のいずれかを明記します。

- `GUI verification: performed` — 実 Electron で行った操作と結果
- `GUI verification: skipped` — runtime/UI に影響しないため省略した理由
- `GUI verification: unavailable` — Electron、CDP、preload、MCP の不足条件

## Security と production/CI

Agent CDP は `TASK_MANAGE_AGENT_UI=true` かつ `VITE_DEV=true` の明示的な開発 mode だけで有効になり、address は loopback の `127.0.0.1` に固定されます。`app.isPackaged` または `PLAYWRIGHT_TEST=true` では無効です。通常利用、production/package build、自動 E2E では有効化しません。

Electron の context isolation、sandbox、navigation 制限など既存 hardening は維持します。Playwright MCP は devDependency のままとし、外部 network へ CDP を公開しません。GitHub Actions には interactive な `dev:agent` / `dev:web` を追加せず、既存の build、unit/component、Playwright E2E を維持します。
