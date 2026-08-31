# Agent UI Development

→ [outline.md](outline.md)

## 目的

この開発モードは、Codex Desktop や Claude Code から実行中の `task-manage` をインタラクティブに操作しながら、人間が同じ Electron ウィンドウを継続して確認するためのものです。決められた E2E シナリオを再生する用途ではなく、画面修正、状態確認、追加修正を短いサイクルで繰り返す用途を想定しています。

通常の開発起動、配布アプリ、GitHub Actions の E2E はこのモードを使用しません。

## 構成

```text
ソース変更 ── Vite HMR ──> 実際の Electron ウィンドウ <── 人間が目視
                                      ^
                                      |
Codex / Claude ── Playwright MCP ── CDP (127.0.0.1:9222)
```

各要素の役割は次のとおりです。

| 要素 | 役割 |
| --- | --- |
| Electron ウィンドウ | 製品と同じ renderer と preload / IPC を実行し、人間が確認する画面になる |
| Vite | renderer の変更を Hot Module Replacement で反映する |
| CDP | 明示的な agent 開発モードだけで、実行中の Electron をローカル操作可能にする |
| Playwright MCP | accessibility snapshot を中心に画面構造を読み、クリックや入力を行う |

## 初回セットアップ

Node.js 22 を使用して依存関係をインストールします。

```bash
npm ci
```

### Codex Desktop

信頼済みプロジェクトの `.codex/config.toml` に次を追加し、Codex Desktop の MCP servers 画面から再起動します。プロジェクト設定はローカル専用で、リポジトリにはコミットしません。

```toml
[mcp_servers.task_manage_ui]
command = "node"
args = ["node_modules/@playwright/mcp/cli.js", "--cdp-endpoint=http://127.0.0.1:9222"]
startup_timeout_sec = 20
```

再起動後、`/mcp` または MCP servers 画面で `task_manage_ui` が有効であることを確認します。

### Claude Code

リポジトリの [`.mcp.json`](../.mcp.json) に同じ Playwright MCP 接続を定義済みです。プロジェクト設定を承認し、`/mcp` で `task-manage-ui` が有効であることを確認します。

## 起動と確認

リポジトリルートで次を実行します。

```bash
npm run dev:web
```

このコマンドは Vite と実際の Electron アプリを起動し、CDP を `127.0.0.1:9222` にだけ公開します。接続確認は別のターミナルで実行できます。

```bash
npm run verify:agent-ui
```

成功時は renderer の URL と CDP endpoint が表示されます。終了するときは `dev:web` を実行したターミナルで `Ctrl+C` を押します。`npm run dev:agent` も互換エイリアスとして同じ動作をします。

ポートが使用中の場合だけ、両方のコマンドで同じ環境変数を指定します。

```powershell
$env:TASK_MANAGE_CDP_PORT = "9333"
npm run dev:web
```

この場合は Codex / Claude の MCP 引数も `--cdp-endpoint=http://127.0.0.1:9333` に合わせます。

## LLM による確認方法

通常は次の順序にすると、画像を毎回送るより少ないトークンで修正できます。

1. Playwright MCP の accessibility snapshot で現在の要素と状態を読む。
2. 対象のクリック、入力、キーボード操作を行う。
3. 再度 snapshot と console message で動作を確認する。
4. レイアウト、色、重なりなど視覚判断が必要な時だけ screenshot を取得する。
5. ソース修正後は Vite HMR の反映を待ち、同じ Electron ウィンドウで確認を続ける。

複数の Electron ウィンドウが開いた場合は、Playwright MCP の tab 一覧から対象を選びます。OS のファイルピッカー、Explorer、ネイティブメニューなど Electron 外部の画面は CDP では操作できないため、人間が操作するか、専用の E2E で代替します。

## 安全性と CI への影響

CDP は実行中アプリを強力に操作できるため、agent 開発中だけ有効にします。実装には次のガードがあります。

- `npm run dev:web`（または互換エイリアスの `dev:agent`）から明示的に起動した場合だけ有効になる。
- 接続先は loopback の `127.0.0.1` に固定する。
- 配布済みアプリでは起動を拒否する。
- `PLAYWRIGHT_TEST=true` の自動 E2E 環境では起動を拒否する。
- ポートは `1024` から `65535` の整数だけを受け付ける。

GitHub Actions の workflow は変更しません。CI は従来どおり `npm run test:e2e` で Playwright の Electron API を使用し、`dev:web` / `dev:agent` や CDP endpoint は起動しません。Playwright MCP は開発依存関係なので配布ファイルにも含まれません。

Windows と Linux のどちらでも Node.js / Vite / Electron の同じコマンドを使用できます。Linux で人間がウィンドウを見る場合はデスクトップセッションが必要です。GitHub Actions の headless な `xvfb` E2E は、このインタラクティブ開発モードとは独立しています。
