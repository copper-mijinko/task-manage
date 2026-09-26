# データ仕様

← [outline.md](outline.md)

## 1. 保存先

データはローカルファイルとして保存される。

- ワークスペースディレクトリ（利用者が選んだ任意のフォルダー）
  - `<workspace>/.task-manage/graph-v1.json` … ノードと親子関係の**正本**（§ 3）
  - `<workspace>/.task-manage/assets/<nodeId>/...` … 本文に貼った画像と添付ファイル（§ 4）
- `electron/meta.json`
  - テーマ・表示設定・登録済みワークスペースなど、アプリの設定（§ 2）
- `electron/window-state.json`
  - メインウィンドウの大きさ・位置・最大化状態。起動時に BrowserWindow を作る前へ読むため `meta.json` から分離している

`TASK_MANAGE_DATA_DIR` 環境変数が指定されている場合は、`electron/` 配下の保存先を当該ディレクトリへ切り替える。テスト時にはこの仕組みで保存先を分離する。

以前の版が使っていた `electron/db.json`（アプリ内プロジェクト）は読まない。ワークスペース直下の旧 Markdown プロジェクト（`<dir>/_project.md`）は取り込みの入力としてだけ読む（§ 7）。

## 2. meta.json

`meta.json` は、アプリの設定を持つオブジェクトである。main プロセスの `electron/settings-store.js` が起動時に読み、変更は少し待ってまとめて書く（一時ファイルへ書いてから置き換える）。壊れたファイルは消さずに `meta.json.broken-<時刻>` へ退避し、初期値で起動する。

```json
{
  "theme": "light",
  "workspaces": [{ "path": "C:\\Users\\me\\Tasks", "label": "Tasks" }],
  "activeWorkspace": "C:\\Users\\me\\Tasks",
  "preferences.date_time_format": "slash",
  "closed_paths_8e392450-20f7-479a-a7f2-38bdafb913df": [],
  "show_archived_8e392450-20f7-479a-a7f2-38bdafb913df": false
}
```

- `theme`
  - アプリ全体のテーマ（`"dark"` / `"light"`）。変わると開いている他のウィンドウにも反映する
- `workspaces` / `activeWorkspace`
  - 登録済みワークスペースと、いま開いているもの。新しいパスはフォルダー選択ダイアログで選ばれたものだけ登録できる（レンダラーが任意のパスを登録することはできない）
- `preferences.date_time_format`
  - 入力ショートカット（`Ctrl+;` / `Ctrl+:`）でテキスト入力に挿入される書式。`"slash"`（既定、`2026/05/26`）/ `"iso"`（`2026-05-26`）/ `"japanese"`（`2026年5月26日`）のいずれか
- `closed_paths_<スコープID>`
  - そのスコープ（開いているプロジェクト）で閉じている**行（経路）**の一覧
- `show_archived_<スコープID>`
  - アーカイブ済みを表示するか

ノードは親を複数持てるため、同じノードが親ごとに複数の行として現れる。開閉はノードではなく**行＝辺**ごとの状態なので、キーにはノード ID ではなくルートからの経路（`ルートID/親ID/子ID`）を使う。片方の親の下で閉じても、もう片方の親の下は開いたままになる。

## 3. graph-v1.json（正本）

ワークスペース 1 つにつき 1 ファイル。ノード集合・親子関係・リビジョン・元に戻す／やり直しの履歴を 1 つのスナップショットとして、一時ファイルへ書いてから置き換える（`atomicWriteFile`）。設計の背景は [node-graph-design.md](node-graph-design.md)。

