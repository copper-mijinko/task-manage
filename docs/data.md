# データ仕様

← [outline.md](outline.md)

## 1. 保存先

データはローカルファイルとして保存される。

- `electron/db.json`
  - 標準プロジェクトの本体とタスクツリーを保存する
- `electron/meta.json`
  - テーマやノード開閉状態などの UI 用メタデータを保存する。アクティブワークスペースのパスもここに保存する
- ワークスペースディレクトリ
  - ユーザが選択した任意のディレクトリ配下に、プロジェクトごとのサブディレクトリと Markdown ファイル群を配置する
- `electron/workspace-state/<hash>.json`
  - 各ワークスペースについて、配下ファイルの SHA-256 ハッシュ表を保存するスナップショット。`<hash>` はワークスペースの絶対パスの SHA-256 先頭 16 文字
  - 起動時およびワークスペース外部書込の取り込み後に更新する

`TASK_MANAGE_DATA_DIR` 環境変数が指定されている場合は、上記 `electron/` 配下の保存先と `workspace-state/` 配置先を当該ディレクトリへ切り替える。テスト時にはこの仕組みで保存先を分離する。

## 2. db.json

### 2.1 全体構造

`db.json` は「プロジェクトの配列」である。
つまり、ファイル全体は 1 個のオブジェクトではなく、`[` で始まる配列になっている。

次のような形で保存される。

```json
[
  {
    "headers": [
      {
        "name": "name",
        "default_ratio": 10
      },
      {
        "name": "status",
        "default_ratio": 4
      },
      {
        "name": "due date",
        "default_ratio": 4
      },
      {
        "name": "memo",
        "default_ratio": 2
      }
    ],
    "data": {
      "id": "89f8d9b0-c94e-4f9f-80e6-1ef8d9448088",
      "data": {
        "name": "new_project",
        "status": "Open",
        "memo": []
      },
      "children": [
        {
          "id": "c2dba063-da65-430a-af15-2cfab466fcd8",
          "data": {
            "name": "new_task",
            "status": "Open",
            "memo": [
              {
                "title": "memo",
                "content": "",
                "format": "quill"
              }
            ]
          },
          "children": []
        }
      ]
    }
  }
]
```

この構造では、外側の 1 要素が 1 プロジェクトを表す。
その中の `data` が、プロジェクトのルートノードである。
さらに `children` の中に子タスクが入り、入れ子でツリー構造になっていく。

### 2.2 プロジェクト

各プロジェクトは次の情報を持つ。

- `headers`
  - テーブル列定義
- `data`
  - ルートタスク

### 2.3 タスク

各タスクは次の情報を持つ。

- `id`
  - 一意な ID
- `data.name`
  - タスク名
- `data.status`
  - ステータス
- `data["due date"]`
  - 期限日
- `data.memo`
  - メモ配列。各エントリは `title` / `content` / `format` を持つ（詳細は § 6 参照）
- `children`
  - 子タスク配列

## 3. meta.json

`meta.json` は、画面表示のための設定を持つオブジェクトである。
現在は主にテーマと、各プロジェクトのノード開閉状態を保存している。

次のような形で保存される。

```json
{
  "theme": "light",
  "workspaceConflictPolicy": "ask",
  "closed_nodes_8e392450-20f7-479a-a7f2-38bdafb913df": null,
  "closed_nodes_89f8d9b0-c94e-4f9f-80e6-1ef8d9448088": []
}
```

この JSON の見方は次のとおりである。

- `theme`
  - アプリ全体のテーマ
- `workspaceConflictPolicy`
  - ワークスペース保存時に外部書込との競合が検知されたときの挙動。`"ask"`（既定）はバナーで「維持 / 再読込」を問い合わせる。`"prefer-memory"` は問い合わせを行わず、メモリ上の `tree_data` を優先してそのまま上書き保存する（`forceLocal` 経路）
- `closed_nodes_<プロジェクトID>`
  - そのプロジェクトで閉じているノードの一覧

`closed_nodes_<プロジェクトID>` の値は、状況によって次のように変わる。

- `null`
  - まだ開閉状態が保存されていない
- `[]`
  - 閉じているノードが 1 つもない
- `["node-id-1", "node-id-2"]`
  - 指定した ID のノードが閉じている

## 3a. Inbox

Inbox はワークスペースごとに 1 つ存在する、プロジェクト非依存・フラット構造の特別なバケットである。

### 3a.1 ファイル配置

```
<workspace>/
├── _inbox/                     ← Inbox 専用ディレクトリ（_ 接頭辞）
│   ├── _project.md             ← Inbox のルートマーカー（kind: inbox）
│   ├── <uuid-a>/
│   │   ├── _index.md           ← Inbox アイテム
│   │   ├── <memo-id>.md        ← メモ（任意の数）
│   │   └── assets/             ← ペースト画像など
│   └── <uuid-b>/...
├── プロジェクトA/
└── プロジェクトB/
```

