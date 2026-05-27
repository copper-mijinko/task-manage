# テストガイド

← [outline.md](outline.md)

## 1. テストの種類

### 1.1 Unit テスト

`src/features/tasks/utils/` 配下の純粋関数やツリー操作ロジックを対象にする。
主に `Vitest` で実行する。

### 1.2 Component テスト

`src/features/<domain>/components/` および `src/lib/primitives/` 配下の Svelte コンポーネントを対象にする。
`Vitest` と `@testing-library/svelte` を使い、入力、クリック、キー操作、イベント反映を確認する。

### 1.3 E2E テスト

Electron アプリ全体を起動して確認する。
`Playwright` を使い、起動、初期表示、保存済みデータの読み込み、画面操作の流れを確認する。

## 2. テストケース一覧

### 2.1 Unit テスト

対象ファイル:
[tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js)
[tests/unit/search.test.js](../tests/unit/search.test.js)
[tests/unit/datetime_shortcuts.test.ts](../tests/unit/datetime_shortcuts.test.ts)
[tests/unit/navigation_history.test.ts](../tests/unit/navigation_history.test.ts)
[tests/unit/archive.test.ts](../tests/unit/archive.test.ts)

| 対象                                | テストケース                                                                                      | 確認内容                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/features/tasks/utils/tree_control.ts` | `filterTree keeps only matching branches and preserves matching descendants`                      | 名前フィルタで一致した枝だけを残す                                              |
| `src/features/tasks/utils/tree_control.ts` | `filterTree supports multiple filters and removes branches that do not match all conditions`      | `name` と `status` の複数条件を同時に扱う                                       |
| `src/features/tasks/utils/tree_control.ts` | `updateNodeDataById patches a nested node without mutating siblings`                              | 深い階層のノード更新で兄弟ノードを壊さない                                      |
| `src/features/tasks/utils/tree_control.ts` | `flattenVisibleTree omits descendants of collapsed nodes`                                         | 折りたたみノードの子孫を表示対象から外す                                        |
| `src/features/tasks/utils/tree_control.ts` | `flattenVisibleTree exposes movement metadata for each visible row`                               | 深さ、移動可否、インデント可否などの表示用メタデータを返す                      |
| `src/features/tasks/utils/tree_control.ts` | `addNode can append and remove nodes within the tree`                                             | ノード追加と削除が正しく行える                                                  |
| `src/features/tasks/utils/tree_control.ts` | `reorderTree can move a node before another node`                                                 | ノードを別ノードの前に移動できる                                                |
| `src/features/tasks/utils/tree_control.ts` | `moveNodeUp and moveNodeDown reorder siblings safely`                                             | 同階層の上下移動で順序を入れ替える                                              |
| `src/features/tasks/utils/tree_control.ts` | `move and hierarchy helpers are no-ops for invalid or blocked operations`                         | 無効な ID や禁止された操作でもツリーを壊さない                                  |
| `src/features/tasks/utils/tree_control.ts` | `indentNode and outdentNode change hierarchy level`                                               | インデントとアウトデントで親子関係が変わる                                      |
| `src/features/tasks/utils/tree_control.ts` | `getNode returns undefined when the target does not exist`                                        | 存在しない ID に対して `undefined` を返す                                       |
| `src/features/tasks/utils/tree_control.ts` | `buildStickyTrail does NOT show sibling row when topmost-visible is a sibling of covered row`     | スティッキー帯下に見える行の祖先のみを返し、兄弟ノードを誤って混入させない      |
| `src/features/tasks/utils/tree_control.ts` | `buildStickyTrail switches scope when scrolling across subtrees`                                  | サブツリーをまたいでスクロールするとパンくずがその場の祖先に切り替わる          |
| `src/features/tasks/utils/tree_control.ts` | `buildStickyTrail hides the trail at the very top (only root in scope)`                           | プロジェクト直下しか見えていない時はパンくずを表示しない                        |
| `src/features/search/stores/search.ts`     | `updates visible tree data when tree_data changes without filter changes`                         | ワークスペース読み込みなどで `tree_data` だけが変わっても表示用ツリーを同期する |
| `electron/workspace.js`             | `atomicWriteFile replaces files without leaving temp files`                                       | 一時ファイル経由 → `rename` の原子的書込で `.tmp` が残らない                    |
| `electron/workspace.js`             | `writeFileIfChanged skips unchanged content`                                                      | 既存ファイルと内容一致の場合に書込をスキップし mtime を維持する                 |
| `electron/workspace.js`             | `retryFileOperation retries temporary OneDrive-style filesystem errors`                           | `EBUSY` / `EPERM` などのリトライ可能エラーを指数バックオフで再試行する          |
| `electron/workspace.js`             | `writeProjectAsync skips unchanged task and memo files`                                           | プロジェクト全体保存時に変化のないファイルを書き直さない                        |
| `electron/workspace.js`             | `writeProjectAsync touches only changed memo files and deletes removed tasks`                     | 変更メモのみ書き換え、削除されたタスクのディレクトリは消す                      |
| `electron/workspace.js`             | `writeProjectPatchAsync writes only patched tasks and deletes requested tasks`                    | 差分パッチ保存時に対象タスクだけを書き込み、指定された削除 task dir だけを消す  |
| `electron/workspace.js`             | `*Async` 系の `createProject` / `writeTask` / `saveMemoImage` / `deleteTaskDir` / `deleteProject` | 非同期 IO 経路でも従来同等のディレクトリ／ファイル構造を生成する                |
| `electron/workspace.js`             | `saveTaskAttachmentAsync copies files into task attachments and readProject lists them`           | 添付ファイルを `attachments/` に保存し、同名衝突時のリネームと再読込結果を確認する |
| `electron/workspace.js`             | `deleteTaskAttachmentAsync deletes only safe attachment paths`                                    | `./attachments/<file>` 以外の削除を拒否し、添付削除後の一覧を返す                |
| `electron/workspace-write-queue.js` | `keeps only the latest pending snapshot for the same project`                                     | 同一 projectDir への連続 enqueue を latest-wins でマージする                    |
| `electron/workspace-write-queue.js` | `merges pending patches for the same project`                                                     | 同一 projectDir への連続 patch enqueue を 1 件にまとめる                        |
| `electron/workspace-write-queue.js` | `applies a pending patch to a queued full snapshot`                                               | 全体保存が待機中のとき、後続 patch をその snapshot に反映する                   |
| `electron/workspace-write-queue.js` | `applies a bounded pending-project guard`                                                         | 未知の projectDir を `maxPendingProjects` 超えで enqueue すると例外             |
| `electron/workspace-write-queue.js` | `emits save status transitions and reports write errors`                                          | `queued` → `writing` → `error` のステータス遷移とエラーコールバック             |
| `electron/workspace-write-queue.js` | `reports the committed project snapshot after a successful write`                                 | 書込成功後に main が他ウィンドウへ同期できる committed snapshot を `onWritten` で受け取る |
| `electron/workspace-reconciler.js`  | `suppresses watcher events caused by its own recent writes`                                       | `recentlyWritten` ハッシュ一致時は外部更新として扱わない                        |
| `electron/workspace-reconciler.js`  | `pushes an external update when no local write is pending`                                        | ペンディング書込なしの場合は再読込して `onProjectUpdated` を発火                |
| `electron/workspace-reconciler.js`  | `reports a conflict when a local write is pending`                                                | ペンディング書込ありの場合は `onConflict` を発火し再読込しない                  |
| `electron/workspace-reconciler.js`  | `notifies conflicted copy files without trying to merge them`                                     | `conflicted copy` を含むファイルは `conflicted-copy` 通知のみで自動マージしない |
| `src/lib/utils/datetime_shortcuts.ts` | `formatDate` / `formatTime` の slash / iso / japanese 各書式                                    | 入力ショートカットで挿入される日付・時刻文字列のフォーマットが期待通り        |
| `src/stores/navigation_history.ts`  | `初期状態は entries 空・index -1。back / forward は無効`                                          | 履歴未蓄積時はナビゲーションが無効                                              |
| `src/stores/navigation_history.ts`  | `undefined / undefined への遷移は履歴に積まない`                                                  | 初期化中の選択なし状態を履歴に残さない                                          |
| `src/stores/navigation_history.ts`  | `ページ遷移ごとに 1 エントリ積まれ、back / forward で行き来できる`                                | type/id 切替の度に履歴が伸び、戻る/進むで再現できる                             |
| `src/stores/navigation_history.ts`  | `back / forward 自体は履歴を再増殖させない（重複しない）`                                         | プログラム的 navigation は記録対象外                                            |
| `src/stores/navigation_history.ts`  | `途中から別ページへ遷移すると forward 履歴は捨てられる`                                           | 分岐時に進む側履歴を切り捨てる                                                  |
| `src/stores/navigation_history.ts`  | `同一ページへの再選択は履歴に積まない`                                                            | 重複エントリの押し戻しを防ぐ                                                    |
| `src/stores/navigation_history.ts`  | `type と id の同時セットは中間状態を履歴に残さない`                                               | microtask コアレスで途中の不整合タプルを捨てる                                  |
| `src/stores/navigation_history.ts`  | `先頭で back を押しても何も起きない` / `末尾で forward を押しても何も起きない`                    | 境界条件で no-op                                                                |
| `src/stores/navigation_history.ts`  | `microtask 未消化の状態で back されても押す前のページが履歴に残る`                                | flushPendingRecord により直前遷移を取りこぼさない                               |
| `src/stores/navigation_history.ts`  | `WorkspaceProject の back は activeProjectDir も復元する`                                         | workspace_store.activeProjectDir をエントリに含め、戻る時に setActiveProject する |
| `src/stores/navigation_history.ts`  | `非 WorkspaceProject の back は activeProjectDir に触らない`                                      | Projects 間遷移では workspace 側を変えない                                      |
| `src/stores/navigation_history.ts`  | `ロード完了直後の table_selected_id fill-in は履歴を伸ばさず最後のエントリへ in-place で入る`         | 「ロード完了で auto-select root」を 1 回だけエントリへ取り込み、以降は固定化     |
| `src/stores/navigation_history.ts`  | `ページ遷移時、新ページの初期エントリの tableSelectedId は undefined にしておきロード完了で埋まる`    | ページ切替直後の旧 tableSelectedId 残留を防ぎ、loader の selectOnly で埋める    |
| `src/stores/navigation_history.ts`  | `pushSelection は同ページ内のタスク行切替を 1 エントリとして積む`                                     | ユーザの能動的なタスク選択は履歴に積み、戻れるようにする                        |
| `src/stores/navigation_history.ts`  | `pushSelection で積んだタスク選択は back で逆める`                                                    | 同ページ内 back は table_selected_id を直接巻き戻す                            |
| `src/stores/navigation_history.ts`  | `pushSelection は直前エントリと完全一致する状態では no-op`                                            | 同じタスクを連打しても履歴を重複させない                                        |
| `src/stores/navigation_history.ts`  | `ページ跨ぎ + タスクの 2 アクションは 2 回の back で巻き戻る`                                          | 「プロジェクト遷移」と「タスク選択」をそれぞれ 1 エントリとして積む            |
| `src/stores/navigation_history.ts`  | `activeWorkspacePath はエントリに記録される`                                                       | workspace 切替を跨いだ戻る/進むに対応                                           |
| `src/stores/navigation_history.ts`  | `workspace_store の non-navigation 変更（projects 一覧更新など）は履歴を伸ばさない`                  | workspace_store 全体を購読しつつ、ページに関わらない更新は無視する              |
| `src/features/tasks/utils/tree_control.ts` | `archiveNode は対象に archived=true と archivedAt を立てる`                                  | アーカイブ操作の基本動作                                                        |
| `src/features/tasks/utils/tree_control.ts` | `archiveNode はルートには作用しない`                                                          | プロジェクトルートを誤って消せないことを保証                                    |
| `src/features/tasks/utils/tree_control.ts` | `archiveNode は既に archived のノードは触らない`                                              | idempotency                                                                     |
| `src/features/tasks/utils/tree_control.ts` | `restoreNode は archived を外し、親 children 配列の末尾へ移動する`                            | 復元時の挿入位置を「元の親の末尾」に固定                                        |
| `src/features/tasks/utils/tree_control.ts` | `bulkArchiveNodes は複数ノードに同じ archivedAt を一括で立てる`                                | バルク操作で時間印が揃う                                                        |
| `src/features/tasks/utils/tree_control.ts` | `bulkRestoreNodes は対象を末尾へ寄せ、archived を外す`                                         | バルク復元の挙動                                                                |
| `src/features/tasks/utils/tree_control.ts` | `flattenVisibleTree は archived とその子孫を既定で除外する`                                    | show_archived=OFF 時の display 動作                                              |
| `src/features/tasks/utils/tree_control.ts` | `flattenVisibleTree は includeArchived=true で archived も並べる`                              | show_archived=ON 時の display 動作                                               |
| `src/features/tasks/utils/tree_control.ts` | `stripArchivedNodes は archived の子孫を完全に取り除いた新ツリーを返す`                          | filter/tag 系の前処理が新ツリーを返し、元を破壊しない                            |
| `src/features/tasks/utils/tree_control.ts` | `restoreNode で親を復元しても、独立 archived な子は archived のまま`                            | restore は対象ノードだけに作用する（cascade なし）                                |

### 2.2 Component テスト

対象ファイル:
[tests/component/Memo.test.js](../tests/component/Memo.test.js)
[tests/component/SearchBox.test.js](../tests/component/SearchBox.test.js)
[tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js)
[tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js)
[tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js)
[tests/component/TreeTable.test.js](../tests/component/TreeTable.test.js)
[tests/component/TreeTableRow.test.js](../tests/component/TreeTableRow.test.js)
[tests/component/TaskName.test.js](../tests/component/TaskName.test.js)
[tests/component/App.test.js](../tests/component/App.test.js)
[tests/component/Header.test.js](../tests/component/Header.test.js)

| 対象                                               | テストケース                                                                    | 確認内容                                                                                                | テストファイル                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/features/memos/components/Memo.svelte`        | `renders in view mode by default (no CM6 editor)`                               | 初期表示では閲覧モードで表示し、CodeMirror エディタを出さない                                           | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `renders markdown content as HTML in view mode`                                 | Markdown 本文を HTML プレビューとして表示する                                                           | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `renders wiki links with resolved state when memo exists`                       | `[[Memo]]` リンクを既存 / 未作成の状態付きで表示する                                                    | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `resolves workspace image paths to previewable file URLs`                       | workspace assets の相対画像パスをプレビュー可能な file URL に解決する                                   | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `converts legacy Quill Delta object to readable markdown text`                  | 旧 Quill Delta 形式を生 JSON ではなく読める Markdown / テキストとして表示する                           | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `pasting an image in workspace mode saves it and inserts markdown`              | workspace mode では貼り付け画像を task assets に保存し、相対 Markdown 画像を挿入する                    | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `pasting an image in db.json mode inserts a data URL image`                     | db.json mode では貼り付け画像を data URL の Markdown 画像として挿入する                                 | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `clicking a markdown link opens it externally and does not enter edit mode`     | 通常リンククリック時に外部ブラウザを開き、編集モードへ入らない                                          | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `clicking a wiki link opens the target memo and does not enter edit mode`       | 同一タスク内 wiki link クリックで対象メモへ移動する                                                     | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/features/memos/components/Memo.svelte`        | `clicking an external wiki link opens it externally`                            | 外部 URL の wiki link を外部ブラウザで開く                                                              | [tests/component/Memo.test.js](../tests/component/Memo.test.js) |
| `src/lib/primitives/SearchBox.svelte`              | `updates the name filter as the user types`                                     | 入力に応じて `filter` store を更新する                                                                  | [tests/component/SearchBox.test.js](../tests/component/SearchBox.test.js) |
| `src/lib/primitives/SearchBox.svelte`              | `clears the filter on Escape and keeps focus in the input`                      | `Escape` で入力と filter をクリアし、focus を維持する                                                   | [tests/component/SearchBox.test.js](../tests/component/SearchBox.test.js) |
| `src/lib/primitives/SearchBox.svelte`              | `reflects store updates when the input is not focused`                          | 外部からの store 更新を入力欄へ反映する                                                                 | [tests/component/SearchBox.test.js](../tests/component/SearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | `runs a search with trimmed text`                                            | 前後空白を除いた文字列で `findInPage` を呼ぶ                                                            | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | `does not run a search for empty text`                                       | 空文字では検索を開始しない                                                                              | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | `uses Enter and Shift+Enter to move through matches`                         | `Enter` で次候補、`Shift+Enter` で前候補へ移動する                                                      | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | `updates the result counter from main-process events`                        | main process の検索結果イベントで件数表示を更新する                                                     | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | `closes on Escape and notifies the renderer to clear highlights`             | `Escape` で閉じて `stopFindInPage` を呼ぶ                                                               | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | `clears the current search state from the clear button`                      | `Clear` ボタンで入力欄、件数表示、検索状態を初期化する                                                  | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | `resets the search state when the component is hidden`                       | `show=false` にした時に検索状態を片付ける                                                               | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `shows a placeholder when no task is selected`                                  | 未選択時にプレースホルダを表示する                                                                      | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `adds a memo tab to the selected task`                                          | メモ追加で store とタブ表示を更新する                                                                   | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `deletes the selected memo after confirmation`                                  | メモ削除確認後に store から削除する                                                                     | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `resets the selected memo tab when the selected task changes`                   | タスク切替時にメモタブ選択を初期化する                                                                  | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `adds a file attachment to a workspace task`                                    | 添付ボタンから選んだファイルを workspace task に保存して store を更新する                                | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `opens the file picker from the attachment button`                              | 添付ボタン押下で hidden file input を開く                                                                | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `adds attachments by drag and drop`                                             | 添付欄への drop でファイル保存 API を呼び、添付一覧を更新する                                            | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `opens attachment actions from the context menu`                                | 添付ファイル右クリックメニューから「開く」と「プログラムから開く」を呼び分ける                          | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | `opens and deletes a workspace task attachment`                                 | 添付ファイルを既定アプリで開き、削除後に store の添付一覧を更新する                                      | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/pages/MainPage.svelte`                        | `adds a sibling task and selects it`                                            | 兄弟タスク追加後に新規ノードを選択する                                                                  | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | `adds the first task under the project root when nothing is selected`           | タスク未選択の空プロジェクトで、ルート配下に最初のタスクを追加する                                      | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | `shows an alert when adding a sibling next to the project root`                 | ルート選択 + 兄弟挿入 = アラート表示する                                                                | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | `adds a task under the project root via 子タスク追加 when the root is selected` | ルート選択時は「子タスク追加」ボタンを使って配下にタスクを追加する                                      | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | `adds a child task and expands the parent when it was collapsed`                | 子タスク追加時に折りたたみ親を展開する                                                                  | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | `shows an alert when trying to delete the root node`                            | ルートノード削除を禁止する                                                                              | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | `removes the selected task after confirmation`                                  | 削除確認後に選択中タスクを削除する                                                                      | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/features/tasks/components/TreeTable.svelte`   | `selects a row and reflects the selected state`                                 | 行選択で `table_selected_id` と選択状態表示を更新する                                                   | [tests/component/TreeTable.test.js](../tests/component/TreeTable.test.js) |
| `src/features/tasks/components/TreeTable.svelte`   | `collapses and expands a branch by toggling the row`                            | 折りたたみ操作で子行の表示と `closed_node_ids` を切り替える                                             | [tests/component/TreeTable.test.js](../tests/component/TreeTable.test.js) |
| `src/features/tasks/components/TreeTable.svelte`   | `shows the attachments count column`                                            | `attachments` 列に添付数を表示する                                                                      | [tests/component/TreeTable.test.js](../tests/component/TreeTable.test.js) |
| `src/features/tasks/components/TreeTableRow.svelte` | `renders array-valued columns as counts`                                       | 配列値の列を件数表示し、添付未定義時は `0` を表示する                                                   | [tests/component/TreeTableRow.test.js](../tests/component/TreeTableRow.test.js) |
| `src/features/tasks/components/TaskName.svelte`    | `allows click on read-only input to bubble to row selection handler`            | 非編集（read-only）入力欄クリックでも行選択ハンドラまでイベントを伝播させる                             | [tests/component/TaskName.test.js](../tests/component/TaskName.test.js) |
| `src/App.svelte`                                   | `shows workspace conflict actions and keeps local changes`                      | コンフリクトバナーの「維持」ボタンで `wsResolveConflict(projectDir, "keep-local")` を呼ぶ               | [tests/component/App.test.js](../tests/component/App.test.js) |
| `src/App.svelte`                                   | `resolves workspace conflict by reloading from disk`                            | コンフリクトバナーの「再読込」ボタンで `wsResolveConflict(projectDir, "reload")` を呼ぶ                 | [tests/component/App.test.js](../tests/component/App.test.js) |
| `src/features/navigation/components/Header.svelte` | `save status indicator reflects queued / writing / error states`                | `saveStatus` の値変化に応じてラベル（`保存待ち` / `保存中...` / `保存失敗`）と `data-status` を更新する | [tests/component/Header.test.js](../tests/component/Header.test.js) |

### 2.3 E2E テスト

対象ファイル:
[tests/e2e/app.smoke.spec.js](../tests/e2e/app.smoke.spec.js)

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

| 対象                                | 確認内容                                   | 状態     | テストファイル                                                |
| ----------------------------------- | ------------------------------------------ | -------- | ------------------------------------------------------------- |
| `src/features/tasks/utils/tree_control.ts` | フィルタ処理                        | 実装済み | [tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js) |
| `src/features/tasks/utils/tree_control.ts` | ノード更新                          | 実装済み | [tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js) |
| `src/features/tasks/utils/tree_control.ts` | 可視行フラット化                    | 実装済み | [tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js) |
| `src/features/tasks/utils/tree_control.ts` | ノード追加 / 削除                   | 実装済み | [tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js) |
| `src/features/tasks/utils/tree_control.ts` | 並び替え                            | 実装済み | [tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js) |
| `src/features/tasks/utils/tree_control.ts` | 階層移動                            | 実装済み | [tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js) |
| `src/features/tasks/utils/tree_control.ts` | 不正入力時の安全性                  | 実装済み | [tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js) |
| `src/features/tasks/utils/tree_control.ts` | スティッキー パンくず計算           | 実装済み | [tests/unit/tree_control.test.js](../tests/unit/tree_control.test.js) |
| `src/features/search/stores/search.ts`     | 表示用ツリー同期                    | 実装済み | [tests/unit/search.test.js](../tests/unit/search.test.js)             |
| `electron/workspace.js`             | 原子的・増分書込・リトライ・`*Async` 経路  | 実装済み | [tests/unit/workspace.test.js](../tests/unit/workspace.test.js)       |
| `electron/workspace.js`             | 添付ファイル保存 / 削除 / 安全なパス解決    | 実装済み | [tests/unit/workspace.test.js](../tests/unit/workspace.test.js)       |
| `electron/workspace-write-queue.js` | latest-wins / 上限 / ステータス通知        | 実装済み | [tests/unit/workspace-write-queue.test.js](../tests/unit/workspace-write-queue.test.js) |
| `electron/workspace-reconciler.js`  | 自前書込除外 / 外部書込取り込み / 競合通知 | 実装済み | [tests/unit/workspace-reconciler.test.js](../tests/unit/workspace-reconciler.test.js)   |
| `src/lib/utils/datetime_shortcuts.ts` | 入力ショートカットの日付・時刻フォーマット | 実装済み | [tests/unit/datetime_shortcuts.test.ts](../tests/unit/datetime_shortcuts.test.ts)       |
| `src/stores/navigation_history.ts`  | ページ遷移履歴の push / back / forward / 重複防止 / 分岐切り捨て / flush 同期 | 実装済み | [tests/unit/navigation_history.test.ts](../tests/unit/navigation_history.test.ts) |
| `src/features/tasks/utils/tree_control.ts` | アーカイブ操作（archive / restore / bulk / display 制御 / strip）              | 実装済み | [tests/unit/archive.test.ts](../tests/unit/archive.test.ts) |

### 3.2 Component テスト

| 対象                                               | 確認内容                                                                       | 状態     | テストファイル                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------- |
| `src/features/memos/components/Memo.svelte`        | Markdown プレビュー表示                                                        | 実装済み | [tests/component/Memo.test.js](../tests/component/Memo.test.js)         |
| `src/features/memos/components/Memo.svelte`        | wiki link と外部リンク処理                                                     | 実装済み | [tests/component/Memo.test.js](../tests/component/Memo.test.js)         |
| `src/features/memos/components/Memo.svelte`        | workspace / db.json の画像ペースト                                             | 実装済み | [tests/component/Memo.test.js](../tests/component/Memo.test.js)         |
| `src/features/memos/components/Memo.svelte`        | 旧 Quill Delta 表示互換                                                        | 実装済み | [tests/component/Memo.test.js](../tests/component/Memo.test.js)         |
| `src/lib/primitives/SearchBox.svelte`              | 入力による filter 更新                                                         | 実装済み | [tests/component/SearchBox.test.js](../tests/component/SearchBox.test.js) |
| `src/lib/primitives/SearchBox.svelte`              | `Escape` によるクリアと focus 維持                                             | 実装済み | [tests/component/SearchBox.test.js](../tests/component/SearchBox.test.js) |
| `src/lib/primitives/SearchBox.svelte`              | store 変更の入力欄反映                                                         | 実装済み | [tests/component/SearchBox.test.js](../tests/component/SearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | 検索実行                                                                    | 実装済み | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | 検索結果移動                                                                | 実装済み | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | 件数表示更新                                                                | 実装済み | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/search/components/PageSearchBox.svelte` | クリアと close                                                              | 実装済み | [tests/component/PageSearchBox.test.js](../tests/component/PageSearchBox.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | 未選択表示                                                                     | 実装済み | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | メモ追加                                                                       | 実装済み | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | メモ削除                                                                       | 実装済み | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | タスク切替時のタブ選択初期化                                                   | 実装済み | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/features/tasks/components/TaskDetail.svelte`  | 添付追加 / drag & drop / 右クリックメニュー / 削除                              | 実装済み | [tests/component/TaskDetail.test.js](../tests/component/TaskDetail.test.js) |
| `src/pages/MainPage.svelte`                        | タスク追加                                                                     | 実装済み | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | 未選択時の初回タスク追加                                                       | 実装済み | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | ルート選択時の兄弟挿入アラート                                                 | 実装済み | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | ルート配下への子タスク追加                                                     | 実装済み | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | 子タスク追加                                                                   | 実装済み | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | タスク削除                                                                     | 実装済み | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/pages/MainPage.svelte`                        | ルートノード削除禁止                                                           | 実装済み | [tests/component/ProjectPage.test.js](../tests/component/ProjectPage.test.js) |
| `src/features/tasks/components/TreeTable.svelte`   | 行選択                                                                         | 実装済み | [tests/component/TreeTable.test.js](../tests/component/TreeTable.test.js) |
| `src/features/tasks/components/TreeTable.svelte`   | 折りたたみ / 展開                                                              | 実装済み | [tests/component/TreeTable.test.js](../tests/component/TreeTable.test.js) |
| `src/features/tasks/components/TaskName.svelte`    | 非編集入力欄クリック時の行選択イベント伝播                                     | 実装済み | [tests/component/TaskName.test.js](../tests/component/TaskName.test.js) |
| `src/App.svelte`                                   | ワークスペースコンフリクトバナー（維持 / 再読込）                              | 実装済み | [tests/component/App.test.js](../tests/component/App.test.js)           |
| `src/features/navigation/components/Header.svelte` | 保存状態インジケータ（queued / writing / retrying / saved / error / conflict） | 実装済み | [tests/component/Header.test.js](../tests/component/Header.test.js)     |

### 3.3 E2E テスト

| 対象                | 確認内容                         | 状態     | テストファイル                                                      |
| ------------------- | -------------------------------- | -------- | ------------------------------------------------------------------- |
| Electron アプリ全体 | 起動と初期表示                   | 実装済み | [tests/e2e/app.smoke.spec.js](../tests/e2e/app.smoke.spec.js) |
| Electron アプリ全体 | 保存済みデータ読み込み           | 実装済み | [tests/e2e/app.smoke.spec.js](../tests/e2e/app.smoke.spec.js) |
| Electron アプリ全体 | タスクフィルタ                   | 実装済み | [tests/e2e/app.smoke.spec.js](../tests/e2e/app.smoke.spec.js) |
| Electron アプリ全体 | ページ内検索バー表示と close     | 実装済み | [tests/e2e/app.smoke.spec.js](../tests/e2e/app.smoke.spec.js) |
| Electron アプリ全体 | タスク追加から保存まで           | 実装済み | [tests/e2e/app.smoke.spec.js](../tests/e2e/app.smoke.spec.js) |
| Electron アプリ全体 | テーマ変更の保存                 | 実装済み | [tests/e2e/app.smoke.spec.js](../tests/e2e/app.smoke.spec.js) |
| Electron アプリ全体 | タスク詳細ウィンドウの表示と同期 | 実装済み | [tests/e2e/app.smoke.spec.js](../tests/e2e/app.smoke.spec.js) |

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

## 6. 現在の合計件数

| 種別         | 件数                              |
| ------------ | --------------------------------- |
| Test files   | unit 19 passed + component 18 passed (37) |
| Tests        | unit 324 passed + component 126 passed / 7 skipped (450 / 7) |
| svelte-check | 455 files / 0 errors / 0 warnings |
