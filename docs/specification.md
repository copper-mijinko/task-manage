# task-manage 仕様書

関連ドキュメント:
[testing.md](testing.md) / [../README.md](../README.md)

この文書は、今時点の実装を断面として説明するための仕様書である。  
課題、既知バグ、改善方針のような開発中メモは含めず、必要な場合はローカル管理の `開発メモ.md` に分けて扱う。

## 1. 概要

`task-manage` は、Electron と Svelte で構成されたデスクトップ向けタスク管理アプリケーションである。

利用者は、プロジェクトごとにタスクをツリー構造で管理できる。  
各タスクには、名前、状態、期限日、メモを持たせられる。  
また、テーマ切替、タスク検索、ページ内検索、別ウィンドウでの詳細表示にも対応している。

本アプリはローカル保存を前提としており、データは JSON ファイルとして保存される。

## 2. 技術構成

- UI: Svelte 5
- デスクトップ実行環境: Electron
- ビルド: Vite
- 言語: TypeScript と JavaScript の混在構成
- ローカル保存: `@commonify/lowdb`
- テスト:
  - `Vitest`
  - `@testing-library/svelte`
  - `Playwright`

## 3. ディレクトリ構成

現在の主なディレクトリ構成は次のとおりである。

```text
task-manage/
├─ docs/
│  ├─ specification.md
│  └─ testing.md
├─ dist/
│  └─ （electron-builder 成果物。git 管理外）
├─ renderer/
│  └─ （Vite ビルド成果物。git 管理外）
├─ electron/
│  ├─ index.js
│  └─ preload.js
├─ public/
│  ├─ global.css
│  └─ static/
├─ src/
│  ├─ common/
│  ├─ components/
│  ├─ types/
│  ├─ App.svelte
│  ├─ main.ts
│  ├─ stores.ts
│  └─ global.d.ts
├─ tests/
│  ├─ unit/
│  ├─ component/
│  ├─ e2e/
│  └─ setup/
├─ index.html
├─ package.json
├─ vite.config.js
├─ tsconfig.json
├─ vitest.config.mjs
└─ playwright.config.js
```

各ディレクトリの役割は次のとおりである。

- `docs/`
  - プロジェクト文書を置く
- `dist/`
  - electron-builder のパッケージング成果物を置く
- `renderer/`
  - Vite のビルド成果物を置く。Electron 本番起動時のロード先
- `electron/`
  - Electron の main process と preload script を置く
- `public/`
  - Vite の publicDir。ビルド時に `dist/` へそのままコピーされる静的ファイルを置く
- `src/`
  - アプリ本体の UI と状態管理ロジックを置く
- `tests/`
  - 自動テストを置く

## 4. 実行アーキテクチャ

本アプリは、Electron の main process と renderer process で役割分担している。

### 4.1 main process

`electron/index.js` が担当する。  
主な責務は次のとおりである。

- アプリウィンドウの作成
- タスク詳細用サブウィンドウの作成
- JSON ファイルの読み書き
- IPC の受け口
- `findInPage` を使ったページ内検索
- 複数ウィンドウ間のデータ同期通知

### 4.2 preload

`electron/preload.js` が担当する。  
renderer から直接 Node API を触らずに済むよう、`window.electronAPI` を公開する。

### 4.3 renderer

`src/` 配下が担当する。  
Svelte コンポーネントと store を使い、画面表示と UI 操作を処理する。

主な入口は次のとおりである。

- `src/main.ts`
  - Svelte アプリの起動
- `src/App.svelte`
  - 画面全体のルート
- `src/stores.ts`
  - アプリ全体の状態管理

## 5. データ保存

データはローカルファイルとして保存される。

- `electron/db.json`
  - プロジェクト本体とタスクツリーを保存する
- `electron/meta.json`
  - テーマやノード開閉状態などの UI 用メタデータを保存する

テスト時には、環境変数によって保存先ディレクトリを切り替えられる。

## 6. データ構造

