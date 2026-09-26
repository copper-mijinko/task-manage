# アーキテクチャ — Task Manage

← [outline.md](outline.md)

## 1. 目的

本文書は Task Manage デスクトップアプリのソースコード構造、ディレクトリ命名規約、import 規約、コンポーネント階層の設計指針を規定する。
新規開発者・コードレビューア・保守担当者の参照基盤とする。

## 2. ソースコード階層

```
electron/                        # main プロセス
├── index.js                     # 起動とウィンドウ生成、各 IPC モジュールの登録だけを行う
├── preload.js                   # contextBridge で window.electronAPI を公開
├── app-paths.js                 # データディレクトリ（TASK_MANAGE_DATA_DIR）の解決
├── settings-store.js            # meta.json（アプリ設定）の読み書き。原子的書込 + 遅延保存
├── ipc-registrar.js             # 送信元を検証する ipcMain ラッパと broadcast
├── ipc-security.js              # 外部 URL・ワークスペースパスの検証
├── ipc/
│   ├── settings-ipc.js          # get/set/delete-meta-data・テーマ
│   ├── workspace-ipc.js         # ws:* チャネル（グラフの読み書き・Undo/Redo・画像/添付・取り込み）
│   ├── external-ipc.js          # 外部リンク・画像の表示
│   └── find-in-page-ipc.js      # 画面内検索
├── task-detail-window.js        # ノード詳細の別ウィンドウ
├── window-controls.js           # ズーム・ナビゲーション拒否・ウィンドウ操作 IPC
├── window-state.js              # ウィンドウ位置・大きさの保存と復元
├── os-open.js                   # OS のファイラ・プログラム選択で開く
├── workspace-application.js     # ワークスペース単位のアプリケーション層（読込・コマンド実行・通知）
├── workspace-graph.js           # graph-v1.json の保存・履歴・資産・Markdown 取り込み
├── workspace-graph-engine.js    # グラフのコマンド適用（純粋関数）
├── workspace.js                 # 旧 Markdown 形式の読み取り専用リーダ（取り込み元）
├── performance-metrics.js       # 起動・詳細ウィンドウの計測
└── agent-debug.js               # 開発用 CDP（loopback のみ）

src/
├── lib/                         # 再利用可能な汎用層（ドメイン非依存）
│   ├── primitives/              # アトミックUI（Button / Card / Dialog / Select / TagField 等）
│   ├── layouts/                 # Pane / SplitPanes
│   ├── actions/                 # tooltip / ripple / clickOutside / globalDismiss / modal_layer / viewport_popover
│   ├── utils/                   # tags / theme / datetime_shortcuts / parent_links / date_urgency 等
│   └── ipc/
│       └── platform.ts          # window.electronAPI の Promise ラッパ
│
├── features/                    # ドメイン固有モジュール
│   ├── workspace/
│   │   ├── application/         # treegrid.js（ツリーグリッドのアプリケーション）/ tree_projection / expansion
│   │   ├── components/          # WorkspaceSetup / WorkspaceTreeGridPage / WorkspaceTaskDetail ほか
│   │   ├── stores/              # graph（グラフ本体・Undo/Redo）/ workspace（登録済みワークスペース）
│   │   └── utils/               # graph_projection
│   ├── tasks/
│   │   ├── components/          # TreeTable / TreeTableHeader / TreeTableRow / TaskDetail / TaskName / TaskMenu 等
│   │   ├── stores/              # column_settings / column_layout / sort
│   │   └── utils/               # tree_control（ツリー表示用の純粋関数）/ virtual_rows
│   ├── memos/
│   │   ├── components/          # Memo / MarkdownMemo / QuillMemo
│   │   ├── stores/              # tags / pending_drafts
│   │   └── utils/               # memo_utils / markdown_security
│   ├── gantt/                   # GanttPanel / NodeGanttPanel / gantt ストア / node_schedule
│   ├── inbox/                   # QuickCapture / inbox ストア（グラフから件数を派生）
│   ├── agenda/                  # 予定ビューの選択状態
│   ├── settings/                # SettingsModal
│   ├── search/                  # PageSearchBox / 列フィルタパネル / search ストア / page_search_highlighter
│   └── navigation/              # Header / MenuList
│
├── pages/
│   ├── MainPage.svelte          # メインウィンドウのプロジェクト画面
│   └── TaskDetailPage.svelte    # ノード詳細ウィンドウの本体
│
├── stores/                      # 横断ストア
│   ├── ui.ts                    # 選択・現在行の経路・パネル開閉・show_archived
│   ├── save_status.ts           # 保存状態
│   ├── theme.ts                 # テーマ
│   ├── preferences.ts           # ユーザ設定（date_time_format 等）
│   ├── navigation_history.ts    # 戻る・進む
│   ├── panel_coordinator.ts     # ポップオーバー調停
│   └── index.ts                 # バレルと init_store / init_detail_store
│
├── types/                       # app.ts / workspace.ts / workspace_graph.ts
├── App.svelte                   # メインウィンドウのルート
├── TaskDetailApp.svelte         # ノード詳細ウィンドウのルート
├── main.ts / detail.ts          # 各ウィンドウの Vite エントリ
└── global.d.ts / svelte.d.ts
```

