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

Node には本文、画像・添付ファイル、タグを保存できます。Inbox は素早い入力を受け付けます。

## Storage and migration

ワークスペースは、ノード 1 つにつき Markdown ファイル 1 つで保存されます（人も生成 AI もそのまま読み書きできます）。

```text
<workspace>/_workspace.md                 ワークスペースのルート
<workspace>/<project>/_project.md         プロジェクトのルート
<workspace>/<project>/<node-id>/_index.md ノード（本文 + frontmatter）
<workspace>/<project>/<node-id>/assets/       本文に貼った画像
<workspace>/<project>/<node-id>/attachments/  添付ファイル
<workspace>/.task-manage/                 元に戻す履歴・ごみ箱・グラフビューの座標（アプリの作業用）
```

親子関係（複数の親・親ごとの並び順・アーカイブ）は各ファイルの frontmatter の `parents:` に入っているので、グラフの機能（複数の親、循環、リンク、コピーの 3 モード、Undo/Redo）は従来どおり使えます。編集のたびに書き換わるのは、変えたノードのファイルだけです。

旧 Markdown 形式のワークスペースは、そのまま開けます。旧メモを整理したいときは、ワークスペース管理ダイアログの「旧形式のフォルダーを変換...」で、別の空のフォルダーへ変換して書き出せます（移行のための一時的な機能。詳細は [docs/data.md](docs/data.md) § 7.3）。以前の版の単一 JSON（`.task-manage/graph-v1.json`）は、開いたときに一度だけ Markdown へ変換します（元のファイルは消さず、`graph-v1.json.migrated` として残します）。

アプリの外でファイルを編集したときは、ワークスペース管理ダイアログの「ディスクから読み込み直す」で反映します。アプリが最後に読み書きした内容と違うファイルは、上書きせずにエラーにします。

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
- `npm run check` — 型検査を実行します（TS は strict、JS と Electron の main プロセスは checkJs）。
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
- [docs/how-to-contribute.md](docs/how-to-contribute.md) — 開発と貢献の手順（リリースの手順は [Release](docs/how-to-contribute.md#release) 節）
- [docs/agent-ui-development.md](docs/agent-ui-development.md) — Agent UI の開発手順