### 6.1 `db.json` 全体

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
                "content": ""
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

### 6.2 プロジェクト

各プロジェクトは次の情報を持つ。

- `headers`
  - テーブル列定義
- `data`
  - ルートタスク

### 6.3 タスク

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
  - メモ配列
- `children`
  - 子タスク配列

### 6.4 `meta.json` 全体

`meta.json` は、画面表示のための設定を持つオブジェクトである。  
現在は主にテーマと、各プロジェクトのノード開閉状態を保存している。

次のような形で保存される。

```json
{
  "theme": "light",
  "closed_nodes_8e392450-20f7-479a-a7f2-38bdafb913df": null,
  "closed_nodes_89f8d9b0-c94e-4f9f-80e6-1ef8d9448088": []
}
```

この JSON の見方は次のとおりである。

- `theme`
  - アプリ全体のテーマ
- `closed_nodes_<プロジェクトID>`
  - そのプロジェクトで閉じているノードの一覧

`closed_nodes_<プロジェクトID>` の値は、状況によって次のように変わる。

- `null`
  - まだ開閉状態が保存されていない
- `[]`
  - 閉じているノードが 1 つもない
- `["node-id-1", "node-id-2"]`
  - 指定した ID のノードが閉じている

### 6.5 ワークスペースプロジェクト

ワークスペースプロジェクトは、通常の `db.json` プロジェクトと同じツリー UI に変換して表示する。

- ワークスペースプロジェクトの root task は、プロジェクト自身を表すルートノードとしてツリー上に表示する
- root task の `parents` は空配列である
- root task 配下の通常タスクは、root task の子ノードとして表示する
- `tree_data` がワークスペース読み込みで更新された場合、検索フィルタの変更を待たずに表示用ツリーも同期する

### 6.6 ステータス

ステータスは次のいずれかである。

- `Open`
- `Pending`
- `In Progress`
- `Completed`
- `Canceled`

### 6.7 メモ

各メモは次の情報を持つ。

- `title`
  - メモタブ名
- `content`
  - Markdown メモ本文

メモ本文は Markdown として扱う。
旧 Quill 形式の Delta オブジェクト（`{ ops: [...] }`）が残っている場合は、表示時に `ops[].insert` を連結して読み取り可能な Markdown / プレーンテキストへ変換する。
文字列以外かつ Quill Delta ではない値は、後方互換用に JSON 文字列として表示する。

Markdown プレビューでは次の表現を扱う。

- 見出し、箇条書き、引用、コード、表などの GitHub Flavored Markdown
- task list
- Markdown 画像記法
- 同一タスク内メモへの `[[Wiki Link]]` と `[[Wiki Link|Alias]]`
- 外部 URL への wiki link

画像ペーストの保存先は保存モードによって異なる。

- ワークスペースプロジェクトでは、画像を対象タスク配下の `assets/` に保存し、本文には `![](./assets/<file>)` の相対パスを挿入する
- `db.json` モードでは、対応するタスクディレクトリがないため、画像を `data:image/...;base64,...` の data URL として本文に埋め込む
- プレビュー時、外部 URL と `data:` URL はそのまま表示し、ワークスペース内の相対画像パスは Electron 側で file URL へ解決する

## 7. 画面構成

### 7.1 メイン画面

メイン画面は次の領域で構成される。

- ヘッダー
  - メニュー
  - タイトル
  - テーマ切替
- 左側
  - プロジェクト一覧
  - Info 一覧
- 中央から右側
  - タスクツリー
  - タスク詳細

### 7.2 タスクツリー画面

タスクツリー画面は左右 2 ペイン構成である。

- 左ペイン
  - タスク追加
  - 子タスク追加
  - タスク削除
  - タスク名フィルタ
  - ツリーテーブル
- 右ペイン
  - 選択中タスクの詳細
  - メモ編集
  - ステータス変更
  - 期限日変更

### 7.3 ページ内検索バー