## 3. レイヤー責務

### 3.1 `lib/`（再利用層）

- **依存禁止**: `features/*`、`pages/*`、`stores/*` のいずれにも依存してはならない
- **依存許可**: 同レイヤ内 (`@lib/*`)、外部ライブラリのみ
- 他プロジェクトへの切り出しを可能な品質を維持する

| サブディレクトリ | 役割                                                       |
| ---------------- | ---------------------------------------------------------- |
| `primitives/`    | 単独で意味を持つ最小UI要素。プロパティとイベントのみで構成 |
| `layouts/`       | 子要素の配置と分割を担う                                   |
| `actions/`       | Svelte `use:xxx` ディレクティブ用関数                      |
| `utils/`         | 純粋関数・型定義・トークン                                 |
| `ipc/`           | Electron preload 経由の通信ラッパ                          |

### 3.2 `features/<domain>/`（ドメイン層）

- 同一 feature 内の `components`/`stores`/`utils` は相互依存可
- 他 feature の `components/` を import するのは原則禁止（pages から組み合わせる）
- 他 feature の `stores/` / `utils/` は import 可（読み取り中心）

ドメイン分割:

| ドメイン     | スコープ                                            |
| ------------ | --------------------------------------------------- |
| `workspace`  | ワークスペースの登録、グラフ（正本）とツリーグリッドのアプリケーション |
| `tasks`      | ツリー表示、行/列操作、ノード詳細                   |
| `memos`      | ノード本文のエディタ（Markdown/Quill）とタグ管理     |
| `gantt`      | 時系列可視化                                        |
| `inbox`      | ワークスペースの Inbox ノードへのクイックキャプチャ |
| `agenda`     | 予定ビューの選択状態                                |
| `search`     | フィルター・ページ内検索                            |
| `settings`   | アプリ全体の設定モーダル                            |
| `navigation` | サイドナビ、トップヘッダー、Info                    |

### 3.3 `pages/`（画面層）

- 複数 feature を組み合わせて画面を構成
- `lib/*`、`features/*`、`stores/*`、`types/*` すべてを import 可
- ウィンドウ単位で配置（メインウィンドウ、ノード詳細サブウィンドウ）

### 3.4 `stores/`（横断状態層）

- 複数 feature 間で共有される状態のみを置く
- feature 固有のストアは `features/<domain>/stores/` へ
- `stores/index.ts` は互換のため feature ストアも再エクスポートする（barrel）

### 3.5 `types/`（共有型層）

- 複数 feature から参照される型を置く
- feature 固有型は `features/<domain>/types.ts` でも可（必要時）

## 4. import 規約

### 4.1 パスエイリアス

`vite.config.js` / `tsconfig.json` / `vitest.config.mjs` に統一定義:

| エイリアス     | 解決先           | 使用例                                                    |
| -------------- | ---------------- | --------------------------------------------------------- |
| `@lib/*`       | `src/lib/*`      | `import Button from "@lib/primitives/Button.svelte"`      |
| `@features/*`  | `src/features/*` | `import { workspace_graph } from "@features/workspace/stores/graph"` |
| `@pages/*`     | `src/pages/*`    | `import MainPage from "@pages/MainPage.svelte"`           |
| `@stores/*`    | `src/stores/*`   | `import { ui } from "@stores/ui"`                         |
| `@app-types/*` | `src/types/*`    | `import type { TreeData } from "@app-types/app"`          |

> **注意**: `@types/*` は npm の `@types/*` 名前空間と衝突するため使用しない。`@app-types/*` で代替。

### 4.2 ベストプラクティス

- **同一ディレクトリ内**: 相対パス `./X.svelte` を許容
- **異ディレクトリ間**: 必ずエイリアスを使用
- **拡張子の省略**: TS/JS は省略可、Svelte は必須