- ディレクトリ名が `_` で始まるため、`listProjects` の通常プロジェクト一覧から自然に除外される
- `_project.md` のフロントマターには `kind: inbox` を追加し、初回作成時に固定の `id`（UUID）を発行・永続化する。以降この id が Inbox ルートタスクとして扱われる
- アイテムは `parents: [<inbox-root-id>]` を満たすフラット構造のみ。renderer 側で indent/child 追加は提供しない。main 側の `readInbox` はパース時に `parents` を `[rootId]` にクランプして念のため矛盾を矯正する

### 3a.2 IPC 一覧（main プロセス側 API）

| チャネル | ペイロード | 役割 |
| --- | --- | --- |
| `ws:ensure-inbox` | `{ workspacePath }` | `_inbox/` と `_project.md` を必要なら作成し、`{ projectDir, rootId }` を返す |
| `ws:read-inbox` | `{ workspacePath }` | `ws:read-project` 相当。Inbox の全アイテムを読み出す |
| `ws:add-inbox-item` | `{ workspacePath, item }` | 1 件追加。書込→再ロード不要にするため `workspace-project-updated` も発火する |
| `ws:send-inbox-items` | `{ workspacePath, targetProjectDir, targetRootId, targetParentId?, taskIds }` | 指定したアイテムを対象プロジェクトに移動。`targetParentId` を指定するとそのノードの子の末尾に、省略時はプロジェクトのルート直下に追加。ディレクトリごと `rename` するためメモ・アセットがそのまま運ばれる |

Inbox 全体の永続化には既存の `ws:write-project(<inbox-projectDir>, items, options)` を再利用する。Inbox ディレクトリは構造的にワークスペースプロジェクトと同等のため、`WorkspaceWriteQueue` / `WorkspaceReconciler` / `wsCache` がそのまま機能する。

### 3a.3 送信処理

`ws:send-inbox-items` は以下の順序でアトミックに振る舞う：

1. ソース（Inbox）とターゲット（プロジェクト）の双方を `readProject` で読み出す
2. `targetParentId` 指定時はターゲットプロジェクト内に該当 ID が存在することを確認する（不在ならエラー）。省略時はターゲットのルート ID をフォールバックとして用いる
3. 各 taskId について：
   - ソース `_inbox/<dir>/` を `fs.rename` で `<projectDir>/<dir>/` へ移動（同一ボリュームなら原子的、`EXDEV` 時は `cp -r` + `rm -rf` にフォールバック）
   - 移動先のディレクトリ名が衝突する場合は `-2`, `-3` … のサフィックスを付ける
   - `parents` を解決後の親 ID で書き換え、`order` を解決後親の既存子の末尾に連番採番し、`writeTaskAsync` で `_index.md` を更新
4. 双方の `wsCache` を最新化し、`workspace-project-updated` を双方の projectDir 向けに送出

タスク内のメモ・assets は `_index.md` と同階層に保存されているため、ディレクトリ移動だけで相対パスは破綻しない。

## 4. ワークスペースプロジェクト

ワークスペースプロジェクトは、通常の `db.json` プロジェクトと同じツリー UI に変換して表示する。

- ワークスペースプロジェクトの root task は、プロジェクト自身を表すルートノードとしてツリー上に表示する
- root task の `parents` は空配列である
- root task 配下の通常タスクは、root task の子ノードとして表示する
- `tree_data` がワークスペース読み込みで更新された場合、検索フィルタの変更を待たずに表示用ツリーも同期する

### 4.1 永続化の挙動

Workspace の通常編集では、renderer 側の Svelte store を単一の信頼元とする。

- `tree_data` は現在開いている Workspace プロジェクトのタスクツリー本体であり、保存処理はこのメモリスナップショットを main プロセスへ渡して非同期にディスクへ反映する
- `workspace_store.projects` はサイドバー用のプロジェクト summary であり、root task 名や並び順など `tree_data` から派生できる情報はメモリ上で同期する。通常操作の直後に `ws:list-projects` でディスクを読み直して UI を補正してはならない
- `workspace_tasks_cache` は保存時に `createdAt` など tree 表現に含まれないメタデータを保つ補助キャッシュであり、summary 側から task cache へ逆流させない
- ディスクから renderer のメモリへ取り込むのは、起動、workspace 切替、project 選択、migration/export 後の明示 refresh、外部更新リコンサイル、ユーザーが競合解決で reload を選んだ場合に限る
- 書込失敗時もディスクを読み戻してメモリ状態を勝手に巻き戻さない。エラー状態を通知し、ユーザー操作または明示的な reload で解決する

