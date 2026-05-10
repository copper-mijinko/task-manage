# テストガイド

関連ドキュメント:
[specification.md](specification.md) /
[how-to-contribute.md](how-to-contribute.md) / [../README.md](../README.md)

## 1. テストの種類

### 1.1 Unit テスト

`src/common/` 配下の純粋関数やツリー操作ロジックを対象にする。  
主に `Vitest` で実行する。

### 1.2 Component テスト

`src/components/` 配下の Svelte コンポーネントを対象にする。  
`Vitest` と `@testing-library/svelte` を使い、入力、クリック、キー操作、イベント反映を確認する。

### 1.3 E2E テスト

Electron アプリ全体を起動して確認する。  
`Playwright` を使い、起動、初期表示、保存済みデータの読み込み、画面操作の流れを確認する。

## 2. 種類ごとのテストケース一覧

### 2.1 Unit テスト

対象ファイル:
[tests/unit/tree_control.test.js](/home/akai/develop/task-manage-roo/tests/unit/tree_control.test.js:1)
[tests/unit/search.test.js](/home/akai/develop/task-manage-roo/tests/unit/search.test.js:1)

| 対象                         | テストケース                                                                                 | 確認内容                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/common/tree_control.ts` | `filterTree keeps only matching branches and preserves matching descendants`                 | 名前フィルタで一致した枝だけを残す                                              |
| `src/common/tree_control.ts` | `filterTree supports multiple filters and removes branches that do not match all conditions` | `name` と `status` の複数条件を同時に扱う                                       |
| `src/common/tree_control.ts` | `updateNodeDataById patches a nested node without mutating siblings`                         | 深い階層のノード更新で兄弟ノードを壊さない                                      |
| `src/common/tree_control.ts` | `flattenVisibleTree omits descendants of collapsed nodes`                                    | 折りたたみノードの子孫を表示対象から外す                                        |
| `src/common/tree_control.ts` | `flattenVisibleTree exposes movement metadata for each visible row`                          | 深さ、移動可否、インデント可否などの表示用メタデータを返す                      |
| `src/common/tree_control.ts` | `addNode can append and remove nodes within the tree`                                        | ノード追加と削除が正しく行える                                                  |
| `src/common/tree_control.ts` | `reorderTree can move a node before another node`                                            | ノードを別ノードの前に移動できる                                                |
| `src/common/tree_control.ts` | `moveNodeUp and moveNodeDown reorder siblings safely`                                        | 同階層の上下移動で順序を入れ替える                                              |
| `src/common/tree_control.ts` | `move and hierarchy helpers are no-ops for invalid or blocked operations`                    | 無効な ID や禁止された操作でもツリーを壊さない                                  |
| `src/common/tree_control.ts` | `indentNode and outdentNode change hierarchy level`                                          | インデントとアウトデントで親子関係が変わる                                      |
| `src/common/tree_control.ts` | `getNode returns undefined when the target does not exist`                                   | 存在しない ID に対して `undefined` を返す                                       |
| `src/stores/search.ts`       | `updates visible tree data when tree_data changes without filter changes`                    | ワークスペース読み込みなどで `tree_data` だけが変わっても表示用ツリーを同期する |

### 2.2 Component テスト

対象ファイル:
[tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)  
[tests/component/SearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/SearchBox.test.js:1)  
[tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1)  
[tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)  
[tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)  
[tests/component/TreeTable.test.js](/home/akai/develop/task-manage-roo/tests/component/TreeTable.test.js:1)  
[tests/component/TaskName.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskName.test.js:1)

| 対象                                  | テストケース                                                                | 確認内容                                                                                            | テストファイル                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/components/Memo.svelte`          | `renders in view mode by default (no CM6 editor)`                           | 初期表示では閲覧モードで表示し、CodeMirror エディタを出さない                                       | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `renders markdown content as HTML in view mode`                             | Markdown 本文を HTML プレビューとして表示する                                                       | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `renders wiki links with resolved state when memo exists`                   | `[[Memo]]` リンクを既存 / 未作成の状態付きで表示する                                                | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `resolves workspace image paths to previewable file URLs`                   | workspace assets の相対画像パスをプレビュー可能な file URL に解決する                               | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `converts legacy Quill Delta object to readable markdown text`              | 旧 Quill Delta 形式を生 JSON ではなく読める Markdown / テキストとして表示する                       | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `pasting an image in workspace mode saves it and inserts markdown`          | workspace mode では貼り付け画像を task assets に保存し、相対 Markdown 画像を挿入する                | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `pasting an image in db.json mode inserts a data URL image`                 | db.json mode では貼り付け画像を data URL の Markdown 画像として挿入する                             | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `clicking a markdown link opens it externally and does not enter edit mode` | 通常リンククリック時に外部ブラウザを開き、編集モードへ入らない                                      | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `clicking a wiki link opens the target memo and does not enter edit mode`   | 同一タスク内 wiki link クリックで対象メモへ移動する                                                 | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | `clicking an external wiki link opens it externally`                        | 外部 URL の wiki link を外部ブラウザで開く                                                          | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/SearchBox.svelte`     | `updates the name filter as the user types`                                 | 入力に応じて `filter` store を更新する                                                              | [tests/component/SearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/SearchBox.test.js:1)         |
| `src/components/SearchBox.svelte`     | `clears the filter on Escape and keeps focus in the input`                  | `Escape` で入力と filter をクリアし、focus を維持する                                               | [tests/component/SearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/SearchBox.test.js:1)         |
| `src/components/SearchBox.svelte`     | `reflects store updates when the input is not focused`                      | 外部からの store 更新を入力欄へ反映する                                                             | [tests/component/SearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/SearchBox.test.js:1)         |
| `src/components/PageSearchBox.svelte` | `runs a search with trimmed text`                                           | 前後空白を除いた文字列で `findInPage` を呼ぶ                                                        | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | `does not run a search for empty text`                                      | 空文字では検索を開始しない                                                                          | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | `uses Enter and Shift+Enter to move through matches`                        | `Enter` で次候補、`Shift+Enter` で前候補へ移動する                                                  | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | `updates the result counter from main-process events`                       | main process の検索結果イベントで件数表示を更新する                                                 | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | `closes on Escape and notifies the renderer to clear highlights`            | `Escape` で閉じて `stopFindInPage` を呼ぶ                                                           | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | `clears the current search state from the clear button`                     | `Clear` ボタンで入力欄、件数表示、検索状態を初期化する                                              | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | `resets the search state when the component is hidden`                      | `show=false` にした時に検索状態を片付ける                                                           | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/TaskDetail.svelte`    | `shows a placeholder when no task is selected`                              | 未選択時にプレースホルダを表示する                                                                  | [tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)       |
| `src/components/TaskDetail.svelte`    | `adds a memo tab to the selected task`                                      | メモ追加で store とタブ表示を更新する                                                               | [tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)       |
| `src/components/TaskDetail.svelte`    | `deletes the selected memo after confirmation`                              | メモ削除確認後に store から削除する                                                                 | [tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)       |
| `src/components/TaskDetail.svelte`    | `resets the selected memo tab when the selected task changes`               | タスク切替時にメモタブ選択を初期化する                                                              | [tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)       |
| `src/components/ProjectPage.svelte`   | `adds a sibling task and selects it`                                        | 兄弟タスク追加後に新規ノードを選択する                                                              | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | `adds the first task under the project root when nothing is selected`       | タスク未選択の空プロジェクトで、ルート配下に最初のタスクを追加する                                  | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | `adds a task under the project root when the root is selected`              | ルート選択時の「下に追加」をルート配下への追加として扱う                                            | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | `adds a child task and expands the parent when it was collapsed`            | 子タスク追加時に折りたたみ親を展開する                                                              | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | `shows an alert when trying to delete the root node`                        | ルートノード削除を禁止する                                                                          | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | `removes the selected task after confirmation`                              | 削除確認後に選択中タスクを削除する                                                                  | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/TreeTable.svelte`     | `selects a row and reflects the selected state`                             | 行選択で `table_selected_id` と選択状態表示を更新する                                               | [tests/component/TreeTable.test.js](/home/akai/develop/task-manage-roo/tests/component/TreeTable.test.js:1)         |
| `src/components/TreeTable.svelte`     | `collapses and expands a branch by toggling the row`                        | 折りたたみ操作で子行の表示と `closed_node_ids` を切り替える                                         | [tests/component/TreeTable.test.js](/home/akai/develop/task-manage-roo/tests/component/TreeTable.test.js:1)         |
| `src/components/TaskName.svelte`      | `allows click on read-only input to bubble to row selection handler`        | 非編集（read-only）入力欄クリックでも行選択ハンドラまでイベントを伝播させる（Issue #49 の再発防止） | [tests/component/TaskName.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskName.test.js:1)           |

### 2.3 E2E テスト

対象ファイル:
[tests/e2e/app.smoke.spec.js](/home/akai/develop/task-manage-roo/tests/e2e/app.smoke.spec.js:1)

| 対象                | テストケース                                                              | 確認内容                                                                                                       |
| ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Electron アプリ全体 | `loads seeded project data in Electron`                                   | 一時ディレクトリにシードデータを配置して Electron を起動し、タイトル、プロジェクト名、タスク名の表示を確認する |
| Electron アプリ全体 | `filters the visible task rows from the project search box`               | タスクフィルタ入力に応じて表示行が絞り込まれることを確認する                                                   |
| Electron アプリ全体 | `opens and closes the page search box with keyboard shortcuts`            | `Ctrl+F` でページ内検索バーを開き、`Escape` で閉じることを確認する                                             |
| Electron アプリ全体 | `adds a sibling task from the project toolbar and persists it`            | 行選択後にツールバーからタスクを追加し、`db.json` に保存されることを確認する                                   |
| Electron アプリ全体 | `toggles the theme and persists the new value into meta.json`             | テーマ切替操作後に `meta.json` の `theme` が更新されることを確認する                                           |
| Electron アプリ全体 | `opens the task detail window for the selected task`                      | タスク詳細ウィンドウを開き、対象タスクのタイトルと URL を確認する                                              |
| Electron アプリ全体 | `keeps the task detail window heading in sync when the task name changes` | メイン画面でタスク名を更新した時に、詳細ウィンドウ見出しが同期することを確認する                               |
| Electron アプリ全体 | `shows a missing-task state when the selected task is deleted`            | タスク削除後に詳細ウィンドウが `Task not found.` 表示へ切り替わることを確認する                                |
| Electron アプリ全体 | `shows a missing-project state when the source project is deleted`        | プロジェクト削除後に詳細ウィンドウが `Project not found.` 表示へ切り替わることを確認する                       |

## 3. 実施すべきテストと実装状況

### 3.1 Unit テスト

| 対象                         | 確認内容           | 状態     | テストファイル                                                                                          |
| ---------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `src/common/tree_control.ts` | フィルタ処理       | 実装済み | [tests/unit/tree_control.test.js](/home/akai/develop/task-manage-roo/tests/unit/tree_control.test.js:1) |
| `src/common/tree_control.ts` | ノード更新         | 実装済み | [tests/unit/tree_control.test.js](/home/akai/develop/task-manage-roo/tests/unit/tree_control.test.js:1) |
| `src/common/tree_control.ts` | 可視行フラット化   | 実装済み | [tests/unit/tree_control.test.js](/home/akai/develop/task-manage-roo/tests/unit/tree_control.test.js:1) |
| `src/common/tree_control.ts` | ノード追加 / 削除  | 実装済み | [tests/unit/tree_control.test.js](/home/akai/develop/task-manage-roo/tests/unit/tree_control.test.js:1) |
| `src/common/tree_control.ts` | 並び替え           | 実装済み | [tests/unit/tree_control.test.js](/home/akai/develop/task-manage-roo/tests/unit/tree_control.test.js:1) |
| `src/common/tree_control.ts` | 階層移動           | 実装済み | [tests/unit/tree_control.test.js](/home/akai/develop/task-manage-roo/tests/unit/tree_control.test.js:1) |
| `src/common/tree_control.ts` | 不正入力時の安全性 | 実装済み | [tests/unit/tree_control.test.js](/home/akai/develop/task-manage-roo/tests/unit/tree_control.test.js:1) |
| `src/stores/search.ts`       | 表示用ツリー同期   | 実装済み | [tests/unit/search.test.js](/home/akai/develop/task-manage-roo/tests/unit/search.test.js:1)             |

### 3.2 Component テスト

| 対象                                  | 確認内容                                   | 状態     | テストファイル                                                                                                      |
| ------------------------------------- | ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/components/Memo.svelte`          | Markdown プレビュー表示                    | 実装済み | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | wiki link と外部リンク処理                 | 実装済み | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | workspace / db.json の画像ペースト         | 実装済み | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/Memo.svelte`          | 旧 Quill Delta 表示互換                    | 実装済み | [tests/component/Memo.test.js](/home/akai/develop/task-manage-roo/tests/component/Memo.test.js:1)                   |
| `src/components/SearchBox.svelte`     | 入力による filter 更新                     | 実装済み | [tests/component/SearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/SearchBox.test.js:1)         |
| `src/components/SearchBox.svelte`     | `Escape` によるクリアと focus 維持         | 実装済み | [tests/component/SearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/SearchBox.test.js:1)         |
| `src/components/SearchBox.svelte`     | store 変更の入力欄反映                     | 実装済み | [tests/component/SearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/SearchBox.test.js:1)         |
| `src/components/PageSearchBox.svelte` | 検索実行                                   | 実装済み | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | 検索結果移動                               | 実装済み | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | 件数表示更新                               | 実装済み | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/PageSearchBox.svelte` | クリアと close                             | 実装済み | [tests/component/PageSearchBox.test.js](/home/akai/develop/task-manage-roo/tests/component/PageSearchBox.test.js:1) |
| `src/components/TaskDetail.svelte`    | 未選択表示                                 | 実装済み | [tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)       |
| `src/components/TaskDetail.svelte`    | メモ追加                                   | 実装済み | [tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)       |
| `src/components/TaskDetail.svelte`    | メモ削除                                   | 実装済み | [tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)       |
| `src/components/TaskDetail.svelte`    | タスク切替時のタブ選択初期化               | 実装済み | [tests/component/TaskDetail.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskDetail.test.js:1)       |
| `src/components/ProjectPage.svelte`   | タスク追加                                 | 実装済み | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | 未選択 / ルート選択時の初回タスク追加      | 実装済み | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | 子タスク追加                               | 実装済み | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | タスク削除                                 | 実装済み | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/ProjectPage.svelte`   | ルートノード削除禁止                       | 実装済み | [tests/component/ProjectPage.test.js](/home/akai/develop/task-manage-roo/tests/component/ProjectPage.test.js:1)     |
| `src/components/TreeTable.svelte`     | 行選択                                     | 実装済み | [tests/component/TreeTable.test.js](/home/akai/develop/task-manage-roo/tests/component/TreeTable.test.js:1)         |
| `src/components/TreeTable.svelte`     | 折りたたみ / 展開                          | 実装済み | [tests/component/TreeTable.test.js](/home/akai/develop/task-manage-roo/tests/component/TreeTable.test.js:1)         |
| `src/components/TaskName.svelte`      | 非編集入力欄クリック時の行選択イベント伝播 | 実装済み | [tests/component/TaskName.test.js](/home/akai/develop/task-manage-roo/tests/component/TaskName.test.js:1)           |

### 3.3 E2E テスト

| 対象                | 確認内容                         | 状態     | テストファイル                                                                                  |
| ------------------- | -------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Electron アプリ全体 | 起動と初期表示                   | 実装済み | [tests/e2e/app.smoke.spec.js](/home/akai/develop/task-manage-roo/tests/e2e/app.smoke.spec.js:1) |
| Electron アプリ全体 | 保存済みデータ読み込み           | 実装済み | [tests/e2e/app.smoke.spec.js](/home/akai/develop/task-manage-roo/tests/e2e/app.smoke.spec.js:1) |
| Electron アプリ全体 | タスクフィルタ                   | 実装済み | [tests/e2e/app.smoke.spec.js](/home/akai/develop/task-manage-roo/tests/e2e/app.smoke.spec.js:1) |
| Electron アプリ全体 | ページ内検索バー表示と close     | 実装済み | [tests/e2e/app.smoke.spec.js](/home/akai/develop/task-manage-roo/tests/e2e/app.smoke.spec.js:1) |
| Electron アプリ全体 | タスク追加から保存まで           | 実装済み | [tests/e2e/app.smoke.spec.js](/home/akai/develop/task-manage-roo/tests/e2e/app.smoke.spec.js:1) |
| Electron アプリ全体 | テーマ変更の保存                 | 実装済み | [tests/e2e/app.smoke.spec.js](/home/akai/develop/task-manage-roo/tests/e2e/app.smoke.spec.js:1) |
| Electron アプリ全体 | タスク詳細ウィンドウの表示と同期 | 実装済み | [tests/e2e/app.smoke.spec.js](/home/akai/develop/task-manage-roo/tests/e2e/app.smoke.spec.js:1) |

## 4. 実行コマンド

- `npm run check`
  - 型と Svelte の基本チェック
- `npm run test:unit`
  - Unit テストの実行
- `npm run test:component`
  - Component テストの実行
- `npm run test:e2e`
  - E2E テストの実行
- `npm run test:all`
  - Unit、Component、E2E を順に実行

## 5. 補足

- `tests/e2e/fixtures/`
  - E2E 用の `db.json` と `meta.json` を置く
- GitHub Actions
  - `.github/workflows/main.yml` で `check`、`unit`、`component`、`e2e` を実行する
- `Playwright` の E2E は、実行環境によっては Electron の起動制約を受けることがある

関連ドキュメント:
[specification.md](specification.md) /
[how-to-contribute.md](how-to-contribute.md) / [../README.md](../README.md)