### 4.3 import 並び順

```ts
// 1. 外部ライブラリ
import { writable } from "svelte/store";

// 2. @lib（プリミティブ層）
import Button from "@lib/primitives/Button.svelte";

// 3. @features（ドメイン層）
import { workspace_graph } from "@features/workspace/stores/graph";

// 4. @stores（横断ストア）
import { ui } from "@stores/ui";

// 5. @app-types（型）
import type { TreeData } from "@app-types/app";

// 6. 相対 import（同ディレクトリ内）
import LocalComponent from "./LocalComponent.svelte";
```

## 5. ストア構成

### 5.1 ストア一覧

| ストア                                                          | 配置                                             | 役割                                                    |
| --------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `workspace_graph_store` / `workspace_graph` / `can_undo_graph` / `can_redo_graph` | `@features/workspace/stores/graph`               | 開いているワークスペースのグラフ（正本の写し）と Undo/Redo |
| `workspace_store`                                               | `@features/workspace/stores/workspace`           | 登録済みワークスペースの一覧と、開いているワークスペース |
| `column_settings`                                               | `@features/tasks/stores/column_settings`         | 列の幅・順序・可視性                                    |
| `sort_state`                                                    | `@features/tasks/stores/sort`                    | ソート状態                                              |
| `tag_index` / `active_tag`                                      | `@features/memos/stores/tags`                    | タグインデックス・選択中タグ                            |
| `ganttVisible` / `ganttScale` 等                                | `@features/gantt/stores/gantt`                   | Gantt 表示設定                                          |
| `inbox_count`                                                   | `@features/inbox/stores/inbox`                   | Inbox ノード直下の未アーカイブ件数（グラフから派生）    |
| `filter` / `pageSearchQuery`                                    | `@features/search/stores/search`                 | フィルター条件 / 画面内検索クエリ                       |
| `pageSearchMatchCount` / `pageSearchCurrentIndex`               | `@features/search/utils/page_search_highlighter` | 画面内検索の件数と現在位置（readable store）            |
| `selected_id` / `table_selected_id` / `active_row_path` / `selected_ids` / `show_archived` / `sidebarCollapsed` 等 | `@stores/ui`                                     | UI 状態。`active_row_path` はいま操作している行（辺）。`show_archived` はスコープごとに `meta.json` へ保存 |
| `saveStatus`                                                    | `@stores/save_status`                            | グラフ保存の状態（`@stores/ui` からも再エクスポート）   |
| `theme`                                                         | `@stores/theme`                                  | テーマ                                                  |
| `date_time_format`                                              | `@stores/preferences`                            | 入力ショートカット（`Ctrl+;` / `Ctrl+:`）の挿入フォーマット |
| `panelCoordinator`                                              | `@stores/panel_coordinator`                      | ポップオーバー調停                                      |
| `navigation_history` / `canGoBack` / `canGoForward`             | `@stores/navigation_history`                     | ページ遷移履歴（ブラウザ風の戻る／進む）                |

ツリーの展開状態・コピー中のノード・スコープなど、ツリーグリッド 1 枚ごとの状態は
ストアではなく `createTreeGridApplication()`（`@features/workspace/application/treegrid`）
が持ち、コンポーネントへはコンテキスト `TREEGRID_APPLICATION` で渡す。

### 5.2 init_store()

`src/stores/index.ts` の `init_store()` がメインウィンドウの起動時に全ストアを初期化する。
ノード詳細ウィンドウは `init_detail_store()`（テーマと設定のみ）を使う。
追加ストアは原則ここに登録する。

## 6. ビルド・テスト・開発

### 6.1 npm scripts

| コマンド                 | 内容                                        |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | Vite 開発サーバー + Electron 起動           |
| `npm run build`          | Vite による production ビルド → `renderer/` |
| `npm run start`          | Electron 単体起動                           |
| `npm run check`          | svelte-check による型・テンプレ検証         |
| `npm run test:unit`      | Vitest（`tests/unit/`）                     |
| `npm run test:component` | Vitest（`tests/component/`）                |
| `npm run test:e2e`       | Playwright                                  |
| `npm run dist`           | electron-builder で実行ファイル生成         |

### 6.2 検証

CI（`.github/workflows/`）と同じ `npm run lint` / `npm run check` / `npm test` /
`npm run test:e2e` を手元でも通してからプッシュする。件数は変わるため本書には記録しない。

## 7. コンポーネント / ファイル対応表

