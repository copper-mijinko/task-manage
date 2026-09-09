# Workspace Graph と TreeGrid

## 背景と比較基準

PR #233 の比較基準は `05fc3efd10a8d1e3a5ee78620a1ee609584576c2`。
WorkspaceProject の表示を NodeWorkspacePage へ置き換えた結果、既存の
MainPage / TreeTable が持つ検索、列別フィルター、カラム設定、複数選択、
情報密度、詳細ペイン、Gantt の操作が Workspace から利用できなくなった。
これらの View はコードに残っており、Graph モデル導入のために全面置換する必要はない。

| PR #233 の変更 | 判断 | 対応 |
| --- | --- | --- |
| Workspace 全体の Graph、ordered parent edges | Domain の進化 | 維持 |
| command engine、revision、undo/redo、graph-v1、migration | Application / 保存機構の進化 | 維持 |
| Workspace Root による横断操作 | UX の改善 | TreeGrid の scope として維持 |
| node 本文・タグ・添付、共有node編集 | 新モデルの能力 | 既存の詳細・本文 View に接続 |
| WorkspaceProject → NodeWorkspacePage の全面置換 | 上記能力に必須ではなく、従来の操作能力を失う | MainPage を主要 View に戻す |
| Graph / Finder の画面切替 | 今回の主要操作への明確な利点がない | UI 導線を外し、コードのみ残す |

## Domain と表示範囲

Workspace は Graph のデータ境界である。Node は本文・属性を持ち、ordered parent
edges によって複数の親を持てる。循環は有効な関係として保存される。

Project は独立した保存境界ではなく、Node を起点にした表示・ナビゲーション scope。
Workspace Root を選ぶと横断表示、Project を選ぶとその子孫を表示する。
検索、列フィルター、タグ、sort、Gantt は同じ scope の投影を使う。

## 実装の責務

| 層 | 実装 | 責務 |
| --- | --- | --- |
| View / Interaction | MainPage、TreeTable、TaskDetail、GanttPanel、SplitPanes | 既存の表示、入力、toolbar、列操作を再利用 |
| Renderer Application | features/workspace/application | occurrence 投影、選択、scope、filter/sort、展開状態、command dispatch |
| Canonical Application API | electron/workspace-application.js | 認可・初期化後の read / execute / history / asset 操作。IPC に依存しない注入可能な契約 |
| Electron transport | index.js / preload / platform | 信頼された sender を確認し、Application request を受け渡す |
| Main Domain / repository | workspace-graph-engine / workspace-graph | command validation、Graph mutation、revision、保存、migration、履歴 |

Renderer の Graph store は Application API の read model と同期・直列実行を担当する。
View は Svelte context の facade を使用し、Graph 保存データを変更しない。
投影した TreeData は使い捨ての表示互換モデルであり、本文・添付も複製する。
TreeData を Graph に逆変換して保存する経路は作らない。
アプリ内の従来プロジェクトは既存 store を使い、Workspace の mutation は facade に分岐する。

## 操作契約

`execute({ workspacePath, command, expectedRevision, origin })` が唯一の Graph mutation 契約。
create-node / update-node / move / link / detach / copy / delete-node を既存エンジンへ渡す。
archive は node の archived 属性更新として扱う。undo/redo は同じ認可・保存境界で処理する。
複数選択の更新や並び替えは batch にまとめ、全件成功時のみ一つの revision / undo 単位にする。
途中で validation が失敗した場合、入力 Graph と保存済み Graph は変更されない。

| UI の識別情報 | Application への対応 |
| --- | --- |
| node ID | 本文、属性、タグ、添付、archive の編集対象 |
| occurrence path | 表示中の親を含む一つの配置。move / detach の parent context |
| scope root ID | 投影起点。保存境界にはしない |

同じ node の編集はすべての occurrence と詳細ウィンドウに反映する。
move / detach は表示中の親の辺だけを変更する。子孫の下への link も許可し、
祖先が再出現した箇所を `循環参照` の terminal row として表示する。
copy の node / share-children / subgraph は詳細から利用でき、循環する子孫コピーも許可する。
自己親や不正な node ID などは Main の既存 validation が拒否する。

移動完了後は移動先の occurrence を現在行にする。別の親にある同じ node へ
現在行が飛ばないため、直後の detach も移動した辺に作用する。移動中に scope や
選択対象を変えた場合、その新しい選択は奪わない。子追加も操作した親の occurrence を維持する。

## UI 状態とレイアウト

列の表示設定は既存の設定 store を再利用する。幅は列名ごとに renderer の localStorage に保存し、
非表示から再表示しても復元する。名前列は pane の残り幅を吸収し、他列の幅は維持する。
展開状態は Workspace と scope ごとに保存する。これらは Graph の履歴・保存形式に含めない。
compact / comfortable、検索入力、Filter、Column configuration、toolbar の overflow、
詳細と本文の分割、別ウィンドウ、Gantt の分割は既存 View を使用する。
SplitPanes の境界位置は実際の pane サイズから計算し、resize 後のずれを防ぐ。

## 検証と制限

unit では投影の共有node・terminal cycle・scope検索・属性変換、Application認可、
batch rollback / revision と既存 Graph engine / persistence / migration を確認する。
Electron E2E では Search / Filter / Columns、複数選択、共有node編集、undo/redo、
move / detach / cycle copy、詳細ウィンドウ、保存と再起動を対象とする。

実画面比較は指定 base の v0.1.40 と変更後の実Electronをそれぞれ分離データで起動し、
Playwright MCP で実施した。列設定、情報密度、toolbar、詳細ペインはスクリーンショットでも確認した。
fixture の node 数・並び順は一致しないため、pixel-perfect 比較には使わない。

投影は既存 projector の上限 20,000 occurrence を維持する。上限時は警告を表示し、
Project scope に絞れる。極端に深い Graph や組合せ的に増える occurrence の仮想化は別課題。
非表示の Graph / Finder コードは今回の主要操作の依存先ではない。

### 検証記録（2026-09-09）

- `check`: 0 errors / 0 warnings、`lint` と `build`: 成功。
- unit / component: 全体実行で 852 成功、7 skip、Markdown 初期化のタイムアウト 1 件。
  当該ファイルと Application テストの再実行は 60 件すべて成功。
- 実Electron E2E: TreeGrid とタグの 9 件成功。最終の列幅・cycle 表示修正後も
  TreeGrid の 5 件がすべて成功。resize / reload 後の列幅を数値で検証した。
  移動直後に再選択せず detach する回帰ケースを追加後も 5 件成功。
- Playwright MCP: Workspace / Project 切替、Search + Filter、タグ、Columns、複数選択、
  共有node編集、別ウィンドウ編集、move / detach / link、cycle copy、undo / redo、
  添付追加・開く、本文編集、保存・再起動、Gantt 表示を確認。
- 実画面: base と変更後の標準・compact を確認。行高は両方 30px。
  900px 幅の実Electronスクリーンショットと pane resize を確認し、cycle 表示の
  折り返しを修正。列幅 152px の再起動復元を確認。最終 console error は 0 件。
- 連続操作: 共有nodeの移動先 occurrence が現在行になり、直後の detach がその辺だけを外すことを
  MCPでも確認。共有nodeへの子追加は、操作した親側の occurrence を選択したまま完了した。

GUI の検証用データと記録はローカルの `.playwright-mcp/gui/`、自動テストの画面は
`test-results/` に隔離し、製品データ・ソース管理の対象にしない。
