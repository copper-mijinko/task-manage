# ドキュメント一覧

このディレクトリにはプロジェクトの技術文書を置く。
通常の仕様・構成文書は現在の実装を説明する。実装に先行する合意と受け入れ条件は、対象を明記した設計文書に分けて記録する。

## ドキュメント

| ファイル | 内容 |
| -------- | ---- |
| [specification.md](specification.md) | 機能仕様・画面構成・実装上の挙動・状態管理 |
| [data.md](data.md) | データ保存先・構造（db.json / meta.json / ワークスペース）・永続化・コンフリクト解決 |
| [architecture.md](architecture.md) | ソースコード階層・レイヤー責務・import 規約・ストア構成・主要パターン |
| [performance.md](performance.md) | 起動時・ワークスペースプロジェクト選択時の読み込み最適化と遅延読み込み境界 |
| [testing.md](testing.md) | テスト種別・テストケース一覧・実装状況・実行コマンド |
| [how-to-contribute.md](how-to-contribute.md) | 開発フロー・CI/リリース手順・認証認可・ドキュメント記載方針 |
| [agent-ui-development.md](agent-ui-development.md) | Codex / Claude から実 Electron GUI を操作する開発モード |
| [node-graph-design.md](node-graph-design.md) | 共通ノード・循環・ルート・4ビュー・コピー3種・操作履歴の設計と受け入れ条件 |

## 読み方のガイド

- 機能を把握したい → `specification.md`
- データ形式を調べたい → `data.md`
- ソースコードの構造を把握したい → `architecture.md`
- 起動やプロジェクト選択の性能設計を確認したい → `performance.md`
- テストを追加・実行したい → `testing.md`
- PR やリリースの手順を確認したい → `how-to-contribute.md`
- ドキュメントを編集したい → `how-to-contribute.md` § ドキュメントの記載方針