| 領域                                                               | ファイル                                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| メインウィンドウ                                                   | `src/App.svelte` + `src/pages/MainPage.svelte`                                                                                                   |
| ノード詳細ウィンドウ | `src/TaskDetailApp.svelte` → `WorkspaceTaskDetail.svelte` → `src/pages/TaskDetailPage.svelte`。main 側は `electron/task-detail-window.js` |
| ヘッダ（含 画面内検索 + サイドバートグル + 保存状態 + テーマ切替） | `src/features/navigation/components/Header.svelte`                                                                                               |
| 左サイドバー（永続表示）                                           | `src/App.svelte` に直接配置 + `src/features/navigation/components/MenuList.svelte`                                                               |
| サイドバー Workspace / Tags 各セクション         | `MenuList.svelte` 内の `.Section` + `.Contents` パターン                                                                                         |
| プロジェクトエリア                                                 | `src/pages/MainPage.svelte`                                                                                                                      |
| ツリーペイン                                                       | `src/features/tasks/components/TreeTable.svelte` + `TreeTableHeader.svelte` + `TreeTableRow.svelte`                                              |
| ガントペイン                                                       | `src/features/gantt/components/GanttPanel.svelte`                                                                                                |
| 右ペイン（Task Detail + Memo の単一 Card / Card 内部で上下分割）   | `src/features/tasks/components/TaskDetail.svelte`                                                                                                |
| ノード添付ファイル UI                                              | `src/features/tasks/components/TaskAttachments.svelte`                                                                                           |
| ノード本文エディタ                                                 | `src/features/memos/components/Memo.svelte` → `MarkdownMemo.svelte` / `QuillMemo.svelte`                                                         |
| セグメントコントロール                                             | `src/lib/primitives/SegmentedControl.svelte`（Memo フォーマット切替・Markdown Read/Edit 切替で共用）                                             |
| ダイアログ                                                         | `@lib/primitives/Dialog.svelte` を使用した個別実装（ノード削除、アーカイブ範囲の選択など） |
| ページ内ハイライト検索                                             | `Header.svelte` の検索ボックス + `@features/search/utils/page_search_highlighter.ts`                                                             |
| 列ヘッダのフィルタ / 列設定ポップオーバー                          | `TreeTableHeader.svelte` + `@features/search/components/*FilterPanel.svelte`                                                                     |
| ツリーの三点リーダメニュー                                         | `TaskMenu.svelte` + `TaskName.svelte`                                                                                                            |
| ワークスペース管理ダイアログ | `WorkspaceSetup.svelte`（登録・切替・削除、旧 Markdown 形式からの取り込み） |
| ウィンドウ状態の保存 / 復元（main プロセス） | `electron/window-state.js`（`loadWindowState` / `trackWindowState`）+ `electron/index.js` の BrowserWindow 生成 |
| グラフの保存（main プロセス） | `electron/workspace-graph.js` + `electron/workspace-graph-engine.js` + `electron/workspace-application.js` + `electron/ipc/workspace-ipc.js`（§ 8.9） |
| 保存エラーのバナー | `src/App.svelte` の `save-error-banner`（`saveStatus` が `error` のとき） |
| 予定ビューの選択状態 | `src/features/agenda/stores/agenda.ts`（`AGENDA_SELECTED_ID`） |
| ノードのタグ | `src/lib/primitives/TagField.svelte` + `src/lib/utils/tags.ts` + `TaskDetail.svelte` のタグ欄 + `TreeTableRow.svelte` の `tags` 列 + `@features/memos/stores/tags` の統合索引。保存先はグラフのノードの `tags` |
| Inbox UI | `src/features/inbox/components/QuickCapture.svelte`（`workspaceApplication.capture` でワークスペースの Inbox ノードへ追加） |
| Inbox 入り口 | `Ctrl+Shift+I`（`App.svelte` のグローバル keydown）でクイックキャプチャを開く。Inbox ノード自体はツリーに表示される |
| 設定モーダル                                                       | `src/features/settings/components/SettingsModal.svelte`、トリガは `Header.svelte` の ⚙ ボタン                                                    |
| 入力ショートカット（日付・時刻）                                   | `src/lib/utils/datetime_shortcuts.ts`（`registerDateTimeShortcuts`）、`App.svelte` の `onMount` で登録                                            |
| ページ遷移履歴（戻る・進む）                                       | `src/stores/navigation_history.ts`（`navigation_history` / `canGoBack` / `canGoForward`）+ `Header.svelte` の戻る／進むボタン + `App.svelte` のショートカット (Alt+←/Alt+→) と XButton 受け |
| 多親（行＝辺） | グラフの `parents`（辺）をツリーに射影する `src/features/workspace/application/tree_projection.js` + 展開状態の `expansion.js` + `tree_control.ts` の経路 API（`getNodeByPath` / `parentPathOf` / `pathLeafId` / `pathIncludesNode` / `collectTreePaths`）+ `@stores/ui` の `active_row_path` + `TreeTable.svelte` / `TreeTableRow.svelte`（`data-row-path` / `EchoRow`）+ `src/lib/utils/parent_links.ts`（親リンクの正規化） |
| 親の付け外し                                                       | `src/features/tasks/components/ParentField.svelte` + `TaskDetail.svelte` の親フィールド（候補から自分自身と子孫を除いて循環を防ぐ / 唯一の親は外せない） |
| アーカイブ（論理削除） | グラフエンジンの `update-node`（`archived`）と `archive-edge` + ツリーグリッドの `archive` / `archiveEdge` / `restoreOccurrence` + `ArchiveScopeDialog.svelte` + `@stores/ui` の `show_archived`（§ 8.13） |