```json
{
  "schemaVersion": 1,
  "graph": {
    "schemaVersion": 1,
    "workspaceId": "5b0c...",
    "rootId": "workspace-5b0c...",
    "inboxId": "7f1e...",
    "revision": 42,
    "nodes": {
      "workspace-5b0c...": { "id": "workspace-5b0c...", "name": "Tasks", "parents": [], "createdAt": "2026-09-01" },
      "p-web": {
        "id": "p-web",
        "name": "Web サイト",
        "status": "In Progress",
        "parents": [{ "id": "workspace-5b0c...", "order": 0 }],
        "createdAt": "2026-09-01"
      },
      "t-top": {
        "id": "t-top",
        "name": "トップページ実装",
        "status": "Open",
        "dueDate": "2026-10-01",
        "parents": [{ "id": "p-web", "order": 1 }, { "id": "t-design", "order": 0 }],
        "body": "# メモ\n\n本文",
        "format": "markdown",
        "tags": ["frontend"],
        "attachments": [],
        "createdAt": "2026-09-02"
      }
    }
  },
  "undo": [],
  "redo": []
}
```

### 3.1 ノード

| 欄 | 意味 |
| --- | --- |
| `id` | ワークスペース内で一意の不変 ID |
| `name` | 名前 |
| `status` | ステータス。省略は「ステータスなし」（§ 5） |
| `startDate` / `dueDate` | `YYYY-MM-DD`。両方あるときは `startDate <= dueDate` |
| `parents` | 親への辺の配列 `[{ id, order, archived?, archivedAt? }]`（§ 3.2） |
| `body` / `format` | 本文（§ 6） |
| `tags` | タグ。前後の空白・先頭の `#` を落とし、大文字小文字を無視して重複排除する |
| `attachments` | 添付 `[{ id, name, relativePath, size, modifiedAt? }]`（§ 4） |
| `archived` / `archivedAt` | ノードごとのアーカイブ（子孫へは伝播しない） |
| `createdAt` | 作成日 `YYYY-MM-DD` |
| `assetOwnerId` | このノードが画像・添付を読むディレクトリの持ち主。コピーしたノードは自分の id になる |
| `importSource` | 取り込んだプロジェクトのルートにだけ付く（例: `markdown:<元のルートID>`）。§ 7 の「取り込み済み」の判定に使う |

ルート（`rootId`）は親を持たず、削除・移動・複製・アーカイブできない。`inboxId` のノード（Inbox）も削除・アーカイブ・移動できない。

### 3.2 親子関係（辺）

- 辺は子側の `parents` に持つ。子は複数の親を持てる（多親）
- 並び順は**辺の属性**なので、親 id と組で `order` に持つ。同じノードが親ごとに違う位置を取れる
- 自己接続と、同じ親子の重複は保存できない
- 複数ノードからなる循環は保存できる（グラフビューからだけ作れる）。ツリーとファインダーは、いま辿っている経路の祖先に戻った時点で「循環参照」として打ち切る
- どのノードもルートから辿れる。辺の削除やノード削除で辿れなくなったまとまりには、ルートからの入口になる辺を決定的に補う（`repairRootReachability`）
- `archived` が付いた辺は「その親の下からだけ片付けた」ことを表す。ノード自体の `archived` とは独立

### 3.3 リビジョンと履歴

- 書き込みはワークスペースごとに 1 本の列に並ぶ（`electron/workspace-graph.js` の `enqueue`）
- レンダラーは操作のたびに、手元のグラフの `revision` を添えてコマンドを送る。ディスク上の `revision` と違えば `Workspace graph changed` で拒否し、何も書かない。レンダラーは最新を読み直して知らせる
- `undo` / `redo` の 1 段は「グラフ全体の写し」ではなく「戻すのに要るノードと欄だけ」のパッチ `{ nodes: { [id]: node | null }, fields: { [key]: { value } | null } }`。最大 50 段
- 新しい操作をするとやり直し履歴は捨てる。元に戻しても `revision` は増やす（古いリビジョンを持つ画面が上書きしないため）
- 読み出し結果は、ファイルの更新時刻と大きさが変わっていなければ読み直さない。別プロセスや同期ソフトが書き換えたら次の読み出しで取り込む

