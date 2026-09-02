# Agent UI Development

→ [outline.md](outline.md)

## 目的

Codex DesktopまたはClaudeから、開発中の`task-manage`をインタラクティブに操作し、人間も同じ画面を継続的に確認するための開発モードです。決められたE2Eシナリオを再生する用途ではなく、画面修正と状態確認を短いサイクルで繰り返す用途を想定しています。

通常の開発起動、配布アプリ、GitHub ActionsのE2Eはこのモードを使用しません。

## 確認経路

```text
ソース変更 ── Vite HMR ──> 実際のElectronウィンドウ <── 人間が目視
                                      ^
                                      |
Codex / Claude ── Playwright MCP ── CDP (127.0.0.1:9222)
```

| 要素 | 役割 |
| --- | --- |
| Electronウィンドウ | 製品と同じrenderer、preload、IPCを実行し、人間が確認する |
| Vite | rendererの変更をHot Module Replacementで反映する |
| CDP | 明示的な開発モードに限り、実行中Electronをローカル操作可能にする |
| Playwright MCP | accessibility snapshot、クリック、入力、console確認、screenshotを行う |

`http://localhost:5173`を通常のブラウザタブで開くだけでは、Electronのpreload bridgeがありません。静的な見た目の参考にはなりますが、Workspace、添付、詳細ウィンドウなどIPC依存の動作確認には使わないでください。

## 初回セットアップ

`.node-version`と`package.json`に指定されたNode.js 22を使用し、依存関係をインストールします。

```bash
npm ci
```

### Codex Desktop

信頼済みプロジェクトの`.codex/config.toml`に次を追加します。新規作成なら[`.codex/config.toml.example`](../.codex/config.toml.example)をコピーできます。既存ファイルには、ほかのローカル設定を残したままこのセクションだけを追加してください。

```toml
[mcp_servers.task_manage_ui]
command = "node"
args = ["node_modules/@playwright/mcp/cli.js", "--cdp-endpoint=http://127.0.0.1:9222"]
startup_timeout_sec = 20
```

Codex Desktopを再起動し、MCP servers画面で`task_manage_ui`が有効なことを確認します。リポジトリ直下の[`AGENTS.md`](../AGENTS.md)に標準手順があるため、以後の新規チャットも同じ手順を自動的に参照できます。

### Claude Code

リポジトリの[`.mcp.json`](../.mcp.json)に同じ接続を定義済みです。プロジェクト設定を承認し、`task-manage-ui`が有効なことを確認します。

## 毎回の起動と確認

リポジトリルートで、作業中ずっと維持するターミナルを起動します。

```bash
npm run dev:web
```

Viteが`localhost:5173`、ElectronのCDPが`127.0.0.1:9222`を使用します。別ターミナルまたはagentから、起動完了を最大30秒待って確認します。

```bash
npm run verify:agent-ui -- --wait=30000
```

機械可読な確認結果が必要なら次を使用します。

```bash
npm run verify:agent-ui -- --wait=30000 --json
```

`5173`を別プロセスが使用している場合、Viteは別ポートへ自動退避せずエラーにします。Electron側の固定URLと食い違ったまま起動することを防ぐためです。終了時は`dev:web`のターミナルで`Ctrl+C`を押します。`npm run dev:agent`は互換エイリアスです。

## LLMによる低トークン確認

1. Playwright MCPのaccessibility/DOM snapshotで現在の要素と状態を読む。
2. 対象のクリック、入力、キーボード操作を行う。
3. 再度snapshotとconsole messageを確認する。
4. レイアウト、色、重なり、切れ、位置ずれなど、視覚判断が必要な場合だけscreenshotを取得する。
5. 修正後はVite HMRを待ち、同じElectronウィンドウで対象操作だけを再確認する。

複数ウィンドウが開いた場合は、Playwright MCPのtab一覧から対象を選びます。OSのファイルピッカー、Explorer、ネイティブメニューなどElectron外部の画面はCDPでは操作できません。人間が操作するか、専用E2Eで代替します。

## 新規チャットでの開始文

通常は[`AGENTS.md`](../AGENTS.md)が自動的に手順を伝えます。明示したい場合は、次の短い依頼で十分です。

> `AGENTS.md`のGUI確認手順に従い、`dev:web`を起動または再利用して実Electron画面を操作してください。変更後は人間が見ている同じ画面で動的に確認してください。

agentが`verify:agent-ui`の成功を確認できない、または`task_manage_ui` MCPを利用できない場合は、画面状態を推測せず、起動または設定の不足を報告します。

## 安全性とCIへの影響

- CDPは`dev:web` / `dev:agent`から明示的に起動した場合だけ有効です。
- 接続先はloopbackの`127.0.0.1`に固定します。
- 配布済みアプリでは有効化を拒否します。
- `PLAYWRIGHT_TEST=true`の自動E2E環境では有効化を拒否します。
- GitHub Actionsは従来どおりbuild、unit/component、Playwright E2Eを実行し、`dev:web`は起動しません。
- Playwright MCPは開発依存関係なので、配布ファイルには含まれません。

WindowsとLinuxのどちらでも同じnpmコマンドを使用できます。Linuxで人間がウィンドウを見る場合はデスクトップセッションが必要です。GitHub Actionsのheadlessなxvfb E2Eは、このインタラクティブ開発経路とは独立しています。