## 8. 主要パターン

### 8.1 ポップオーバー dismiss（`globalDismiss` action）

`src/lib/actions/index.ts` の `globalDismiss(node, callback)` action は、画面上に開いている
ポップオーバー / メニューを「画面上の任意の場所をクリック」で閉じるための共通実装。

- capture phase の `pointerdown` と `mousedown` を `document` に登録する
- 加えて `contextmenu`、`Escape` keydown、`window.blur` も dismiss イベントとして扱う
- `disabled` な `<button>` でも `pointerdown` は届くため、機能無効ボタン上のクリックでも確実に閉じる
- 利用箇所
  - `TreeTableHeader.svelte` の列設定ポップオーバー
  - `NameFilterPanel` / `StatusFilterPanel` / `DateRangePanel` / `NumberRangePanel`
  - `TaskMenu.svelte`（同等のロジックを `attachListeners` 内で実装）
  - `StatusSelect.svelte` の選択肢ポップアップ

### 8.2 画面内ハイライト検索（CSS Custom Highlight API）

`@features/search/utils/page_search_highlighter.ts` がシングルトンとして文書全体のハイライト
処理を担当する。

- `setQuery(q)` でデバウンス（120ms）した `scanForMatches` を実行し、`Range` の配列を構築
- `CSS.highlights.set("page-search", new Highlight(...ranges))` で全マッチを着色
- `next()` / `prev()` で現在の一致を `page-search-current` という別 highlight 名に切替、scroll-into-view
- 公開する readable store: `pageSearchMatchCount`、`pageSearchCurrentIndex`
- `startAutoRescan()` で `MutationObserver` を起動し、DOM 変更時に再スキャン（本文表示後など）
- 除外条件
  - `script` / `style` / `noscript` / `template`
  - `input` / `textarea` / `select`（検索ボックス自体の文字列を拾わないため）
  - `.ql-toolbar` / `.ql-tooltip` / `.ql-clipboard`（Quill の不可視ノード）
  - `[data-page-search-skip]` 配下（ヘッダや検索 UI 自身に付与）
  - `getBoundingClientRect()` がゼロサイズの要素、`display: none` / `visibility: hidden`
- CSS は `public/global.css` の `::highlight(page-search)` / `::highlight(page-search-current)` で定義

### 8.3 リサイザー snap-collapse（`SplitPanes.svelte`）

- ドラッグ中はカーソルに raw 追従。閾値で止めない
- マウスアップ時、ペイン幅が `min × 0.6` 未満なら 0px に snap、それ以外は `min` にクランプ
- ペイン幅が 0 になったら、インラインスタイルで `min-width: 0` も付与する（consumer の CSS `min-width` を上書き）
- ペインに `PaneCollapsed` クラス、隣のリサイザーに `HasCollapsedNeighbour` クラスを付け、CSS でヒット幅を 5px → 14px に拡大、色を Primary 系に変える

### 8.4 ツリー列幅の維持

- ユーザーがドラッグした列幅は inline `style.width` で保持
- ペインリサイズ時の `ResizeObserver` では、`name` 列だけ
  `max(nameMinWidth, tableWidth − checkboxColumnWidth − fixedTotal)` で再計算する
- 折りたたみ・展開時の `MutationObserver` 経由 createResizers は `getBoundingClientRect` ではなく
  `header.style.width` を読む。サブピクセル誤差の累積を避ける目的