`Ctrl+F` または `Cmd+F` で、現在のウィンドウ内にページ内検索バーを表示できる。  
検索対象は、その時にアクティブなウィンドウ自身である。

### 7.4 タスク詳細ウィンドウ

タスクは別ウィンドウでも詳細表示できる。  
このウィンドウでは、右ペイン相当の編集内容を独立して表示する。

## 8. 主な機能

### 8.1 プロジェクト管理

- プロジェクトの追加
- プロジェクトの削除
- プロジェクト順のドラッグ＆ドロップ変更
- 並び順の保存

### 8.2 タスク管理

- タスクの追加
- 子タスクの追加
- タスク削除
- タスク名の編集
- ステータス変更
- 期限日変更
- メモ編集

### 8.3 ツリー操作

- ノードの展開 / 折りたたみ
- 行ドラッグ＆ドロップによる移動
- メニューによる移動
  - `move up`
  - `move down`
  - `move right`
  - `move left`

### 8.4 検索とフィルタ

本アプリには 2 種類の検索系機能がある。

- タスクフィルタ
  - タスク名による部分一致
  - ステータスの複数選択
- ページ内検索
  - 表示中ウィンドウ内の文字列検索

### 8.5 テーマ

- ダークテーマ
- ライトテーマ

テーマは保存され、再起動後も維持される。

## 9. 状態管理

アプリ全体の状態は `src/stores.ts` で管理している。  
主な状態は次のとおりである。

- プロジェクト一覧
- 現在のプロジェクト
- 現在の選択タスク
- 現在のツリーデータ
- フィルタ条件
- テーマ
- ノード開閉状態
- ページ内検索バーの表示状態

renderer で状態が変わると、必要に応じて `window.electronAPI` 経由で保存や同期処理を行う。

## 10. 現在の実装上の挙動

現在の実装として、次の挙動を持つ。

- 起動時に保存済みプロジェクトがあれば、先頭プロジェクトを開く
- プロジェクトが無い場合は `No data.` を表示する
- ルートノードは削除できない
- ワークスペースプロジェクトを開いた時も、プロジェクト root はツリーのルート行として表示される
- タスク未選択時にタスク追加を行った場合は、ルートノード配下へ最初のタスクを追加する
- ルートノード選択時に「下に追加」を行った場合も、ルートノード配下へタスクを追加する
- タスク追加時は、追加された行が選択される
- 子タスク追加時、親が折りたたみ状態なら自動展開する
- 別ウィンドウで開いたタスク詳細は編集できる
- 別ウィンドウでの編集内容は、同一プロジェクトを開いている他ウィンドウへ同期される
- 対象タスクが削除されると、サブウィンドウでは `Task not found.` を表示する
- 対象プロジェクトが削除されると、サブウィンドウでは `Project not found.` を表示する
- メモ内の通常リンクや外部 URL wiki link をクリックすると外部ブラウザで開く
- メモ内の同一タスク内 wiki link をクリックすると、同名のメモタブへ移動する
- メモ編集中に画像をペーストすると、保存モードに応じて workspace assets または data URL として Markdown 画像が挿入される
- リンクを開けなかった場合はメモ上部にエラーバナーを表示し、×ボタンで閉じられる
- リンク処理中は重複クリックを無視し、処理完了後に次のクリックを受け付ける

## 11. 開発時によく使うコマンド

- `npm run dev`
  - Vite dev server を起動し、Electron を自動起動する。HMR によりファイル変更が即時反映される
- `npm run build`
  - Vite で配布用ビルドを `dist/` に生成する
- `npm run start`
  - ビルド済みの `dist/` を読み込んで Electron を起動する
- `npm run check`
  - 型と Svelte の基本チェックを行う
- `npm run test:unit`
  - unit テストを実行する
- `npm run test:component`
  - component テストを実行する
- `npm run test:e2e`
  - E2E テストを実行する

関連ドキュメント:
[testing.md](testing.md) / [../README.md](../README.md)