### 3.4 操作（コマンド）

操作はすべて main プロセスのグラフエンジン（`electron/workspace-graph-engine.js`）を通る。レンダラーはツリーや木の形を保存しない。

| コマンド | 意味 |
| --- | --- |
| `create-node` | 親の下にノードを作る |
| `update-node` | ノードの欄を変える |
| `link` / `detach` / `move` | 辺を足す／外す／付け替える（他の親と子孫の関係は残る） |
| `archive-edge` | その辺だけアーカイブ／復元する |
| `delete-node` | ノード自身とその辺を消す。子孫は消さない |
| `copy` | `node`（そのノードだけ）／`share-children`（直下の子を共有）／`subgraph`（子孫ごと） |
| `set-position` | グラフビューでの座標 |
| `batch` | 複数のコマンドを 1 つの操作（1 回の「元に戻す」）としてまとめる |

## 4. 画像と添付

- 置き場所は `<workspace>/.task-manage/assets/<nodeId>/`。本文に貼った画像も添付も、ノードに属する
- 本文からは `assets/<nodeId>/...` のワークスペース相対パスで参照する。プレビュー時は main プロセスが画像を読み、`data:` URL にして返す（`ws:resolve-graph-asset`）。画像以外は返さない
- 添付を一覧から外しても実ファイルは消さない。元に戻したときに添付を戻せるようにするため
- ノードをコピーすると、画像と添付の実体もコピー先のディレクトリへ写し、本文の参照を書き換える。元のノードを消してもコピーから使える
- パスは `assets/<assetOwnerId>/` の中だけを許し、外へ出る参照・シンボリックリンク経由の脱出は拒否する

## 5. ステータス

| 意味 | 保存値 |
| --- | --- |
| 進捗管理をしない | 省略（`status` 欄を書かない） |
| 進捗管理の対象だが、状態は未決定 | `Undefined` |
| 未着手 / 保留 / 進行中 / 完了 / キャンセル | `Open` / `Pending` / `In Progress` / `Completed` / `Canceled` |

### 5.1 「なし」は既定値ではなく状態のひとつ

同じツリーに「期限とステータスで追跡するノード」と「ただ書いてあるノード」が並ぶ。後者に既定のステータスを与えると、ノート 1 つ 1 つが「未着手」として積み上がり、ステータス列も絞り込みも意味を失う。だから「なし」は `Open` へのフォールバックではなく、対等な状態として扱う。

- **保存では欄ごと書かない。** 空文字を書くと、次に読んだとき「値がある」と「無い」を区別できなくなる
- **読みで `Open` を埋めない。** 日付を付けてもステータスを自動で付けない
- **レンダラー側では空文字**（`NO_STATUS`）で表す。ステータスは選択コントロールの値として往復するため。境界での変換は `tree_projection.js` の `projectTreeGrid`（省略 → `""`）と `nodeChanges`（`""` → 省略）の 2 箇所だけ
- 絞り込みは**完全一致**で見る。部分一致だと、あらゆる文字列が空文字を含むので「なし」で絞ったときに全行が残ってしまう
- 選択済みステータスを取り出すときに `filter(Boolean)` を使わないこと。「なし」は空文字なので落ちる
- 並べ替えでは「なし」を最後に置く
- 回帰テストは `tests/unit/no_status.test.ts`

## 6. ノードの本文

**1 つのメモ ＝ 1 つのノード。** ノードは本文を 1 つだけ持ち、複数の記録は子ノードで表す。

- `body` — 本文そのもの（Markdown なら文字列、Quill なら Delta）
- `format` — `"markdown"` または `"quill"`。省略時は `"markdown"`。新しく作るノードも `"markdown"`

### 6.1 形式の変換

