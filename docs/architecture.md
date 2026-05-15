# アーキテクチャ — Task Manage

| 項目   | 内容                                         |
| ------ | -------------------------------------------- |
| 文書ID | TM-ARCH-001                                  |
| 版数   | 1.1                                          |
| 更新日 | 2026-05-15                                   |
| 対象   | Electron 41 + Svelte 5 + TypeScript + Vite 8 |

---

## 1. 目的

本文書は Task Manage デスクトップアプリのソースコード構造、ディレクトリ命名規約、import 規約、コンポーネント階層の設計指針を規定する。
新規開発者・コードレビューア・保守担当者の参照基盤とする。

---

## 2. ソースコード階層

```
src/
├── lib/                         # 再利用可能な汎用層（ドメイン非依存）
│   ├── primitives/              # アトミックUI（11 ファイル）
│   │   ├── Button.svelte
│   │   ├── IconButton.svelte
│   │   ├── Card.svelte
│   │   ├── Modal.svelte
│   │   ├── Dialog.svelte
│   │   ├── Drawer.svelte
│   │   ├── ToggleSwitch.svelte
│   │   ├── Select.svelte
│   │   ├── MultiSelect.svelte
│   │   ├── SearchBox.svelte
│   │   └── DateInput.svelte
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
│   │       └── memo_utils.ts    # Markdown ⇄ Quill 変換
│   ├── gantt/
│   │   ├── components/          # GanttPanel
│   │   └── stores/              # gantt
│   ├── workspace/
│   │   ├── components/          # WorkspaceSetup / MigrationWizard
│   │   ├── stores/              # workspace
│   │   └── utils/
│   │       └── workspace_tree.ts
│   ├── projects/
│   │   └── stores/              # project
│   ├── search/
│   │   ├── components/          # PageSearchBox / NameFilterPanel / DateRangePanel / NumberRangePanel / StatusFilterPanel
│   │   ├── stores/              # search
│   │   └── utils/
│   │       └── page_search_highlighter.ts  # CSS Custom Highlight API ベースの全文ハイライト
│   └── navigation/
│       └── components/          # MenuList / Header / InfoPage
│
├── pages/                       # 画面（ウィンドウレベル）
│   ├── MainPage.svelte          # W-001 メインウィンドウ本体
│   └── TaskDetailPage.svelte    # W-002 タスク詳細ウィンドウ本体
│
├── stores/                      # 横断ストア（複数 feature が読み書き）
│   ├── ui.ts                    # 選択ID・折りたたみ・パネル開閉
│   ├── theme.ts                 # テーマ
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

---

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
| `projects`   | 標準（JSON ベース）プロジェクト管理                 |
| `search`     | フィルター・ページ内検索                            |
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

---

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

---

## 5. ストア構成

### 5.1 ストア一覧

| ストア                                                                    | 配置                                             | 役割                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `tree_data`                                                               | `@features/tasks/stores/tree`                    | タスクツリー本体 + Undo/Redo                 |
| `column_settings`                                                         | `@features/tasks/stores/column_settings`         | 列の幅・順序・可視性                         |
| `sort_state`                                                              | `@features/tasks/stores/sort`                    | ソート状態                                   |
| `tag_index` / `active_tag`                                                | `@features/memos/stores/tags`                    | タグインデックス・選択中タグ                 |
| `ganttVisible` / `ganttScale` 等                                          | `@features/gantt/stores/gantt`                   | Gantt 表示設定                               |
| `workspace_store` 等                                                      | `@features/workspace/stores/workspace`           | ワークスペース管理（含 `deleteProject`）     |
| `project_ids`                                                             | `@features/projects/stores/project`              | プロジェクト一覧                             |
| `filter` / `pageSearchQuery`                                              | `@features/search/stores/search`                 | フィルター条件 / 画面内検索クエリ            |
| `pageSearchMatchCount` / `pageSearchCurrentIndex`                         | `@features/search/utils/page_search_highlighter` | 画面内検索の件数と現在位置（readable store） |
| `selected_id` / `closed_node_ids` / `sidebarCollapsed` / `copied_task` 等 | `@stores/ui`                                     | UI状態                                       |
| `theme`                                                                   | `@stores/theme`                                  | テーマ                                       |
| `panelCoordinator`                                                        | `@stores/panel_coordinator`                      | ポップオーバー調停                           |

### 5.2 init_store()

`src/stores/index.ts` の `init_store()` が起動時に全ストアを初期化する。
追加ストアは原則ここに登録する。

---

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

### 6.2 検証結果（v1.1 完了時）

| 項目            | 結果                                              |
| --------------- | ------------------------------------------------- |
| `npm run build` | ✅ 成功                                           |
| `npm run check` | ✅ 159 files / 0 errors / 0 warnings              |
| `npm test`      | ✅ 213 passed / 7 skipped / 0 failed (out of 220) |

---

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
| 右ペイン（Task Detail + Memo）                                     | `src/features/tasks/components/TaskDetail.svelte`                                                                                                |
| メモパネル                                                         | `src/features/memos/components/MemoTab.svelte`                                                                                                   |
| メモエディタ                                                       | `src/features/memos/components/Memo.svelte` → `MarkdownMemo.svelte` / `QuillMemo.svelte`                                                         |
| ダイアログ                                                         | `@lib/primitives/Dialog.svelte` を使用した個別実装（タスク削除、プロジェクト削除、ワークスペースプロジェクト削除、ルート兄弟挿入のアラートなど） |
| ページ内ハイライト検索                                             | `Header.svelte` の検索ボックス + `@features/search/utils/page_search_highlighter.ts`                                                             |
| 列ヘッダのフィルタ / 列設定ポップオーバー                          | `TreeTableHeader.svelte` + `@features/search/components/*FilterPanel.svelte`                                                                     |
| ツリーの三点リーダメニュー                                         | `TaskMenu.svelte` + `TaskName.svelte`                                                                                                            |
| ワークスペース管理ダイアログ                                       | `WorkspaceSetup.svelte` + `MigrationWizard.svelte`                                                                                               |

> `src/lib/primitives/Drawer.svelte` は現在は未使用（旧 Drawer 形式の左ナビ用）。互換のためファイルは残置するが、本アプリの画面構成では使用しない。

---

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
- ペインリサイズ時の `ResizeObserver` では、最終列だけ
  `max(lastMinWidth, tableWidth − fixedTotal)` で再計算する
- 折りたたみ・展開時の `MutationObserver` 経由 createResizers は `getBoundingClientRect` ではなく
  `header.style.width` を読む。サブピクセル誤差の累積を避ける目的

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

---

## 9. 履歴

### v1.1（2026-05-15）— UX 全面リフレッシュ

#### 動機

- モック / 画面仕様書に合わせて、サイドバー、Card、ガント、メモ、ペイン、検索、ツリー操作の
  挙動 / 見た目を全面的に整える
- 既存の挙動上のクセ（disabled ボタンクリックでメニューが閉じない、ペイン min-width が効きすぎる、
  検索ボックスの文字列がハイライト対象に含まれる、など）を解消する

#### 主な変更

- **画面構成**
  - 左ナビを Drawer から永続表示のサイドバーへ。起動時は常に折りたたみ
  - ヘッダのハンバーガーアイコンは状態で `＜` に切り替わる
  - Card プリミティブに `title` / `padded` プロパティを追加。タイトル全体に半透明 Primary 背景
  - Tags セクションを Workspace / Projects / Info と同じ `Section` + `Contents` レイアウトに統一
- **検索系の役割分離**
  - ヘッダのボックスは画面内ハイライト専用（`pageSearchQuery` + `page_search_highlighter`）
  - 「filter tasks」ボックスは行絞り込み専用（`filter` store）
  - ハイライトは CSS Custom Highlight API で全テキストノード対象。`↑↓ Enter Shift+Enter F3 Ctrl+G` で前後移動。検索ボックス自身と折りたたみ済み要素は除外
- **ツリー操作**
  - 3 ゾーン DnD（兄として挿入 / 子として追加 / 弟として挿入）
  - 三点リーダ再クリックでメニュー閉、`globalDismiss` で任意位置クリックでも閉
  - rename ボタンは削除（三点リーダ menu の rename に統一）
  - ステータス選択は `<select>` から自前ポップアップに置換
  - 列幅: ユーザー指定列は維持、最終列は余白を埋める
  - スティッキーブレッドクラム: ツリーヘッダ直下、行高は本体行と一致
  - ルート選択時の「兄弟挿入」を Dialog アラートに変更
  - 行 enter / chevron 回転を CSS アニメーション（Svelte transition なし）
- **ペイン**
  - SplitPanes: マウスアップ時に snap-collapse。`min-width: 0` も inline で付与
  - 折りたたみ済みペインの隣リサイザーはヒット領域 14px / Primary 色で強調
- **ガント**
  - 今日表示を Accent 色の 1 日帯 + 縦線として描画（週 / 月表示でも視認）
  - 初回マウント / スケール切替で今日を画面中央付近に自動スクロール
  - 週表示は `mm/dd ～ mm/dd` フォーマット
  - 開始日のみ / 期限日のみは 1 日マーカー（インセットアウトラインで識別）
  - スケール切替ボタンをセグメント風 UI に。アクティブを白背景で強調
- **メモ**
  - Quill / Markdown バッジを Detail のメモタイプバッジと同サイズに統一
  - タグ入力欄のフォーカス時は外側リングのみ Primary 色（インナーは neutral）
  - Markdown 編集 / プレビュー間のリサイザーを SplitPanes と同デザインに統一
  - QuillMemo の上端二重ボーダーを解消
- **ワークスペース**
  - ワークスペースプロジェクト削除機能を追加（IPC `ws:delete-project`）
  - 管理ボタンを「アイコン + 管理」ラベル付きのボタンに変更
  - ワークスペース管理ダイアログのアイテム角丸を除去、罫線区切りに
- **ツールチップ**
  - グローバルクリーンアップで残存防止
  - リアクティブプロパティ更新に追従（`update()` ライフサイクル）
- **アクション / 共通基盤**
  - `globalDismiss` action 追加
  - `page_search_highlighter` 追加
  - `sidebarCollapsed` store 追加（永続化なし）
  - `public/global.css` に `fadeIn` / `slideInUp` 等のキーフレームとボタン共通トランジション、
    `prefers-reduced-motion` 対応を追加

#### 検証

| 項目            | 結果                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `npm run check` | ✅ 159 files / 0 errors / 0 warnings                                    |
| `npm test`      | ✅ 213 passed / 7 skipped / 0 failed（v1.1 で 54 件の新規テストを追加） |
| `npm run build` | ✅ 成功                                                                 |

#### 追加した新規テストファイル

| ファイル                                     | 対象                                                  |
| -------------------------------------------- | ----------------------------------------------------- |
| `tests/unit/globalDismiss.test.js`           | `lib/actions` の `globalDismiss` action               |
| `tests/unit/page_search_highlighter.test.js` | CSS Custom Highlight API ベースのページ内検索エンジン |
| `tests/unit/sidebarCollapsed.test.js`        | サイドバー折りたたみストアの初期値と挙動              |
| `tests/unit/tooltip.test.js`                 | tooltip action の update / destroy / 残存防止         |
| `tests/component/Card.test.js`               | `Card` プリミティブの `title` / `padded` プロパティ   |
| `tests/component/StatusSelect.test.js`       | 自前ドロップダウンの開閉・選択・色非伝搬              |
| `tests/component/Header.test.js`             | 画面内検索 UI とサイドバートグル                      |

`tests/component/SplitPanes.test.js` には snap-collapse / re-expand / wide-resizer のテストを追加。
`tests/component/TaskName.test.js` には三点リーダの再クリック閉と disabled ボタンクリックでの dismiss のテストを追加。
`tests/unit/workspace.test.js` には `deleteProject` の 5 テストを追加。

### v1.0（2026-05-13）— 初回構造化

#### 動機

- `src/components/` に 37 ファイルが flat に並び、責務分離が不明瞭だった
- 再利用可能なプリミティブとドメイン固有が混在
- ストアとコンポーネントの結合度が高く、グローバル barrel に依存

#### 主な変更

1. **エイリアス導入**: `@lib`, `@features`, `@pages`, `@stores`, `@app-types` を 3 config に統一
2. **lib 層分離**: 11 個のプリミティブ + 2 個のレイアウトを `lib/` 配下に隔離
3. **features 統廃合**: 7 ドメインに集約。各ドメイン内に components/stores/utils を内包
4. **pages 新設**: 旧 `ProjectPage.svelte` → `pages/MainPage.svelte`、旧 `TaskDetailWindow.svelte` → `pages/TaskDetailPage.svelte`
5. **stores/ 整理**: 横断ストア（ui, theme, panel_coordinator）のみ直下、feature 固有は `@features/X/stores/` へ
6. **互換 barrel 維持**: `src/stores.ts` および `src/stores/index.ts` は引き続き利用可

#### 数値

| 観点                           | 変更前       | 変更後                                |
| ------------------------------ | ------------ | ------------------------------------- |
| `src/components/` のファイル数 | 37           | 0（全移動済み）                       |
| `src/common/` のファイル数     | 6            | 0（全移動済み）                       |
| `src/stores/` のファイル数     | 12           | 4（ui/theme/panel_coordinator/index） |
| ディレクトリ階層               | 1 段（flat） | 3〜4 段（layer + domain）             |
| svelte-check エラー            | (測定なし)   | 0                                     |
| テスト件数                     | 165          | 165（全 pass 維持）                   |

---

## 10. 今後の方針

- 新規プリミティブ追加時は `lib/primitives/` に配置し、tests/component に Storybook 風テストを追加
- ドメイン追加時は `features/<新ドメイン>/` を新規作成し、本書に追記
- 循環依存検出時は ESLint plugin `eslint-plugin-import` の `no-cycle` を有効化検討
- pages 数が増えた場合（4 以上）はルーティングライブラリ導入を検討
- ポップオーバー / メニューを新規実装する時は `globalDismiss` を必ず通す
- 全画面横断のテキスト機能（コピー、共有プレビュー等）は `page_search_highlighter` 同様 CSS Custom Highlight / TreeWalker パターンを利用する

---

**改版履歴**

| 版  | 日付       | 内容                                  |
| --- | ---------- | ------------------------------------- |
| 1.0 | 2026-05-13 | 初版 — リファクタリング v1.0 完了時点 |
| 1.1 | 2026-05-15 | UX 全面リフレッシュ完了時点           |
