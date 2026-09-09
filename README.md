# task-manage

`task-manage` は Electron と Svelte で作られた、ローカル保存型のワークスペース管理アプリです。

ワークスペース内のプロジェクト、タスク、メモはすべて同じ Node モデルで扱います。保護されたワークスペース root が1つあり、各 Node は複数の順序付き parent を持てます。これによりプロジェクトをまたぐリンクや共有された子孫を表現できます。グラフの cycle は保存できますが、自分自身への edge と重複 edge は作れません。

## Views and operations

- Graph は Node と edge の全体構造を表示し、配置を編集します。
- Tree は root からの階層を表示します。
- Finder は選択した parent ごとの子 Node を表示します。
- Gantt は status または start/due date を持つ Node を表示します。start と due の両方は bar、片方だけは point、status だけは `日付未設定` として表示します。status の省略と明示的な `Undefined` は区別されます。
- cycle は Tree/Finder で terminal reference として表示され、無限展開しません。
- edge には detach、move、link があります。root 以外の Node は Node 本体とその edge を削除できます。
- copy には Node only、direct children の共有、subgraph の3モードがあります。

Node には本文、画像・添付ファイル、タグを保存できます。Inbox は素早い入力を受け付け、Agenda は期限を持つ Node をまとめて表示します。

## Storage and migration

正規データは次の場所に保存されます。

```text
<workspace>/.task-manage/graph-v1.json
<workspace>/.task-manage/assets/<node-id>/...
```

初回読み込み時、既存のプロジェクト Markdown を一度だけ正規 graph に取り込みます。取り込みでは Node ID、親子関係、本文、タグ、画像・添付ファイルを保持します。以後はアプリを正規データの編集に使用してください。後から旧 Markdown を直接編集しても、正規 graph へ自動同期されません。

詳細は [node graph design](docs/node-graph-design.md) と [node graph verification](docs/node-graph-verification.md) を参照してください。

## Setup and scripts

Node.js 22.12 以上 23 未満を用意し、再現可能な依存関係をインストールします。

```bash
npm ci
```

主なコマンド:

- `npm run dev` — Vite の開発サーバーと開発用 Electron を起動します。
- `npm run dev:agent` — Electron Agent UI と Vite HMR を起動します。
- `npm run verify:agent-ui` — Agent UI の Vite、CDP、Electron、preload の準備状態を確認します。
- `npm run build` — renderer の production build を作成します。
- `npm run start` — build 済みアプリを Electron で起動します。
- `npm run lint` — ESLint を実行します。
- `npm run check` — Svelte/TypeScript の診断を実行します。
- `npm run format:check` — Prettier の整形状態を確認します。
- `npm run test` — Vitest の全テストを実行します。
- `npm run test:e2e` — build 後に Playwright E2E を実行します。
- `npm run test:all` — unit、component、E2E テストを順に実行します。

## Documentation

- [docs/specification.md](docs/specification.md) — 機能仕様
- [docs/data.md](docs/data.md) — データ形式と移行
- [docs/architecture.md](docs/architecture.md) — ソース構成
- [docs/performance.md](docs/performance.md) — 起動・読み込み・保存の性能
- [docs/testing.md](docs/testing.md) — テスト方針
- [docs/how-to-contribute.md](docs/how-to-contribute.md) — 開発と貢献の手順
- [docs/agent-ui-development.md](docs/agent-ui-development.md) — Agent UI の開発手順
