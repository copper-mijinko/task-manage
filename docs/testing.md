# テストガイド

← [outline.md](outline.md)

## 1. テストの種類

### 1.1 Unit テスト

main プロセスのモジュール（グラフエンジン・保存・取り込み・IPC の検証）と、renderer の純粋関数・ストアを対象にする。
`Vitest` で実行する。

### 1.2 Component テスト

`src/features/<domain>/components/` および `src/lib/primitives/` 配下の Svelte コンポーネントを対象にする。
`Vitest` と `@testing-library/svelte` を使い、入力、クリック、キー操作、イベント反映を確認する。

### 1.3 E2E テスト

Electron アプリ全体を起動して確認する。
`Playwright` を使い、一時ディレクトリに用意したワークスペース（`gr## 2. テストファイル一覧

個々のテストケースはファイルを見れば分かるので、ここではファイルと対象の対応だけを示す。

### 2.1 Unit テスト（`tests/unit/`）

| ファイル | 対象 |
| --- | --- |
| `workspace-graph-engine.test.js` | `electron/workspace-graph-engine.js`：各コマンドの適用と逆パッチ、循環・保護ノードの拒否 |
| `workspace-graph-persistence.test.js` | `electron/workspace-graph.js`：保存・revision 照合・Undo/Redo・資産の保存と解決・パスの脱出拒否 |
| `workspace-graph-import.test.js` | `electron/workspace-graph.js`：旧 Markdown 形式の一覧と、既存グラフへの取り込み（Undo 可能） |
| `legacy-markdown-reader.test.js` | `electron/workspace.js`：旧 Markdown 形式（frontmatter・旧メモ・本文）の読み取り |
| `workspace-application.test.js` | `electron/workspace-application.js`：読込・コマンド実行・更新通知 |
| `ipc-security.test.js` | `electron/ipc-security.js`：外部 URL とワークスペースパスの検証 |
| `window-state.test.js` | `electron/window-state.js`：ウィンドウ状態の正規化・保存・復元 |
| `performance-metrics.test.js` / `event-loop-probe.test.js` | 計測まわり |
| `agent-debug.test.js` / `agent-ui-launch.test.js` / `agent-ui-runtime.test.js` | 開発用 CDP と Agent UI の起動・診断（本番では無効であること） |
| `workspace_graph_store.test.ts` | `@features/workspace/stores/graph`：読込・コマンド・保存状態 |
| `workspace_store.test.ts` | `@features/workspace/stores/workspace` |
| `graph_projection.test.ts` / `treegrid_projection.test.js` | グラフからツリー行への射影 |
| `tree_control.test.js` / `orphans.test.ts` / `archive.test.ts` / `no_status.test.ts` / `task_tags.test.js` | `tree_control.ts`：フィルタ・表示行・パンくず・経路 API・アーカイブの表示・ステータス「なし」・タグ |
| `virtual_rows.test.ts` | 仮想スクロールの行計算 |
| `column_settings.test.js` | 列の幅・順序・可視性 |
| `navigation_history.test.ts` | 戻る・進む |
| `tags.test.js` | タグ索引ストア |
| `memo_conversion.test.ts` | Markdown ⇄ Quill 変換 |
| `node_schedule.test.ts` | ガントの日程計算 |
| `page_search_highlighter.test.js` | 画面内検索 |
| `datetime_shortcuts.test.ts` / `date_urgency.test.ts` / `theme_contrast.test.ts` | 日時ショートカット・期限の緊急度・テーマのコントラスト |
| `globalDismiss.test.js` / `tooltip.test.js` / `sidebarCollapsed.test.js` | action とサイドバー |

### 2.2 Component テスト（`tests/component/`）

コンポーネントはツリーグリッドのアプリケーションをコンテキストから受け取るので、テストは次のヘルパで包んで描画する。

- `tests/helpers/graph_backend.js`：本物のグラフエンジンで動く偽の `window.electronAPI`（`installGraphBackend` / `graphFromTree`）
- `tests/helpers/render_with_graph.js` + `GraphApplicationHarness.svelte`：グラフを読み込んだアプリケーションをコンテキストに置いて描画する
- `tests/helpers/application_stub.js` + `ApplicationStubHarness.svelte`：アプリケーションを差し替えて単体で描画する

| ファイル | 対象 |
| --- | --- |
| `App.test.js` / `AppWorkspaceProject.test.js` | ルート（保存エラーのバナー、ワークスペースを開く流れ） |
| `ProjectPage.test.js` / `TreeTable.test.js` / `TreeTableRow.test.js` / `TaskName.test.js` / `TaskMenu.test.js` / `BulkActionBar.test.js` | ツリーグリッド |
| `TaskDetail.test.js` / `TaskAttachments.test.js` / `ParentField.test.js` / `StatusSelect.test.js` / `TagField.test.js` | ノード詳細 |
| `Memo.test.js` | 本文エディタ（Markdown / Quill、画像の貼り付け、リンク） |
| `GanttPanel.test.js` / `NodeGanttPanel.test.js` | ガント |
| `MenuList.test.js` / `Header.test.js` / `PageSearchBox.test.js` / `SearchBox.test.js` | ナビゲーションと検索 |
| `WorkspaceGraphViews.test.js` | グラフ／Finder ビュー（開発中） |
| `SplitPanes.test.js` / `Card.test.js` / `Modal.test.js` / `ButtonState.test.js` | プリミティブ |

### 2.3 E2E テスト（`tests/e2e/`）

| ファイル | 内容 |
| --- | --- |
| `app.smoke.spec.js` | 起動と表示、未登録ワークスペースの拒否、分割ペイン、絞り込み、画面内検索、ノード追加の保存、テーマの保存、詳細ウィンドウの同期 |
| `tags.spec.js` | タグの入力・絞り込みと再起動後の保持 |
| `workspace-treegrid.spec.js` | revision の食い違い、ガント、本文形式の変換、終了時の保存、多親・循環・添付、ドロップ、Inbox の保護、アーカイブ、詳細ウィンドウとの履歴共有、再起動をまたぐ保存 |
| `editing.spec.js` | よく使う編集の組み合わせ: 行メニュー（追加・移動・インデント・アウトデント・名前変更）と元に戻す／やり直し、キーボード操作（矢印・Home/End・Ctrl+C/V・Ctrl+A・Delete）、詳細ペインの編集と再起動をまたぐ元に戻す |
| `selection.spec.js` | 全選択・範囲選択と一括操作（状態・日付・移動・コピー）、1 回の元に戻すで 1 操作ぶん戻ること、アーカイブ済みを含む選択の削除と復元 |
| `filters.spec.js` | 全文・状態・タグの絞り込みの重ね掛けと個別解除、入力直後の別操作、編集やスコープ切替との組み合わせ、本文検索、並べ替え（保存順は変えない） |
| `workflows.spec.js` | クイック追加と Inbox のバッジ、表示密度と列の設定の再起動後の保持、大きいワークスペースでの検索・末尾移動・編集 |
| `consistency.spec.js` | 表示の整合性: 行・詳細ペイン・ガント・サイドバー・ファイルが編集／元に戻す／再起動のあとも同じ値を出すこと、状態の名前がどこでも同じこと、ツリーとガントの行の並びと高さ、多親ノードの両方の行・Inbox のバッジ・別ウィンドウの詳細 |

`support.js` は共通部品（一時ワークスペース、起動と後片付け、行や保存状態の操作）。
`run()` を通したテストは、画面で捕捉されない例外（`pageerror`）が 1 件でもあれば
失敗する。操作が「何も起きない」だけで例外が出る不具合を見逃さないため。

## 3. 実行コマンド

- `npm run check`
  - 型と Svelte の基本チェック
- `npm run test:unit`
  - Unit テストの実行
- `npm run test:component`
  - Component テストの実行
- `npm run test:e2e`
  - E2E テストの実行（先に `npm run build`。Linux では `xvfb-run -a` を付ける）
- `npm run test:all`
  - Unit、Component、E2E を順に実行

## 4. 補足

- E2E のワークスペースと `meta.json` は各テストが一時ディレクトリに作り、`TASK_MANAGE_DATA_DIR` で渡す
- GitHub Actions
  - `.github/workflows/main.yml` で `check`、`unit`、`component`、`e2e` を実行する
  - `.github/workflows/lint.yml` で `lint`（ESLint と Stylelint）と `format:check` をすべての PR で実行する
- `Playwright` の E2E は、実行環境によっては Electron の起動制約を受けることがある