- チェックボックス列はヘッダ・データ行ともに `border-box` の固定外寸として扱う。
  JS 側の列幅計算はヘッダの `.CheckboxHeaderCell` 幅を基準にするため、行側も同じ外寸に揃える
- リサイザ位置は `positionResizers()` で一元計算する。初期配置、ドラッグ中、行再同期、
  ペインリサイズ後の再配置を同じ「チェックボックス列幅 + 各データ列幅」の座標系に揃える

### 8.5 ステータス選択（`StatusSelect.svelte`）

`<select>` を使うと選択肢リスト全体に `color` が継承され、ステータスごとの色がリスト本体にも
反映されてしまうため、ボタン + 自前ポップアップで再実装した。

- `dispatch("change", { target: { value }, value })` の形で従来の DOM API 互換を維持
- `aria-label="Status"` を一定値で出すことで testing-library 互換のテストが書ける
- `<button role="option">` 要素に click を登録し、`<li>` ではなくボタンに直接アクションする

### 8.6 グローバルツールチップ管理（`lib/actions/index.ts`）

- 各 `tooltip` action はマウントしたツールチップ要素を `activeTooltips: Set<TooltipEntry>` に登録
- `mousedown` / `scroll` / `wheel` / `keydown` / `visibilitychange` / `blur` を listen して、
  アンカー要素が DOM から消えた / hover 状態が外れたツールチップを掃除（`sweepTooltips`）
- 生存中のツールチップが 1 件以上ある時のみ 1 秒間隔の safety sweep を再帰スケジュールする
- `tooltip` action は `update()` ライフサイクルメソッドを持ち、`tooltipContent` などのプロパティ
  変化を即座に反映する（サイドバー開閉時の「表示 / 閉じる」ラベル切替など）

### 8.7 ガントの今日表示

- ヘッダ・ボディともに 1 日分の Accent 色帯（最小 8px）と細い縦線を重ねる
- z-index は `HeaderCell` / `GanttRow` より上、`Bar` より下
- 起動時とスケール変更時に `centerOnToday()` を 2x `requestAnimationFrame` で実行
- スケール変更は `ganttScale.subscribe` で監視（リアクティブブロックではテスト環境で
  追加の再描画サイクルが発生したため）

### 8.8 ノードの削除

- ツリーグリッドの `remove(id)` がグラフコマンド `delete-node` を送る。表示中のスコープ（ルート）と保護ノード（ワークスペースのルート・Inbox）は対象外
- 削除は Undo で戻せる。ディスク上の画像・添付ファイルは消さない
- プロジェクトはワークスペースのルート直下のノードであり、専用の削除経路は持たない

### 8.9 グラフの保存

ワークスペースの正本は `<workspace>/.task-manage/graph-v1.json` 1 ファイル（形式は
[data.md](data.md) § 3）。main プロセスだけが読み書きし、renderer はコマンドを送って
結果のグラフを受け取る。

```
[ renderer ]  treegrid.js / WorkspaceSetup / QuickCapture
        │  workspace_graph_store.execute(command) → ws:execute-graph-command(workspacePath, command, source, expectedRevision)
        ▼
[ main ]  workspace-ipc.js → workspace-application.js
        │  workspace-graph.js: mutate（ワークスペースごとに直列化）
        │    ├─ revision の照合（古い revision からのコマンドは拒否）
        │    ├─ workspace-graph-engine.js でコマンドを適用し、逆パッチを Undo 履歴へ（最大 50）
        │    └─ atomicWriteFile（tmp → rename）で graph-v1.json を置き換え
        ▼
  戻り値の新しいグラフ + broadcast("workspace-graph-updated", { workspacePath, graph })
        ▼
[ renderer windows ]  workspace_graph_store が新しい revision のグラフで置き換え
```

#### 構成要素

| 要素 | 配置 | 役割 |
| --- | --- | --- |
| コマンド適用 | `electron/workspace-graph-engine.js` | `create-node` / `update-node` / `link` / `detach` / `move` / `archive-edge` / `delete-node` / `copy` / `set-position` / `batch` を純粋関数として適用し、逆パッチを返す |
| 保存と履歴 | `electron/workspace-graph.js` | `readGraph` / `executeCommand` / `undo` / `redo`、画像・添付の保存、旧 Markdown 形式からの取り込み（`importMarkdownProjects`）、`hasPendingWrites` / `whenIdle` |
| アプリケーション層 | `electron/workspace-application.js` | ワークスペースの認可済みパスでの読込とコマンド実行、更新の通知 |
| IPC | `electron/ipc/workspace-ipc.js` | `ws:*` チャネルの登録。登録済みでないワークスペースへのアクセスは拒否する |
| renderer ストア | `src/features/workspace/stores/graph.ts` | グラフの写し、`execute` / `undo` / `redo`、`saveStatus` の更新 |