- **個別変換**：ノード詳細の「形式を変換」で Markdown ⇄ Quill を切り替える。中身があるときは、装飾や埋め込みが落ちうることを確認する。**本文が空なら確認を出さない**
- **一括変換**：ツールバーのメニューで、開いているプロジェクトの全ノードの本文を変換する。**本文が空のノードは対象にしない**。多親ノードは 1 回だけ数える
  - 変換内容の警告フェーズと、完了結果フェーズを持つモーダルで確認する
  - 全体の変換は 1 つの操作として保存され、1 回の「元に戻す」で戻せる

### 6.2 Markdown プレビュー

- 見出し、箇条書き、引用、コード、表などの GitHub Flavored Markdown
- task list / Markdown 画像記法
- 子ノードへの `[[Wiki Link]]` と `[[Wiki Link|Alias]]`、外部 URL への wiki link
- 貼り付けた画像はノードの `assets` に保存し、本文には `![](assets/<nodeId>/<file>)` を挿入する
- 外部 URL と `data:` URL はそのまま表示する

旧 Quill 形式の Delta オブジェクト（`{ ops: [...] }`）が Markdown の本文に残っている場合は、表示時に `ops[].insert` を連結してプレーンテキストへ変換する。それ以外の非文字列値は後方互換用に JSON 文字列として表示する。

## 7. 旧 Markdown 形式からの取り込み

以前の版は、ワークスペース直下にプロジェクトごとのディレクトリを作り、ノードを Markdown ファイルとして持っていた。この形式は**読むだけ**で、もう書かない。

```
<workspace>/
├── .task-manage/             ← 正本（グラフ）
└── <project-dir>/
    ├── _project.md           ← プロジェクトのルート（frontmatter に id / name / order）
    ├── attachments/
    └── <node-dir>/
        ├── _index.md         ← ノード（frontmatter に id / name / parents / status / tags ...、本文は後ろ）
        ├── <memo-id>.md      ← 旧メモ。取り込むとこのノードの子ノードになる
        ├── assets/
        └── attachments/
```

取り込みは 2 つの経路がある。どちらも元のファイルは書き換えない。

- **初回の自動取り込み**：`graph-v1.json` が無いワークスペースを開いたとき、直下の旧プロジェクトをすべて取り込んでグラフを作る（`importLegacyGraph`）
- **「Markdown から取り込む」**：ワークスペース管理画面から、グラフを作った後に置かれた（別の PC や別のワークスペースから写した）プロジェクトを選んで、既存のグラフのルート直下へ足す（`importMarkdownProjects`）。1 回の取り込みは 1 つの操作で、「元に戻す」で取り消せる。すでに入っているプロジェクト（同じルート ID のノードがある、または `importSource` が一致する）は「取り込み済み」と表示する。取り込み直すと新しい id の別ノードになる

読みの規則（`electron/workspace.js`）:

- `parents` は `[{ id, order }]`・`[id, id]`（ノード直下の `order` を全ての辺に配る）・単一のスカラーの 3 つの形を受ける
- `status:` の無いファイルは「ステータスなし」として読む
- 旧メモ（`<node-dir>/<memo-id>.md`）はそのノードの子ノードになる。`title` → 名前（無ければ先頭の見出し、それも無ければ `memo`）、本文 → `body`、`tags` → タグ。ステータスは与えない。並びは実ノードの子の後ろ
- 危険な id（`../` を含むなど）のメモは、中身を捨てずに id だけ振り直す
- プロジェクトの中でだけ一意だった id が別プロジェクトと重なったときは、後から来た側に新しい id を振る
- 画像と添付は正本の置き場所（§ 4）へ写し、本文の相対参照（`./assets/...`・`attachments/...`）を書き換える
- 一覧目的の読み出しでは本文を読まず、取り込みの直前にまとめて読む（`loadNodeBodiesAsync`）

回帰テストは `tests/unit/legacy-markdown-reader.test.js`・`tests/unit/workspace-graph-import.test.js`・`tests/unit/workspace-graph-persistence.test.js`。
