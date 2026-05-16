# task-manage

`task-manage` は、Electron と Svelte で作られたデスクトップ向けタスク管理アプリケーションです。
プロジェクトごとにタスクをツリー構造で管理でき、各タスクに状態、期限日、メモを持たせられます。

データはローカルの JSON ファイルに保存されるため、サーバーを前提とせずに動作します。

技術文書は [docs/outline.md](docs/outline.md) を参照してください。

## 主な機能

- プロジェクトごとのタスク管理
- タスクのツリー表示と階層移動
- ステータス管理
- 期限日の設定
- Markdown メモの追加と編集
- メモ内 wiki link と画像ペースト
- ワークスペース形式でのプロジェクト保存
- タスク名や状態による絞り込み
- ページ内検索
- 別ウィンドウでのタスク詳細表示
- ライトテーマとダークテーマ

## 技術構成

- デスクトップ実行環境: Electron
- UI: Svelte 5
- ビルド: Vite
- 言語: TypeScript と JavaScript の混在構成
- ローカル保存: `@commonify/lowdb`
- テスト: `Vitest`, `@testing-library/svelte`, `Playwright`

## 開発時によく使うコマンド

- `npm run dev`
  - Vite dev server を起動し、Electron を自動起動する
- `npm run build`
  - 配布用ビルドを作成する
- `npm run check`
  - 型と Svelte の基本チェックを行う
- `npm run test:unit`
  - unit テストを実行する
- `npm run test:component`
  - component テストを実行する
- `npm run test:e2e`
  - E2E テストを実行する