#### 保存状態

`SaveStatus = "idle" | "queued" | "writing" | "saved" | "error"`

`workspace_graph_store` はコマンド送信時に `writing`、成功で `saved`、失敗で `error` にする。
`error` のあいだ `App.svelte` は保存エラーのバナーを出す。ヘッダの保存状態表示も同じストアを読む。

#### 別ウィンドウとの同期

ノード詳細ウィンドウを含むすべてのウィンドウは `workspace-graph-updated` を受け取り、
手元より新しい revision のグラフだけを採用する。どのウィンドウから編集しても正本は 1 つなので、
競合の解決は revision の照合だけで済む。

#### 終了時

`app.on("before-quit")` で設定（`meta.json`）を同期的に書き出し、`workspaceGraph.hasPendingWrites()`
が真なら `whenIdle()` を待ってから終了する。

### 8.10 入力ショートカット（日付・時刻）の挿入経路

`Ctrl+;` / `Ctrl+:` で現在の日付・時刻を挿入するハンドラは `src/lib/utils/datetime_shortcuts.ts` に置く。`App.svelte` の `onMount` で `window.keydown` に **capture phase** で登録する。

capture phase を選ぶ理由は、CodeMirror / Quill が自前のキーマップを `.cm-editor` / `.ql-editor` 上に持つため、bubble phase で受けると先に `;` / `:` がエディタへリテラル入力されてしまうため。`event.preventDefault()` + `event.stopPropagation()` でエディタへの伝播を遮断する。

挿入先のディスパッチ:

- `<input type="date|time|datetime-local|month|week">` → 仕様通りの ISO 値を `element.value` に直接代入し、`input` / `change` イベントを発火
- `<input>` / `<textarea>` → `selectionStart/End` を読んでキャレット位置に挿入
- `.cm-editor` 配下 → `EditorView.findFromDOM` で EditorView を取得し `dispatch({ changes, selection })`
- `.ql-editor` 配下 → 親方向に `Quill.find` を辿って Quill インスタンスを取得し `insertText(index, text, "user")`
- その他 `contenteditable` → `document.execCommand("insertText")`（Electron / Chromium で引き続き有効）

フォーマットは `@stores/preferences` の `date_time_format` から取得する。

### 8.11 本文フォーマットの責務分離

ノード単位のフォーマット（Markdown / Quill）は次の責務分担で扱う。

- **レンダラ分岐**: `src/features/memos/components/Memo.svelte` が `MemoEntry.format` を参照し、`MarkdownMemo.svelte` / `QuillMemo.svelte` のいずれかをマウントする
- **正規化と変換**: `src/features/memos/utils/memo_utils.ts` が省略時デフォルトの解決と Markdown ⇄ Quill 変換を行う。個別変換・一括変換のいずれも本ユーティリティを経由する
- **保存形式**: 本文はグラフのノードの `body`（`{ format, content }`）として `graph-v1.json` に入る（[data.md](data.md) § 6）
- **Undo 記録**: フォーマットの変更も `update-node` コマンドなので、グラフの Undo 履歴に 1 操作として残る
- **UI セグメント**: 本文のフォーマット切替と、Markdown の Read / Edit モード切替は共通プリミティブ `src/lib/primitives/SegmentedControl.svelte` を使用し、アクティブ状態・セパレータ・キーボードフォーカス表現を統一する

### 8.12 ページ遷移履歴（戻る・進む）

ブラウザ風の戻る・進むナビゲーションは `src/stores/navigation_history.ts` の `navigation_history` ストアで実現する。

- **「ページ」の定義**: `selected_type`（`"WorkspaceProject"`）・`selected_id`（開いているスコープのノード id）・`workspace_store.activeWorkspacePath` の 3 軸で同定する
- **エントリ形**: `{ selectedType, selectedId, workspacePath, tableSelectedId, occurrencePath? }`。`tableSelectedId` / `occurrencePath` を含めるのは、戻ったときに TaskDetail / Memo のコンテキストと多親ノードの行（辺）も復元するため
- **状態**: `{ entries: NavigationEntry[], index: number }`。`index === -1` は履歴なし。最大 100 件で、超過分は古い側から FIFO で落とす
- **2 つの push 経路**:
  1. **subscriber 経由（ページ切替の自動 push）**: `init()` で各 store に `subscribe` を張り、microtask 1 回にコアレスして、ページが変わったときだけ新エントリを push する。このとき `tableSelectedId` は `undefined` にする（切替直後の `table_selected_id` には旧ページの値が残っているため）
  2. **`pushSelection()` 経由（ユーザクリックの明示 push）**: `TreeTable` の行選択直後に同期で呼ぶ
