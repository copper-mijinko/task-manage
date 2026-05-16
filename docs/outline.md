# ドキュメント一覧

このディレクトリにはプロジェクトの技術文書を置く。
文書は今時点の実装を断面として説明するためのものであり、経緯・TODO・将来計画は含めない。

## ドキュメント

| ファイル | 内容 |
| -------- | ---- |
| [specification.md](specification.md) | 機能仕様・画面構成・実装上の挙動・状態管理 |
| [data.md](data.md) | データ保存先・構造（db.json / meta.json / ワークスペース）・永続化・コンフリクト解決 |
| [architecture.md](architecture.md) | ソースコード階層・レイヤー責務・import 規約・ストア構成・主要パターン |
| [testing.md](testing.md) | テスト種別・テストケース一覧・実装状況・実行コマンド |
| [how-to-contribute.md](how-to-contribute.md) | 開発フロー・CI/リリース手順・認証認可・ドキュメント記載方針 |

## 読み方のガイド

- 機能を把握したい → `specification.md`
- データ形式を調べたい → `data.md`
- ソースコードの構造を把握したい → `architecture.md`
- テストを追加・実行したい → `testing.md`
- PR やリリースの手順を確認したい → `how-to-contribute.md`
- ドキュメントを編集したい → `how-to-contribute.md` § ドキュメントの記載方針