ワークスペース保存は、メモリ上の `tree_data` を唯一の正として、main プロセスが非同期にディスクへ反映する形をとる。renderer は保存完了を待たず（fire-and-forget）、状態は main からの IPC push で更新する。

- **増分書込**: `electron/workspace.js` の `writeFileIfChanged` が既存ファイルとバイト比較し、内容に差がなければ書込をスキップする。OneDrive 等の同期フォルダで、変更のないタスク/メモが無用にアップロードされない
- **原子的書込**: `atomicWriteFile` が同一ディレクトリ内の一時ファイル（`.<basename>.<pid>.<ts>.<uuid>.tmp`）に書いてから `rename` で確定する。Reconciler はファイル名に `.tmp` を含むイベントを無視する
- **書込ログ（自前書込フィルタ）**: `atomicWriteFile` は成功直後に optional コールバック `onWritten(filePath, buffer)` を発火する。queue 経由の書込パスはこれを `reconciler.recordWrite(filePath, buffer)` に紐づけ、`knownFileHashes` を同期的にその場で最新ハッシュへ更新する。chokidar の change イベントが届いたとき `knownFileHashes.get(path) === hashFile(path)` が成立すれば「自前書込」として suppress される。これにより、大規模プロジェクトの書込バッチが長時間化しても reconcile タイマーが先に発火して偽陽性 conflict を出すことがなくなる
- **リトライ**: `retryFileOperation` が `EBUSY` / `EPERM` / `ENOTEMPTY` に対して指数バックオフで 5 回まで再試行する（初期 40ms）。それでも書込が失敗した場合、`forceLocal: true` のジョブは queue の `processLoop` が指数バックオフ（初期 200ms、最大 5 回）で再エンキューし、`saveStatus: "retrying"` を発火する
- **キューイング**: `WorkspaceWriteQueue`（`electron/workspace-write-queue.js`）が `projectDir` をキーに最新タスク集合だけを保持し（latest-wins）、直列に書き出す。同時にペンディング可能な projectDir は最大 8 個。renderer の `ws:write-project` IPC は enqueue だけ行い `{ success, queued: true }` を即返す。enqueue は `{ forceLocal? }` オプションを受け付ける
- **競合の取り扱い**: `workspaceConflictPolicy === "ask"` のときは reconciler が `workspace-conflict` を発火し、saveStatus が `conflict` に遷移する。renderer はバナーで「維持 / 再読込」を問い合わせる。`"prefer-memory"` のときは renderer が `wsWriteProject` 呼出に `forceLocal: true` を自動付与し、reconciler は `workspace-notice (kind: "overwritten-external")` のみ発火する。saveStatus は `conflict` には遷移せず、メモリ内容で上書き保存を続行する
- **保存状態**: 1 回の保存サイクルでステータスは `queued` → `writing` → `saved` を取り、失敗時は `error`、外部書込との衝突時は `conflict`、`forceLocal` のリトライ中は `retrying` をとる。renderer の `saveStatus` ストアはこの状態を `workspace-save-status` イベントで受信する
- **終了時 flush**: アプリ終了要求時、キューにペンディングが残っていれば `mainWindow` の `close` を `event.preventDefault()` で抑止し、renderer にオーバーレイを表示させたうえで `flush()` の完了を待ってから `mainWindow.destroy()` する。30 秒タイムアウトで「強制終了 / 継続」のダイアログを出す。詳細は [`docs/architecture.md` §8.9](architecture.md#89-ワークスペース永続化パイプライン) 参照

### 4.2 エクスポート（db.json → Workspace）

`db.json` プロジェクトをワークスペースプロジェクトへ一方向に変換する。逆方向（Workspace → `db.json`）のパスは存在しない。

- エクスポート先のワークスペースプロジェクトには新規 UUID を発行する。各メモにも新規 UUID を発行する（ソースの ID は引き継がない）
- エクスポート時にメモのフォーマットを保持するか、全メモを Markdown に変換するかを選択できる
- 内部実装はバッチ処理のため、ワークスペースの通常書込（非同期キュー）ではなく同期版 API を使用する

## 5. ステータス

ステータスは次のいずれかである。

- `Open`
- `Pending`
- `In Progress`
- `Completed`
- `Canceled`

## 6. メモ

各メモは次の情報を持つ。

- `title` — メモタブ名
- `content` — メモ本文
- `format` — `"markdown"` または `"quill"`

### 6.1 フォーマットの決定ルール

フォーマットはメモごとに保持される。省略時のデフォルトはプロジェクトの保存先によって異なる。

- `db.json` プロジェクトのメモで `format` が省略されている場合 → `"quill"` として扱う
- ワークスペースプロジェクトのメモで `format` が省略されている場合 → `"markdown"` として扱う

新規作成するメモのデフォルトもプロジェクトの保存先に従う。

- `db.json` プロジェクト → `"quill"`
- ワークスペースプロジェクト → `"markdown"`

### 6.2 ワークスペースメモのファイル形式

ワークスペースプロジェクトのメモは、フォーマットに関わらずすべて `.md` ファイルとして保存される。内部構造はフォーマットによって異なる。

- **Markdown メモ**：YAML フロントマター + Markdown 本文
- **Quill メモ**：フロントマターに `format: quill` を追加し、本文は Quill Delta を JSON として fenced コードブロックに格納する

### 6.3 フォーマット変換

メモのフォーマットは個別または一括で切り替えられる。

- **個別変換**：各メモのフォーマット切替 UI で Markdown ⇄ Quill を切り替える
- **一括変換**：ツールバーの「全メモを Markdown / Quill に一括変換」ボタンで、現在開いているプロジェクトの全メモを変換する
  - 変換内容の警告フェーズと、完了結果フェーズを持つモーダルで確認する
  - プロジェクト全体の変換は単一の Undo アクションとして記録され、1 回の Undo で元に戻せる

### 6.4 Markdown プレビュー

Markdown メモのプレビューでは次の表現を扱う。

- 見出し、箇条書き、引用、コード、表などの GitHub Flavored Markdown
- task list / Markdown 画像記法
- 同一タスク内メモへの `[[Wiki Link]]` と `[[Wiki Link|Alias]]`
- 外部 URL への wiki link

画像ペーストの保存先は保存モードによって異なる。

- ワークスペースプロジェクト：画像を対象タスク配下の `assets/` に保存し、本文には `![](./assets/<file>)` の相対パスを挿入する
- `db.json` プロジェクト：対応するタスクディレクトリがないため、画像を `data:image/...;base64,...` の data URL として本文に埋め込む
- プレビュー時、外部 URL と `data:` URL はそのまま表示し、ワークスペース内の相対画像パスは Electron 側で file URL へ解決する

旧 Quill 形式の Delta オブジェクト（`{ ops: [...] }`）が文字列フィールドに残っている場合は、表示時に `ops[].insert` を連結してプレーンテキストへ変換する。それ以外の非文字列値は後方互換用に JSON 文字列として表示する。

## 7. 外部書込とコンフリクト解決

ワークスペース配下のファイルが、本アプリ以外（OneDrive 同期、手動編集、別エディタなど）によって書き換えられたケースに対応する。

`WorkspaceReconciler`（`electron/workspace-reconciler.js`）が、アクティブワークスペース直下を `chokidar` で監視している。

- **自前書込の除外**: `atomicWriteFile` の `onWritten` フックから `reconciler.recordWrite(filePath, buffer)` が同期的に呼ばれ、`knownFileHashes` が常に最新ハッシュを保つ。chokidar が発火した change イベントについて、`hashFile(path) === knownFileHashes.get(path)` が成立すれば「自分の書込」として無視する。これにより、書込みごとに per-file 単位で偽陽性が発生しないことが保証される
- **OneDrive 等の待機**: `awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }` でファイルサイズが安定するまで待つ
- **デバウンス**: 同一プロジェクトへの連続イベントは 100ms でデバウンスしてから `reconcileProject` を呼ぶ

`reconcileProject` の挙動は次のとおりである。

- ローカルにペンディング書込がある（`workspaceWriteQueue.hasPending(projectDir)` が真）
  - 現在進行中のジョブが `forceLocal: true` の場合
    - `workspace-conflict` は発火しない。代わりに `workspace-notice (kind: "overwritten-external")` を発火し、ユーザに「外部変更を検知したがメモリ優先設定で上書きした」ことを通知する
    - saveStatus は `conflict` に遷移しない
  - それ以外（`forceLocal: false` の通常時）
    - `workspace-conflict` イベントを発火し、`saveStatus` を `conflict` にする
    - 取り込みは行わない。renderer 側でユーザに「維持 / 再読込」を選ばせる
- ペンディングがない
  - ディスクを再読込し、`workspace-project-updated` を発火する
  - main の `wsCache` を新しい `tasks` / `taskDirs` で更新し、renderer の `tree_data` も同期する
  - `workspace-notice (kind: "workspace-updated")` 通知バナーを表示する

ファイル名に `conflicted copy` を含む変更を検知した場合は、内容は触らず `workspace-notice (kind: "conflicted-copy")` を発火してユーザに知らせる。自動マージは行わない。

renderer がコンフリクトを解決するには、`ws:resolve-conflict` IPC に次のいずれかを渡す。

- `action: "keep-local"`
  - キュー内のペンディング書込をそのまま継続。次の保存で外部変更を上書きすることになる
- `action: "reload"`
  - キュー内のペンディング書込を破棄してディスクを再読込し、renderer に `workspace-project-updated (reason: "conflict-reload")` を push する
  - ただし当該プロジェクトの保存ジョブが既に `writing` 中の場合はリロードを拒否する