- **fill-in**: 同ページで `tableSelectedId` が未確定のエントリに限り、最初に定まった値を 1 回だけ書き込む（読み込み直後の自動選択を取り込むため）
- **着地待ち（`pendingNavigation`）**: `back()` / `forward()` 中は target を保持し、着地を確認するか別ページへ動いた時点でクリアする
- **ページ跨ぎの行選択の復元**: `setPendingTaskDetailSelection({ projectId, taskId, occurrencePath })` に詰め、ツリーグリッドが読み込み後に選択する
- **forward truncate / 空状態スキップ / flush**: 戻った状態から新規ページへ移ると進む側を切り捨てる。`(undefined, undefined)` は積まない。`back()` / `forward()` の冒頭で未消化の記録を同期消費する
- **サブウィンドウでは無効**: ノード詳細ウィンドウは `init_detail_store()` を使うため履歴を持たない
- **入力経路**: `Header.svelte` の戻る／進むボタン、`App.svelte` の `Alt+ArrowLeft` / `Alt+ArrowRight`（テキスト編集中はエディタに委ねる）、マウスの XButton（`event.button === 3` / `4`）
- **対象外**: マルチ選択、追加・コピー・移動の副作用としての選択変更

### 8.13 アーカイブ（論理削除）

「削除」は 2 段階で扱う。1 段目がアーカイブ、2 段目が完全削除（§ 8.8）。

#### モデル

- ノードのアーカイブ: `update-node` で `archived` / `archivedAt` を付ける。ノードはすべての親の下で片付く
- 辺のアーカイブ: `archive-edge` でその親の下からだけ片付ける（多親ノードの一部の出現だけを隠す）
- どちらも子孫へは伝播しない。表示時に祖先がアーカイブ済みなら子孫も隠れる
- `show_archived`（`@stores/ui`、スコープごとに `meta.json` へ保存）が表示の足切りを担う

#### 操作の振り分け

- 通常行の削除操作はアーカイブ。多親ノードでは `ArchiveScopeDialog.svelte` で「この親の下だけ／すべて」を選ぶ
- アーカイブ済みの行では完全削除と復元（`restoreOccurrence`）を選べる
- マルチ選択の削除は、通常行をアーカイブ、アーカイブ済みの行を完全削除に自動で振り分ける

#### 読み取り専用化

- アーカイブ済みノードの行・詳細ペインは編集を受け付けない（`TreeTableRow` / `TaskName` / `TaskDetail` が `archived` を見て入力を止め、詳細ペインはバナーを出す）

### 8.14 Svelte 5 の書き方

コンポーネントはすべて runes で書く。旧記法（`export let` / `$:` / `on:` / `createEventDispatcher` / `<slot>`）は使わない。

- **props**: `let { ... } = $props()`。JS のコンポーネントは JSDoc の `@typedef Props` で型を書く
- **イベント**: 子から親への通知はコールバック prop にする。名前は `on` + イベント名の小文字（`onchange` / `onaddchild`）。引数は値そのもの（`CustomEvent` の `detail` で包まない）
- **メニュー**: `TaskMenu` は選んだ項目を `onaction(item)` で 1 本にまとめて渡し、受け側が `item.action` で振り分ける
- **状態**: 描画に使う値は `$state` / `$derived`。描画に使わない控え（前回値・タイマー id など）は普通の `let` にする。`$state` にすると、それを読み書きする `$effect` が自分自身を起こし直す
- **外から来たオブジェクト**: エディタの内容など、同一性を比べたり IPC に渡したりするオブジェクトは `$state.raw` に入れる。`$state` は中身を Proxy に包むので `===` が成り立たず、IPC の structured clone もできない
- **IPC の境界**: `src/lib/ipc/platform.ts` は送る値を素のオブジェクトへ写してから渡す（`plain()`）。どこかの `$state` から来た値でも送れる
- **副作用**: 値を計算するだけなら `$derived` / `$derived.by`。ストアへの書込みや、ある値が変わったときに別の状態を戻す処理は `$effect.pre`
