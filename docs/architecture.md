# アーキテクチャ — Task Manage

← [outline.md](outline.md)

## 1. 目的

本文書は Task Manage デスクトップアプリのソースコード構造、ディレクトリ命名規約、import 規約、コンポーネント階層の設計指針を規定する。
新規開発者・コードレビューア・保守担当者の参照基盤とする。

## 2. ソースコード階層

```
src/
├── lib/                         # 再利用可能な汎用層（ドメイン非依存）
│   ├── primitives/              # アトミックUI（13 ファイル）
│   │   ├── Button.svelte
│   │   ├── IconButton.svelte
│   │   ├── Card.svelte
│   │   ├── Modal.svelte
│   │   ├── Dialog.svelte
│   │   ├── Drawer.svelte
│   │   ├── ToggleSwitch.svelte
│   │   ├── SegmentedControl.svelte
│   │   ├── Select.svelte
│   │   ├── MultiSelect.svelte
│   │   ├── SearchBox.svelte
│   │   ├── DateInput.svelte
│   │   └── Loading.svelte       # 共通ローディング表示（opacity 呼吸アニメ）
│   ├── layouts/                 # レイアウトプリミティブ
│   │   ├── Pane.svelte
│   │   └── SplitPanes.svelte
│   ├── actions/                 # Svelte action 群
│   │   └── index.ts             # tooltip / ripple / clickOutside / globalDismiss
│   ├── utils/                   # 純粋ユーティリティ
│   │   ├── uuid.ts
│   │   └── theme.ts             # カラーパレット定義（THEME_LIGHT / THEME_DARK）
│   └── ipc/                     # Electron IPC クライアント
│       └── platform.ts          # window.api 経由の Promise ラッパ
│
├── features/                    # ドメイン固有モジュール
│   ├── tasks/                   # タスクツリー
│   │   ├── components/          # TreeTable / TreeTableHeader / TreeTableRow
│   │   │                        # TaskDetail / TaskName / TaskMenu / StatusSelect
│   │   ├── stores/              # tree / column_settings / sort
│   │   └── utils/
│   │       └── tree_control.ts  # ノード操作・フィルター・ソートロジック
│   ├── memos/
│   │   ├── components/          # MemoTab / Memo / MarkdownMemo / QuillMemo
│   │   ├── stores/              # tags
│   │   └── utils/
│   │       └── memo_utils.ts    # フォーマット正規化・Markdown ⇄ Quill 変換
│   ├── gantt/
│   │   ├── components/          # GanttPanel
│   │   └── stores/              # gantt
│   ├── workspace/
│   │   ├── components/          # WorkspaceSetup / MigrationWizard
│   │   ├── stores/              # workspace
│   │   └── utils/
│   │       └── workspace_tree.ts
│   ├── inbox/
│   │   ├── components/          # InboxPanel / InboxDetailPanel / QuickCapture / ProjectTargetPicker / TargetTreeNode
│   │   └── stores/              # inbox
│   ├── projects/
│   │   └── stores/              # project
│   ├── settings/
│   │   └── components/          # SettingsModal（カテゴリ一覧＋詳細ペインの2カラム構成）
│   ├── search/
│   │   ├── components/          # PageSearchBox / NameFilterPanel / DateRangePanel / NumberRangePanel / StatusFilterPanel
│   │   ├── stores/              # search
│   │   └── utils/
│   │       └── page_search_highlighter.ts  # CSS Custom Highlight API ベースの全文ハイライト
│   └── navigation/
│       └── components/          # MenuList / Header
│
├── pages/                       # 画面（ウィンドウレベル）
│   ├── MainPage.svelte          # W-001 メインウィンドウ本体
│   └── TaskDetailPage.svelte    # W-002 タスク詳細ウィンドウ本体
│
├── stores/                      # 横断ストア（複数 feature が読み書き）
│   ├── ui.ts                    # 選択ID・折りたたみ・パネル開閉
│   ├── theme.ts                 # テーマ
│   ├── preferences.ts           # ユーザ設定（date_time_format 等）。meta.json に永続化
│   ├── panel_coordinator.ts     # ポップオーバー調停
│   └── index.ts                 # バレル（feature stores も再エクスポート）
│
├── types/                       # 共有型
│   ├── app.ts
│   └── workspace.ts
│
├── App.svelte                   # ルートエントリ（ウィンドウルーター）
├── main.ts                      # Vite ビルドエントリ
├── stores.ts                    # `export * from "./stores/index"` 互換バレル
├── global.d.ts
└── svelte.d.ts
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
| `tasks`      | タスクツリー、ノードCRUD、行/列操作、状態           |
| `memos`      | メモ本体、タグ管理、Markdown/Quill エディタ         |
| `gantt`      | 時系列可視化                                        |
| `workspace`  | ワークスペース（ディレクトリ＋Markdown ベース）管理 |
| `inbox`      | Workspace 横断のクイックキャプチャ専用バケット      |
| `projects`   | 標準（JSON ベース）プロジェクト管理                 |
| `search`     | フィルター・ページ内検索                            |
| `settings`   | アプリ全体の設定モーダル                            |
| `navigation` | サイドナビ、トップヘッダー、Info                    |

### 3.3 `pages/`（画面層）

- 複数 feature を組み合わせて画面を構成
- `lib/*`、`features/*`、`stores/*`、`types/*` すべてを import 可
- ウィンドウ単位で配置（メインウィンドウ、タスク詳細サブウィンドウ）

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
| `@features/*`  | `src/features/*` | `import { tree_data } from "@features/tasks/stores/tree"` |
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
import { tree_data } from "@features/tasks/stores/tree";

// 4. @stores（横断ストア）
import { ui } from "@stores/ui";

// 5. @app-types（型）
import type { TreeData } from "@app-types/app";

// 6. 相対 import（同ディレクトリ内）
import LocalComponent from "./LocalComponent.svelte";
```

## 5. ストア構成

### 5.1 ストア一覧

| ストア                                                                                   | 配置                                             | 役割                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `tree_data`                                                                              | `@features/tasks/stores/tree`                    | タスクツリー本体 + Undo/Redo                            |
| `column_settings`                                                                        | `@features/tasks/stores/column_settings`         | 列の幅・順序・可視性                                    |
| `sort_state`                                                                             | `@features/tasks/stores/sort`                    | ソート状態                                              |
| `tag_index` / `active_tag`                                                               | `@features/memos/stores/tags`                    | タグインデックス・選択中タグ                            |
| `ganttVisible` / `ganttScale` 等                                                         | `@features/gantt/stores/gantt`                   | Gantt 表示設定                                          |
| `workspace_store` 等                                                                     | `@features/workspace/stores/workspace`           | ワークスペース管理（含 `deleteProject`）                |
| `project_ids`                                                                            | `@features/projects/stores/project`              | プロジェクト一覧                                        |
| `inbox_store` / `inbox_count`                                                            | `@features/inbox/stores/inbox`                   | Workspace 横断 Inbox の状態（フラットアイテム列）       |
| `filter` / `pageSearchQuery`                                                             | `@features/search/stores/search`                 | フィルター条件 / 画面内検索クエリ                       |
| `pageSearchMatchCount` / `pageSearchCurrentIndex`                                        | `@features/search/utils/page_search_highlighter` | 画面内検索の件数と現在位置（readable store）            |
| `selected_id` / `closed_node_ids` / `sidebarCollapsed` / `copied_task` / `saveStatus` / `show_archived` 等 | `@stores/ui`                                     | UI状態（`show_archived` はアーカイブ済みタスクの表示切替・プロジェクト毎に永続化） |
| `theme`                                                                                  | `@stores/theme`                                  | テーマ                                                  |
| `date_time_format`                                                                       | `@stores/preferences`                            | 入力ショートカット（`Ctrl+;` / `Ctrl+:`）の挿入フォーマット |
| `panelCoordinator`                                                                       | `@stores/panel_coordinator`                      | ポップオーバー調停                                      |
| `navigation_history` / `canGoBack` / `canGoForward`                                      | `@stores/navigation_history`                     | ページ遷移履歴（ブラウザ風の戻る／進む）                |

### 5.2 init_store()

`src/stores/index.ts` の `init_store()` が起動時に全ストアを初期化する。
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

### 6.2 検証結果

| 項目            | 結果                                              |
| --------------- | ------------------------------------------------- |
| `npm run build` | ✅ 成功                                           |
| `npm run check` | ✅ 159 files / 0 errors / 0 warnings              |
| `npm test`      | ✅ 213 passed / 7 skipped / 0 failed (out of 220) |

## 7. コンポーネント / ファイル対応表

| 領域                                                               | ファイル                                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| メインウィンドウ                                                   | `src/App.svelte` + `src/pages/MainPage.svelte`                                                                                                   |
| タスク詳細ウィンドウ                                               | `src/App.svelte` + `src/pages/TaskDetailPage.svelte`                                                                                             |
| ヘッダ（含 画面内検索 + サイドバートグル + 保存状態 + テーマ切替） | `src/features/navigation/components/Header.svelte`                                                                                               |
| 左サイドバー（永続表示）                                           | `src/App.svelte` に直接配置 + `src/features/navigation/components/MenuList.svelte`                                                               |
| サイドバー Workspace / Projects / Info / Tags 各セクション         | `MenuList.svelte` 内の `.Section` + `.Contents` パターン                                                                                         |
| プロジェクトエリア                                                 | `src/pages/MainPage.svelte`                                                                                                                      |
| ツリーペイン                                                       | `src/features/tasks/components/TreeTable.svelte` + `TreeTableHeader.svelte` + `TreeTableRow.svelte`                                              |
| ガントペイン                                                       | `src/features/gantt/components/GanttPanel.svelte`                                                                                                |
| 右ペイン（Task Detail + Memo の単一 Card / Card 内部で上下分割）   | `src/features/tasks/components/TaskDetail.svelte`                                                                                                |
| タスク添付ファイル UI                                              | `src/features/tasks/components/TaskAttachments.svelte`                                                                                           |
| メモパネル                                                         | `src/features/memos/components/MemoTab.svelte`                                                                                                   |
| メモエディタ                                                       | `src/features/memos/components/Memo.svelte` → `MarkdownMemo.svelte` / `QuillMemo.svelte`                                                         |
| セグメントコントロール                                             | `src/lib/primitives/SegmentedControl.svelte`（Memo フォーマット切替・Markdown Read/Edit 切替で共用）                                             |
| ダイアログ                                                         | `@lib/primitives/Dialog.svelte` を使用した個別実装（タスク削除、プロジェクト削除、ワークスペースプロジェクト削除、ルート兄弟挿入のアラートなど） |
| ページ内ハイライト検索                                             | `Header.svelte` の検索ボックス + `@features/search/utils/page_search_highlighter.ts`                                                             |
| 列ヘッダのフィルタ / 列設定ポップオーバー                          | `TreeTableHeader.svelte` + `@features/search/components/*FilterPanel.svelte`                                                                     |
| ツリーの三点リーダメニュー                                         | `TaskMenu.svelte` + `TaskName.svelte`                                                                                                            |
| ワークスペース管理ダイアログ                                       | `WorkspaceSetup.svelte` + `MigrationWizard.svelte`                                                                                               |
| ワークスペース永続化パイプライン（main プロセス）                  | `electron/workspace.js` + `electron/workspace-write-queue.js` + `electron/workspace-reconciler.js`                                               |
| ワークスペースのコンフリクト / 通知バナー                          | `src/App.svelte` の `workspace-conflict-banner` / `workspace-notice-banner`                                                                      |
| Inbox UI                                                           | `src/features/inbox/components/InboxPanel.svelte` + `InboxDetailPanel.svelte` + `QuickCapture.svelte` + `ProjectTargetPicker.svelte` + `TargetTreeNode.svelte`         |
| Inbox 入り口                                                       | ヘッダの 📥 ボタン（`Header.svelte`）と `Ctrl+Shift+I`（`App.svelte` のグローバル keydown）。サイドバーには Inbox 行を置かない                  |
| Inbox 永続化（main プロセス）                                      | `electron/inbox.js`（`ensureInbox` / `readInbox` / `addInboxItem` / `sendInboxItemsToProject`） + `electron/index.js` の `ws:*-inbox-*` ハンドラ |
| 設定モーダル                                                       | `src/features/settings/components/SettingsModal.svelte`、トリガは `Header.svelte` の ⚙ ボタン                                                    |
| 入力ショートカット（日付・時刻）                                   | `src/lib/utils/datetime_shortcuts.ts`（`registerDateTimeShortcuts`）、`App.svelte` の `onMount` で登録                                            |
| ページ遷移履歴（戻る・進む）                                       | `src/stores/navigation_history.ts`（`navigation_history` / `canGoBack` / `canGoForward`）+ `Header.svelte` の戻る／進むボタン + `App.svelte` のショートカット (Alt+←/Alt+→) と XButton 受け |
| アーカイブ（論理削除）                                             | `tree_control.ts` の `archiveNode` / `restoreNode` / `bulkArchiveNodes` / `bulkRestoreNodes` / `stripArchivedNodes` + `@stores/ui` の `show_archived` + ツールバー（`MainPage.svelte`）の削除/復元/トグル + `TreeTableRow.svelte` の archived 行スタイル + `TaskDetail.svelte` の archived バナー + `electron/workspace.js` の frontmatter `archived` / `archived_at` |

> `src/lib/primitives/Drawer.svelte` は現在は未使用（旧 Drawer 形式の左ナビ用）。互換のためファイルは残置するが、本アプリの画面構成では使用しない。

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
- `startAutoRescan()` で `MutationObserver` を起動し、DOM 変更時に再スキャン（メモ表示後など）
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

### 8.8 ワークスペースプロジェクト削除

- IPC: `ws:delete-project` を `electron/index.js` に追加
- `electron/workspace.js` の `deleteProject(projectDir)` が対象ディレクトリを再帰削除
- preload: `wsDeleteProject(projectDir)`
- 型: `WindowApi.wsDeleteProject` を `src/types/app.ts` に追加
- 実行ラッパ: `src/lib/ipc/platform.ts` の `wsDeleteProject(projectDir)`
- ストア: `workspace_store.deleteProject(projectDir)` が呼出し後にプロジェクト一覧を再読込

### 8.9 ワークスペース永続化パイプライン

メモリ上の `tree_data` を単一の真実とし、main プロセスが非同期にディスクへ反映する。renderer は保存完了を待たず（fire-and-forget）、状態は main からの IPC push で更新する。

この原則はタスク本体だけでなく、Workspace プロジェクトのサイドバー summary にも適用する。root task 名、rootId、並び順など、現在の `tree_data` または `workspace_store.projects` から決まる値は renderer の store で派生更新し、通常の編集後にディスクを読み直して UI を正す実装にしない。ディスクから store へ取り込む経路は、起動・workspace 切替・project 選択・migration/export 後の明示 refresh・外部更新リコンサイル・競合 reload の境界に限定する。

```
[ renderer ]
  tree_data (Svelte store)
        │  ws:broadcast-project-snapshot（optimistic cache / other-window sync）
        ▼
[ main ]
  wsCache ─► workspace-project-updated (reason: local-update)
        │
        ▼
[ renderer windows ]
  tree_data.setFromSource(...)

[ renderer ]
  tree_data (Svelte store)
        │  ws:write-project-patch / ws:write-project（fire-and-forget）
        ▼
[ main ]
  WorkspaceWriteQueue ─ writeProjectPatchAsync / writeProjectAsync ─► atomicWriteFile (tmp → rename) ─► disk
        │                       │                                              │
        │                       │  onWritten(path, buffer)              (chokidar watch)
        │                       ▼                                              ▼
        │             WorkspaceReconciler.recordWrite     WorkspaceReconciler.handleFileEvent
        │              （knownFileHashes 同期更新）       （ハッシュ一致なら自前書込として suppress）
        ▼                                                                      │
  saveStatus push                                  ┌────────────────────────────┤
                                                  ▼                            ▼
                                          外部書込として取り込み      conflict 通知
                                                                    （forceLocal 時は通知格下げ）
```

#### 構成要素

| 要素                 | 配置                                                 | 主要 API                                                                                                                              |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 原子的・増分書込     | `electron/workspace.js`                              | `atomicWriteFile` / `writeFileIfChanged` / `retryFileOperation` / `writeProjectPatchAsync` / `writeProjectAsync` 等。書込成功直後に `onWritten(filePath, buffer)` を発火 |
| 直列ライトキュー     | `electron/workspace-write-queue.js`                  | `WorkspaceWriteQueue`（`enqueuePatch(projectDir, patch, { forceLocal })` / `enqueue(projectDir, tasks, { forceLocal })` / `flush` / `hasPending` / `isWriting` / `discard` / `getActiveOptions`） |
| 外部書込リコンサイラ | `electron/workspace-reconciler.js`                   | `WorkspaceReconciler`（`start` / `stop` / `recordWrite(filePath, buffer)` / `markProjectWritten(projectDir)`）+ `isConflictCopy` 判定 |
| 状態スナップショット | `<TASK_MANAGE_DATA_DIR>/workspace-state/<hash>.json` | 配下ファイルの SHA-256 ハッシュ表                                                                                                     |

#### main → renderer の IPC イベント

| チャネル                    | ペイロード                              | 用途                                                                                                                   |
| --------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `workspace-save-status`     | `{ projectDir, status, message? }`      | キュー進行状態の楽観 UI 用 push                                                                                        |
| `workspace-project-updated` | `{ projectDir, tasks, reason }`         | 外部書込・コンフリクト解決・local-update・local-write の再読込通知。Task Detail 別ウィンドウを含む他 renderer はこの payload で `tree_data` を同期する |
| `workspace-conflict`        | `{ projectDir, message }`               | ローカルにペンディング書込ありの外部編集検知（`forceLocal` 中は発火せず `workspace-notice (kind: "overwritten-external")` に格下げ） |
| `workspace-notice`          | `{ kind, projectDir?, path?, message }` | `workspace-updated` / `conflicted-copy` / `overwritten-external` / `error` の通知                                      |
| `workspace-flush-start`     | `{ projectDir? }`                       | アプリ終了処理開始の通知。renderer はブロッキングオーバーレイを表示する                                                |
| `workspace-flush-complete`  | `{}`                                    | flush 完了の通知。オーバーレイを閉じる前提（通常はそのままウィンドウ destroy）                                         |

renderer → main の追加 IPC：

- `ws:resolve-conflict (action: "keep-local" | "reload")`
- `ws:broadcast-project-snapshot(projectDir, tasks)` — disk queue 完了前の in-memory snapshot を main の optimistic `wsCache` と他ウィンドウへ同期する
- `ws:write-project-patch(projectDir, { tasks, deletedTaskIds }, { forceLocal? })` — 通常編集の差分保存。変更タスクと削除 id のみ送る
- `ws:write-project(projectDir, tasks, { forceLocal? })` — `forceLocal` は省略可（既定 `false`）

#### SaveStatus 状態遷移

`SaveStatus = "idle" | "queued" | "writing" | "retrying" | "saved" | "error" | "conflict"`

renderer の `saveStatus` ストアは:

- 通常: `idle → queued → writing → saved`
- リトライ発生時（書込エラーかつ `forceLocal` 有効）: `… → writing → error → retrying → writing → saved`（最大 N 回。N を超えたら `error` 確定）
- 失敗時: `… → error`
- 外部書込との衝突時: `… → conflict`（`ws:resolve-conflict` 後に `saved` / `queued` へ復帰。`forceLocal` 中は `conflict` 状態には遷移しない）

#### 自前書込フィルタ（per-file `recordWrite`）

`atomicWriteFile` は成功直後（rename 完了後）に optional コールバック `onWritten(filePath, buffer)` を発火する。queue 経由の書込パスでは、このコールバックを `reconciler.recordWrite(filePath, buffer)` に紐づけ、書込みごとに **同期的に** `knownFileHashes` をその場で最新ハッシュへ更新する。

これにより：

- chokidar の `awaitWriteFinish: 150ms` を経て発火する個別 change イベントが `handleFileEvent` に届いたとき、`knownFileHashes.get(path) === hashFile(path)` がほぼ確実に成立し、reconcile スケジュールに進まずに suppress される
- 大規模プロジェクトでバッチが長時間化しても、書込み済みファイルが「未知のハッシュ」と判定される偽陽性が発生しない
- `markProjectWritten(projectDir)` は **削除されたファイルの `knownFileHashes` エントリ整理と snapshot 書出しのみ** を担う。全ファイルの再ハッシュは行わない（書込み済み分は `recordWrite` で同期済み）

直接 `atomicWriteFile` を呼ぶ箇所（`saveMemoImageAsync` 等）と、`writeFileIfChanged` 経由の箇所のいずれも `onWritten` をバケツリレーで受け取る。queue を経由しない単発 IPC（`ws:write-task`, `ws:save-memo-image`, `ws:set-project-order`）でも、main 側の IPC ハンドラが `reconciler.recordWrite` を `onWritten` として渡す。

#### `forceLocal` フラグ（メモリ優先保存）

`WorkspaceWriteQueue.enqueuePatch(projectDir, patch, { forceLocal })` または `WorkspaceWriteQueue.enqueue(projectDir, tasks, { forceLocal })` で 1 件のジョブに `forceLocal: true` を付けると、以下のセマンティクスを持つ：

1. **conflict 通知の格下げ**：書込み中に reconciler が外部書込を検知しても `workspace-conflict` を発火せず、`workspace-notice (kind: "overwritten-external")` のみ流す。saveStatus は `conflict` に遷移しない。
2. **書込エラー時の内部リトライ**：`writeProjectPatchAsync` / `writeProjectAsync` が throw した場合（OneDrive ロック等、`atomicWriteFile` の retryFileOperation でも回復しなかったケース）、`processLoop` が指数バックオフ（初期 200ms、最大 5 回）で同 payload を再エンキューする。各リトライ前に `saveStatus: "retrying"` を発火。N 回超過で `saveStatus: "error"` 確定。

renderer 側は `meta.json` の `workspaceConflictPolicy` に応じて `wsWriteProjectPatch` / `wsWriteProject` 呼出に `forceLocal` を自動付与する：

- `"ask"`（既定）: `forceLocal: false`。conflict バナーで「維持 / 再読込」を選ばせる
- `"prefer-memory"`: `forceLocal: true`。conflict バナーは出ず、`overwritten-external` 通知のみ

#### 終了時 flush — ウィンドウを閉じずに待機

`mainWindow.on("close", ...)` で介入する。`workspaceWriteQueue.hasPending()` が真なら：

1. `event.preventDefault()` でウィンドウ destroy を抑止
2. `workspace-flush-start` IPC を renderer に送り、renderer は操作不能なオーバーレイを表示（保存中... の表示でユーザに待機を促す）
3. `dbWriter.flush()` / `dbMetaWriter.flush()`（同期）を実行
4. `workspaceWriteQueue.flush()` を await
5. `reconciler.stop()` を await
6. `mainWindow.removeAllListeners("close")` してから `mainWindow.destroy()`（再帰防止）

タイムアウト：30 秒経過しても flush が完了しない場合、renderer に「強制終了 / 継続」を選ばせるダイアログを表示。「強制終了」が選ばれた場合のみ未保存データを諦めて destroy する。

`app.on("before-quit")` は programmatic quit（Cmd+Q 等）からのフォールバックとして残し、close intercept と同じ flush フローを再利用する。`mainWindow` が既に destroy 済みの場合は同期 flush（`dbWriter` / `dbMetaWriter`）のみ実行する。

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

### 8.11 メモフォーマットの責務分離

メモ単位のフォーマット（Markdown / Quill）は次の責務分担で扱う。

- **レンダラ分岐**: `src/features/memos/components/Memo.svelte` が `MemoEntry.format` を参照し、`MarkdownMemo.svelte` / `QuillMemo.svelte` のいずれかをマウントする
- **正規化と変換**: `src/features/memos/utils/memo_utils.ts` が省略時デフォルトの解決と Markdown ⇄ Quill 変換を行う。個別変換・一括変換のいずれも本ユーティリティを経由する
- **ワークスペース保存形式**: `electron/workspace.js` が `.md` ファイルへのシリアライズとパースを担当する。Quill メモは `format: quill` の YAML フロントマター + fenced JSON Delta の単一 `.md` 形式で保持する
- **一括変換の Undo 記録**: 一括変換は現在開いている `tree_data` を 1 回だけ書き換える形で実装し、既存の Undo / Redo 履歴に単一アクションとして記録する。これにより 1 回の Undo でプロジェクト全体の変換が元に戻る
- **UI セグメント**: 各メモのフォーマット切替と、Markdown の Read / Edit モード切替は共通プリミティブ `src/lib/primitives/SegmentedControl.svelte` を使用し、アクティブ状態・セパレータ・キーボードフォーカス表現を統一する
- **エクスポート時の挙動**: `db.json` → Workspace エクスポートは `electron/workspace.js` で実装され、ワークスペースルートとメモには新規 UUID を発行する（コピー操作。ソース ID は引き継がない）。通常のフォーマット変換はコピーではないためメモ ID を維持する

### 8.12 ページ遷移履歴（戻る・進む）

ブラウザ風の戻る・進むナビゲーションは `src/stores/navigation_history.ts` の `navigation_history` ストアで実現する。

- **「ページ」の定義**: 本アプリでは画面遷移の単位を次の 4 軸で同定する。
  - `selected_type` — `"Projects" | "WorkspaceProject" | "Inbox" | "Info"`
  - `selected_id` — project root の id / info id / Inbox センチネル
  - `workspace_store.activeWorkspacePath` — 表示中の workspace ルート（workspace 切替後の戻る対応）
  - `workspace_store.activeProjectDir` — Workspace project のディレクトリ（同じ rootId が無くてもタスクは正しい disk から読まれる）
- **エントリ形**: `{ selectedType, selectedId, projectDir, workspacePath, tableSelectedId }`。`tableSelectedId` を含めるのは、戻ったときに TaskDetail / Memo のコンテキストも復元するため
- **状態**: `{ entries: NavigationEntry[], index: number }`。`index === -1` は履歴なし。最大 100 件で、超過分は古い側から FIFO で落とす
- **2 つの push 経路**:
  1. **subscriber 経由（ページ切替の自動 push）**: `init()` で `selected_type` / `selected_id` / `table_selected_id` / `workspace_store` の各 store に `subscribe` を張る。subscriber は `Promise.resolve().then(...)` の microtask 1 回にコアレスし、page（4 軸）が変わっているときだけ新エントリを push する。push 時点で `tableSelectedId` は `undefined` に stripped する（ページ切替直後の `table_selected_id` は旧ページの値が残ったままなので、旧値の混入を防ぐ）
  2. **`pushSelection()` 経由（ユーザクリックの明示 push）**: `TreeTable.handleSelectRow` が `selectOnly(id)` 直後に同期で呼ぶ。current state がそのまま新エントリとして push される
- **subscriber の fill-in 経路**: subscriber 経由の commitRecord で「同ページ + entries[index].tableSelectedId が undefined + 新たな値が定まった」場合に限って 1 回だけ in-place で fill-in する。これはロード完了直後の `selectOnly(root)` を「同ページの初期 tableSelectedId」として取り込むため。既に値が定まったエントリの tableSelectedId を後続の transient で上書きしないので、`pushSelection` で積んだユーザクリックも消えない
- **着地待ち（`pendingNavigation`）**: `back()` / `forward()` 実行中は `pendingNavigation` に target エントリを置く。target 着地（pageEqual 一致）が確認できた時点でクリア。pageEqual が崩れたら（ユーザが target を待たずに別ページへ動いたら）もクリアして通常記録に戻す
- **`pendingTaskDetailSelection` 経由の table 復元（ページ跨ぎ）**: navigateTo は target の `tableSelectedId` を `setPendingTaskDetailSelection({ projectId, taskId, selectedType, projectDir })` に詰める。`loadProjectsData` / `loadWorkspaceData` がプロジェクト読み込み完了後にこのヒントを参照して `selectOnly(taskId)` を呼び、結果として entries[index].tableSelectedId と一致する状態に収束する
- **同ページ内 back/forward**: navigateTo は target との pageEqual が一致する場合、loader を経由せず `table_selected_id.set(target.tableSelectedId)` を直接呼ぶ。`MenuList.selectWorkspaceProject()` 等と同じ store 順序にしておかないと、`selected_id` の subscriber (`loadWorkspaceData`) が古い `activeProjectDir` を読んでしまうため、`setActive(workspacePath)` → `setActiveProject(projectDir)` → `selected_type.set` → `selected_id.set` の順に並べる（ページ跨ぎ navigateTo）
- **未消化記録の flush**: `back()` / `forward()` の冒頭で `flushPendingRecord()` を呼び、microtask 待ちの記録を同期的に消費してから navigation index を動かす
- **forward truncate**: 戻った状態から新規ページへ移ると、`entries.slice(0, index + 1)` で進む側履歴を切り捨ててから push する
- **空状態スキップ**: `(undefined, undefined)` は履歴に積まない（起動直後・プロジェクト削除直後のクリーンアップ状態）
- **サブウィンドウでの無効化**: `init_store()` の中で `window.location.hash === "#task-detail-window"` を判定し、タスク詳細サブウィンドウでは `navigation_history.init()` を呼ばない
- **入力経路**: 
  - `Header.svelte` の戻る／進む `<button>`（`canGoBack` / `canGoForward` を `disabled` にバインド）
  - `App.svelte` の capture-phase `window.keydown` で `Alt+ArrowLeft` / `Alt+ArrowRight` を拾う。テキスト編集要素（`<input>` / `<textarea>` / `.cm-editor` / `.ql-editor` / `[contenteditable]`）にフォーカスがあるときはスキップしてエディタ側に委ねる
  - `App.svelte` の `window.mouseup` で `event.button === 3` / `4`（マウスの XButton）を受ける
  - `TreeTable.handleSelectRow` → `navigation_history.pushSelection()` でタスク行クリックを明示 push
- **対象外**: マルチ選択 (`selected_ids` / `selection_anchor_id`)、タスク追加・コピー・移動の副作用としての選択変更（pushSelection を呼ばない）、Inbox のアクティブアイテム選択は履歴に乗せない

### 8.13 タスクのアーカイブ（論理削除）

タスクの「削除」は **2 段階モデル**で運用する。1 段目が論理削除（archive）、2 段目が物理削除（permanent delete）。

#### モデル
- `TreeData` / `WorkspaceTask` に optional `archived?: boolean` / `archivedAt?: string`（ISO 8601）。フラグが立っていてもノードは元の位置に残る
- `show_archived: Writable<boolean>`（`@stores/ui`、プロジェクトごとに `meta.json` 永続化）が表示の足切りを担当する

#### 表示パイプライン
1. `tree_data` (raw)
2. `search.ts` の `archivedAdjustedTree`：`show_archived` が false なら `stripArchivedNodes` で archived 子孫を取り除いた新ツリーを後段に渡す
3. `filterTree`：名前/状態/メモ等のフィルタを適用
4. `filtered_data`
5. `TreeTable` の `flattenVisibleTree(filtered, closedIds, $show_archived)` — `includeArchived` で 2 段目の安全網（show_archived=true でも子孫の archived 連動非表示を担う設計だが、フィルター済みデータ上ではほぼ素通り）

タグ集計（`tag_index`）も同じく `show_archived` に subscribe して archived ノードを除外する。

#### 操作の振り分け
- 非 archived 行で `requestDelete` → `archiveNode`（確認ダイアログ）
- archived 行で `requestPermanentDelete` → `rmNode`（確認ダイアログ、強い文言）
- archived 行で `requestRestore` → `restoreNode`（確認なし）— 対象の `archived` を外し、現在の親の children 末尾へ移動する
- マルチ選択は `MainPage.handleRemove` / `TreeTable.handleBulkDelete` で **active→archive、archived→permanent delete に自動振り分け**。ダイアログには両方の件数を表示

#### 読み取り専用化
- `TreeTableRow.commitData` は `node.archived` で early-return（subscriber 経路から来た commit を捨てる）
- `TaskName.toggle()` も同様。menu の `rename` / `add*` / `move*` / `paste` は `disabled: ... || archived`
- `StatusSelect` / `DateInput` に `disabled` prop を渡す
- `TaskDetail` の右ペインは archived 時にバナーを出し、`detail-container` と `memo-pane` に `pointer-events: none` を当てる

#### 永続化
- InApp プロジェクト：`tree_data` の JSON にそのまま `archived` / `archivedAt` が乗る
- Workspace プロジェクト：`electron/workspace.js` の `taskFrontmatterData` で `archived: true` / `archived_at: <ISO>` を出力。`readRootTask` / `readTaskDir` で `parseArchivedValue` を経由して読み戻す。未 archived ではフィールドを出さない（既存ファイルとの diff 最小化）
- 差分検出（`comparableWorkspaceTask`）にも `archived` / `archivedAt` を含めるため、フラグ変更で workspace patch が走る
