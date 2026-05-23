# 性能設計

← [outline.md](outline.md)

## 1. 目的

本文書は、起動時とワークスペースプロジェクト選択時の読み込みを軽く保つための実装上の約束をまとめる。
対象は、Electron main process、renderer の初期バンドル、ワークスペース Markdown 読み込み、メモ本文の遅延読み込みである。

## 2. 起動時の読み込み

### 2.1 renderer 初期バンドル

起動直後の renderer は、メモエディタ本体を eager import しない。

- `src/features/memos/components/Memo.svelte` は `MarkdownMemo.svelte` と `QuillMemo.svelte` を `import()` で遅延読み込みする
- Markdown の構文ハイライトは `MarkdownMemo.svelte` 側で設定する
- `src/features/memos/utils/memo_utils.ts` はフォーマット正規化と Markdown / Quill 変換に責務を絞り、`highlight.js` など表示専用の重い依存を読み込まない

この分離により、アプリ起動時はエディタを表示する場面まで CodeMirror、Quill、Markdown preview 周辺の大きい依存を初期評価しない。

### 2.2 main process の起動処理

main process は、起動時に不要な同期 I/O と watcher 初期化を前倒ししない。

- `electron/index.js` は `lowdb` の初期データ書き込みを、データが存在しない場合だけ行う
- ワークスペース watcher の開始は `INITIAL_WORKSPACE_WATCHER_DELAY_MS` だけ遅らせる
- renderer 表示に直接必要な処理を優先し、外部ファイル監視は初期描画後に回す

## 3. ワークスペースプロジェクト選択

### 3.1 summary read

`ws:read-project` はプロジェクト選択時の主経路であり、メモ本文を読まない。
`electron/index.js` の `readProjectSummary(projectDir)` は `workspace.readProject(projectDir, { includeMemoContent: false })` を呼ぶ。

summary read では次を読み込む。

- `_project.md` と各タスクの `_index.md`
- タスク名、ステータス、日付、親子関係、順序などのツリー表示に必要なメタデータ
- メモファイルの frontmatter と先頭部分から取れるタイトル、タグ、フォーマット、順序

summary read では次を読み込まない。

- 各メモ本文全体
- Markdown / Quill 本文の parse 結果
- メモ内画像や assets の内容

本文未読のメモは `bodyLoaded: false` と `content: ""` を持つ。

### 3.2 選択タスクのメモ本文 hydration

タスク詳細を表示するとき、`src/features/tasks/components/TaskDetail.svelte` は選択タスクのメモに `bodyLoaded: false` が含まれる場合だけ `wsReadTaskMemos(projectDir, taskId)` を呼ぶ。

main process 側では `ws:read-task-memos` が `workspace.readTaskMemos(projectDir, taskId, taskDirs)` を使い、そのタスクのメモ本文だけを読む。
読み込んだメモは `tree_data` と `workspace_tasks_cache` に反映され、以後同じタスクでは本文読み込み済みの状態を再利用する。

この経路は「選択された 1 タスクにつき 1 IPC」であり、プロジェクト選択時に全タスク分のメモ本文を読む N+1 読み込みを発生させない。

### 3.3 メモ本文検索

メモ本文を対象にした full-text 検索では、本文が未読のままだと正しい検索結果を作れない。
そのため `src/features/search/stores/search.ts` は、次の条件を満たすときだけプロジェクト単位でメモ本文を hydrate する。

- 選択中の対象が WorkspaceProject
- `search_memo` が有効
- `full_text` 検索語がある
- 現在のツリーに `bodyLoaded: false` のメモがある

このとき `wsReadProjectMemos(projectDir)` を 1 回だけ呼び、main process の `ws:read-project-memos` がプロジェクト内タスクのメモ本文をまとめて返す。
renderer は返却された `memosByTaskId` を `tree_data` と `workspace_tasks_cache` にマージする。

通常のプロジェクト選択やタスク名・ステータス検索では、このプロジェクト全体 hydration は行わない。

## 4. 未読本文を含む保存

summary read 後のツリーには、本文未読のメモが混ざる。
その状態で保存してもメモ本文を空文字で上書きしないよう、保存前に既存本文を復元する。

- renderer 側の `src/features/workspace/utils/workspace_tree.ts` は、`bodyLoaded: false` のメモについて既存ツリーの本文を優先して保持する
- main process 側の `withLoadedMemoBodies(projectDir, tasks, taskDirs)` は、未読本文が残るタスクを保存する前に disk/cache から本文を補完する
- `ws:write-task` と `ws:write-project` は、未読本文を含む payload をそのままファイルへ書かない

この方針により、プロジェクト選択は軽い summary read のままにしつつ、保存時のデータ欠落を防ぐ。

## 5. 守るべき境界

性能を保つため、次の境界を維持する。

- 起動経路から `MarkdownMemo.svelte` / `QuillMemo.svelte` / `highlight.js` を直接 import しない
- プロジェクト選択時の `ws:read-project` は `includeMemoContent: false` を維持する
- タスク詳細では選択タスク単位、メモ本文検索ではプロジェクト単位の IPC にまとめる
- プロジェクト選択時にタスク数ぶん `ws:read-task-memos` を呼ぶ実装にしない
- `bodyLoaded` を renderer のツリー変換、検索、保存経路で落とさない

## 6. 検証

性能関連の変更では、少なくとも次を確認する。

- `node --check electron/index.js`
- `node --check electron/workspace.js`
- `svelte-check --tsconfig ./tsconfig.json`
- `vite build`
- `vitest run tests/unit/search.test.js tests/unit/workspace.test.js tests/unit/workspace_tree.test.ts tests/component/TaskDetail.test.js tests/component/Memo.test.js --pool=threads`

加えて、production build 後の `renderer/index.html` で起動時に preload される module 数を確認する。
メモエディタ関連 chunk が初期 modulepreload に戻っている場合は、起動経路への eager import が再発している可能性が高い。
