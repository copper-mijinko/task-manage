# task-manage

`task-manage` は、Electron と Svelte で作られたデスクトップ向けタスク管理アプリです。
プロジェクトごとにタスクをツリー構造で管理し、各タスクに状態、開始日、期限日、メモ、添付ファイルを持たせられます。

サーバーを前提とせず、データはローカルに保存します。
現在は、Markdown ファイル群として保存する Workspace 形式を主な保存方式とし、従来のアプリ内 JSON 形式も互換用に残しています。

技術文書は [docs/outline.md](docs/outline.md) を参照してください。

## 主な機能

- Workspace プロジェクト
  - 任意のローカルフォルダを Workspace として登録
  - プロジェクトとタスクを Markdown ファイルとして保存
  - OneDrive などの同期フォルダでも扱いやすい保存方式
  - 外部変更の検知、競合通知、ローカル優先モード
- タスク管理
  - ツリー表示、並び替え、階層移動、複数選択
  - ステータス、開始日、期限日、添付ファイル
  - タスク詳細を別ウィンドウで表示
- メモ
  - Markdown / Quill のメモ形式をメモごとに選択
  - メモタブ、タグ、wiki link、画像ペースト
  - Workspace mode では貼り付け画像を task assets として保存
- 検索とナビゲーション
  - タスク名、状態、日付、メモ、タグによる絞り込み
  - ページ内検索
  - 戻る / 進む履歴
- Inbox
  - Workspace 単位のクイックキャプチャ
  - Inbox から Workspace プロジェクトへの送信
- 表示
  - ライトテーマ / ダークテーマ
  - サイドバー、Gantt、タスク詳細ペイン

## 技術構成

- デスクトップ実行環境: Electron
- UI: Svelte 5
- ビルド: Vite
- 言語: TypeScript と JavaScript の混在構成
- Workspace 保存: Markdown ファイル、frontmatter、task assets
- 従来保存: `@commonify/lowdb` による `db.json` / `meta.json`
- エディタ: Quill, CodeMirror, Markdown preview
- テスト: `Vitest`, `@testing-library/svelte`, `Playwright`

## 保存モデル

Workspace 形式では、編集中の画面状態を正本として扱い、ローカルの Markdown ファイルへ保存します。
遅いファイルシステムや同期フォルダでも、古い保存結果で編集中の画面が巻き戻らないようにしています。

詳しくは [docs/specification.md](docs/specification.md)、[docs/data.md](docs/data.md)、[docs/performance.md](docs/performance.md) を参照してください。

## 開発時によく使うコマンド

- `npm install`
  - 依存パッケージをインストールする
- `npm run dev`
  - Vite dev server を起動し、Electron を自動起動する
- `npm run start`
  - ビルド済みのアプリを Electron で起動する
- `npm run build`
  - 配布用ビルドを作成する
- `npm run check`
  - 型と Svelte の基本チェックを行う
- `npm run test`
  - unit / component テストをまとめて実行する
- `npm run test:unit`
  - unit テストを実行する
- `npm run test:component`
  - component テストを実行する
- `npm run test:e2e`
  - E2E テストを実行する

## ドキュメント

| ファイル                                               | 内容                                        |
| ------------------------------------------------------ | ------------------------------------------- |
| [docs/specification.md](docs/specification.md)         | 機能仕様、画面構成、状態管理                |
| [docs/data.md](docs/data.md)                           | データ保存先、Workspace 構造、永続化        |
| [docs/architecture.md](docs/architecture.md)           | ソースコード構造、レイヤー責務、import 規約 |
| [docs/performance.md](docs/performance.md)             | 起動、読み込み、保存まわりの性能設計        |
| [docs/testing.md](docs/testing.md)                     | テスト種別、テストケース、実行コマンド      |
| [docs/how-to-contribute.md](docs/how-to-contribute.md) | 開発フロー、CI、リリース、ドキュメント方針  |
