# task-manage

`task-manage` は、Electron と Svelte で作られたデスクトップ向けタスク管理アプリケーションです。  
プロジェクトごとにタスクをツリー構造で管理でき、各タスクに状態、期限日、メモを持たせられます。

データはローカルの JSON ファイルに保存されるため、サーバーを前提とせずに動作します。

## 主な機能

- プロジェクトごとのタスク管理
- タスクのツリー表示と階層移動
- ステータス管理
- 期限日の設定
- メモの追加と編集
- タスク名や状態による絞り込み
- ページ内検索
- 別ウィンドウでのタスク詳細表示
- ライトテーマとダークテーマ

## 技術構成

- デスクトップ実行環境: Electron
- UI: Svelte 3
- ビルド: Rollup
- 言語: TypeScript と JavaScript の混在構成
- ローカル保存: `@commonify/lowdb`
- テスト: `Vitest`, `@testing-library/svelte`, `Playwright`

## 開発時によく使うコマンド

- `npm run dev`
  - 開発用ビルドと watch を実行する
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

## Documents

正式な仕様やテスト基盤の説明は `docs/` 配下にまとめています。  
ここに置く文書は、今時点の実装を断面として説明するためのもので、課題の経緯や今後の改善メモは含めません。

- [docs/specification.md](docs/specification.md)
  - 現在のアプリ構成、画面、データ構造の仕様
- [docs/testing.md](docs/testing.md)
  - テスト基盤の考え方と実行方法
