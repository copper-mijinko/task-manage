# データ仕様

← [outline.md](outline.md)

## 1. 保存先

データはローカルファイルとして保存される。

- `electron/db.json`
  - 標準プロジェクトの本体とタスクツリーを保存する
- `electron/meta.json`
  - テーマやノード開閉状態などの UI 用メタデータを保存する。アクティブワークスペースのパスもここに保存する
- ワークスペースディレクトリ
  - ユーザが選択した任意のディレクトリ配下に、プロジェクトごとのサブディレクトリと Markdown ファイル群を配置する
- `electron/window-state.json`
  - メインウィンドウの大きさ・位置・最大化状態。起動時に BrowserWindow を作る前へ読むため `meta.json` から分離している
- `electron/workspace-state/<hash>.json`
  - 各ワークスペースについて、配下ファイルの SHA-256 ハッシュ表を保存するスナップショット。`<hash>` はワークスペースの絶対パスの SHA-256 先頭 16 文字
  - 起動時およびワークスペース外部書込の取り込み後に更新する

`TASK_MANAGE_DATA_DIR` 環境変数が指定されている場合は、上記 `electron/` 配下の保存先と `workspace-state/` 配置先を当該ディレクトリへ切り替える。テスト時にはこの仕組みで保存先を分離する。

## 2. db.json

### 2.1 全体構造

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
                "content": "",
                "format": "quill"
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

### 2.2 プロジェクト

各プロジェクトは次の情報を持つ。

- `headers`
  - テーブル列定義
- `data`
  - ルートタスク

### 2.3 タスク

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
  - メモ配列。各エントリは `title` / `content` / `format` を持つ（詳細は § 6 参照）
- `data.tags`
  - タスク自身のタグ配列。省略時はタグなしとして扱う
- `children`
  - 子タスク配列

## 3. meta.json

`meta.json` は、画面表示のための設定を持つオブジェクトである。
現在は主にテーマと、各プロジェクトのノード開閉状態を保存している。

次のような形で保存される。

```json
{
  "theme": "light",
  "workspaceConflictPolicy": "ask",
  "preferences.date_time_format": "slash",
  "closed_paths_8e392450-20f7-479a-a7f2-38bdafb913df": null,
  "closed_paths_89f8d9b0-c94e-4f9f-80e6-1ef8d9448088": []
}
```

この JSON の見方は次のとおりである。

- `theme`
  - アプリ全体のテーマ
- `workspaceConflictPolicy`
  - ワークスペース保存時に外部書込との競合が検知されたときの挙動。`"ask"`（既定）はバナーで「維持 / 再読込」を問い合わせる。`"prefer-memory"` は問い合わせを行わず、メモリ上の `tree_data` を優先してそのまま上書き保存する（`forceLocal` 経路）
- `preferences.date_time_format`
  - 入力ショートカット（`Ctrl+;` / `Ctrl+:`）でテキスト入力に挿入される書式。`"slash"`（既定、`2026/05/26`）/ `"iso"`（`2026-05-26`）/ `"japanese"`（`2026年5月26日`）のいずれか
- `closed_paths_<プロジェクトID>`
  - そのプロジェクトで閉じている**行（経路）**の一覧

ノードは親を複数持てるため、同じノードが親ごとに複数の行として現れる。
開閉はノードではなく**行＝辺**ごとの状態なので、キーにはノード ID ではなく
ルートからの経路（`ルートID/親ID/子ID`）を使う。片方の親の下で閉じても、
もう片方の親の下は開いたままになる。

`closed_paths_<プロジェクトID>` の値は、状況によって次のように変わる。

- `null`
  - まだ開閉状態が保存されていない
- `[]`
  - 閉じている行が 1 つもない
- `["root-id/parent-id", "root-id/parent-id/child-id"]`
  - 指定した経路の行が閉じている

旧版はノード ID の配列を `closed_nodes_<プロジェクトID>` に保存していた。
意味が変わったのでキーを分けてあり、旧キーは読まない。移行後の初回だけ
開閉状態が初期化される（データには影響しない）。

## 3a. Inbox

Inbox はワークスペースごとに 1 つ存在する、プロジェクト非依存・フラット構造の特別なバケットである。

### 3a.1 ファイル配置

```
<workspace>/
├── _inbox/                     ← Inbox 専用ディレクトリ（_ 接頭辞）
│   ├── _project.md             ← Inbox のルートマーカー（kind: inbox）
│   ├── <uuid-a>/
│   │   ├── _index.md           ← Inbox アイテム
│   │   ├── <memo-id>.md        ← メモ（任意の数）
│   │   └── assets/             ← ペースト画像など
│   └── <uuid-b>/...
├── プロジェクトA/
└── プロジェクトB/
```

- ディレクトリ名が `_` で始まるため、`listProjects` の通常プロジェクト一覧から自然に除外される
- `_project.md` のフロントマターには `kind: inbox` を追加し、初回作成時に固定の `id`（UUID）を発行・永続化する。以降この id が Inbox ルートタスクとして扱われる
- アイテムは `parents: [<inbox-root-id>]` を満たすフラット構造のみ。renderer 側で indent/child 追加は提供しない。main 側の `readInbox` はパース時に `parents` を `[rootId]` にクランプして念のため矛盾を矯正する

### 3a.2 IPC 一覧（main プロセス側 API）

| チャネル | ペイロード | 役割 |
| --- | --- | --- |
| `ws:ensure-inbox` | `{ workspacePath }` | `_inbox/` と `_project.md` を必要なら作成し、`{ projectDir, rootId }` を返す |
| `ws:read-inbox` | `{ workspacePath }` | `ws:read-project` 相当。Inbox の全アイテムを読み出す |
| `ws:add-inbox-item` | `{ workspacePath, item }` | 1 件追加。書込→再ロード不要にするため `workspace-project-updated` も発火する |
| `ws:send-inbox-items` | `{ workspacePath, targetProjectDir, targetRootId, targetParentId?, taskIds }` | 指定したアイテムを対象プロジェクトに移動。`targetParentId` を指定するとそのノードの子の末尾に、省略時はプロジェクトのルート直下に追加。ディレクトリごと `rename` するためメモ・アセットがそのまま運ばれる |

Inbox 全体の永続化には既存の `ws:write-project(<inbox-projectDir>, items, options)` を再利用する。Inbox ディレクトリは構造的にワークスペースプロジェクトと同等のため、`WorkspaceWriteQueue` / `WorkspaceReconciler` / `wsCache` がそのまま機能する。

### 3a.3 送信処理

`ws:send-inbox-items` は以下の順序でアトミックに振る舞う：

1. ソース（Inbox）とターゲット（プロジェクト）の双方を `readProject` で読み出す
2. `targetParentId` 指定時はターゲットプロジェクト内に該当 ID が存在することを確認する（不在ならエラー）。省略時はターゲットのルート ID をフォールバックとして用いる
3. 各 taskId について：
   - ソース `_inbox/<dir>/` を `fs.rename` で `<projectDir>/<dir>/` へ移動（同一ボリュームなら原子的、`EXDEV` 時は `cp -r` + `rm -rf` にフォールバック）
   - 移動先のディレクトリ名が衝突する場合は `-2`, `-3` … のサフィックスを付ける
   - `parents` を解決後の親 ID で書き換え、`order` を解決後親の既存子の末尾に連番採番し、`writeTaskAsync` で `_index.md` を更新
4. 双方の `wsCache` を最新化し、`workspace-project-updated` を双方の projectDir 向けに送出

タスク内のメモ・assets は `_index.md` と同階層に保存されているため、ディレクトリ移動だけで相対パスは破綻しない。

## 4. ワークスペースプロジェクト

ワークスペースプロジェクトは、通常の `db.json` プロジェクトと同じツリー UI に変換して表示する。

- ワークスペースプロジェクトの root task は、プロジェクト自身を表すルートノードとしてツリー上に表示する
- root task の `parents` は空配列である
- `parents` は配列で、**1 つのタスクが複数の親を持てる**（多親）。ファイル形式と読み込みは多親をそのまま扱う

#### 親リンクと並び順

並び順は**辺の属性**なので、親 id と組で子側に持つ。

```yaml
id: t-w3
name: トップページ実装
parents:
  - id: proj-web
    order: 1
  - id: t-w2
    order: 0
created: 2026-08-24
```

- 同じノードが、**親ごとに違う位置**を取れる（上の例は proj-web の下では 2 番目、t-w2 の下では先頭）。ノードに `order` を 1 つだけ持たせると、片方の親の下で並べ替えたときにもう片方でも動いてしまう
- タスク直下の `order:` は**ルートタスク（＝プロジェクト自身のワークスペース内での並び順）だけ**が持つ。通常タスクには書かない
- `order` を書かない辺は「末尾」。並び順が同じ／未指定どうしの兄弟は **id の昇順**で並べる。ファイルの読み取り順に頼ると環境で並びが変わる
- **読みは 3 つの形を受ける**（後方互換）。
  - `parents: [{ id, order }]` … 現行
  - `parents: [id, id]` … 旧形式・手書きの短縮形。タスク直下の `order` を全ての辺に配る（旧来の「どの親の下でも同じ位置」の意味をそのまま保つ）
  - `parents: id` … 単一のスカラー
- **書きは現行形式だけ**。旧形式のファイルはそのまま読めて、そのタスクを次に保存したときに現行形式へ移る。移行スクリプトは要らない
- 正規化は main 側（`electron/workspace.js` の `normalizeParentLinks`）と renderer 側（`src/lib/utils/parent_links.ts`）に同じ仕様で 2 つある。片方だけ直さないこと
- frontmatter の読み書きは自前実装（`parseFrontmatter` / `stringifyFrontmatter`）で、スカラー配列とマップ配列の両方を扱う。自前パーサなので数値は文字列で返り、正規化側で数値に直す
- 回帰テストは `tests/unit/multi_parent.test.ts`（親ごとの並び順・往復・タイブレーク）と `tests/unit/workspace.test.js`（往復と旧形式の読み込み）

#### 多親と、ツリー表示の関係 — 行は「辺」であってノードではない

ツリーは多親構造の**射影**である。多親ノードは**親ごとに 1 行ずつ**現れる。

- `workspaceToProjectData` は親ごとに展開する。打ち切るのは**循環だけ**で、判定は「グローバルに一度出したか」ではなく「いま辿っている経路の祖先に含まれるか」で行う。前者だと多親が全域木に潰れ、辺が消える（保存にも波及していた）
- 病的な構造で固まらないよう、総ノード数に安全弁（`MAX_TREE_NODES`）を置く。通常のデータでは到達しない
- 同じ id の行が複数あるため、**行の同一性は経路**（`親id/子id/…`）で決まる。`VisibleTreeRow.path` がそれで、Svelte の keyed each の key・行番号・キーボード移動・フォーカス復帰はすべて経路で引く。id を key にすると `each_key_duplicate` で描画が壊れる
- DOM の `id` 属性は**最初の出現にだけ**付ける（`isPrimaryOccurrence`）。重複 id を作らず、既存の `getElementById` と E2E の `#<taskId>` セレクタはそのまま動く。全出現は `data-node-id` / `data-row-path` で引ける
- 選択はノード id で行う。したがって**片方の行を選ぶと全出現が選択表示になる**。多親ノードが「同じもの」だと分かる手掛かりになるので、これは意図的。ただし**いま操作している行（辺）は別扱い**で、それ以外の出現は塗りを薄く・左のバーを破線にして弱める（`TreeTable` の `activeRowPath` / `EchoRow`）
- 折り畳みも**行（辺）ごと**の状態なので、`closed_row_paths` は経路を持つ（永続化キーは `closed_paths_<プロジェクトID>`）。片方の親の下で畳んでも、もう片方の下は開いたまま。インデント／アウトデントで経路が変わるときは `rekey` で状態を移し、ツリーが変わるたびに `pruneMissing` で存在しない経路を捨てる（畳んだノードを動かすと開いてしまう／古い経路が溜まる、という両方を防ぐ）
- **行に紐づくものはすべて経路で引く**。名前パス（`buildNodePathMap`）、祖先から継承する期限（`buildInheritedDueDateMap`）、スクロール時のパンくず（`buildStickyTrail`）、ガントの行（`GanttPanel` の keyed each）。ノード id で引くと、別の親の下の値が混ざる（ガントは `each_key_duplicate` で描画が壊れる）
- D&D は「掴んだ辺を外して、落とした行の隣に置く」。`reorderTree` / `addNode` / `rmNode` / `bulkAddNodes` は経路を受け取る
- 「アーカイブされた扱いか」は、**ルートから archived を通らずに辿り着けるか**で決める（`isNodeEffectivelyArchived`）。片方の親がアーカイブでも、もう片方から生きて辿れるならそのノードは生きている。復元（`restoreNode`）はクリックした行の祖先だけを解除する
- Shift 選択の範囲も行で決まる。起点は `selection_anchor_path`（id だけだとどの出現が起点か決まらない）
- 移動・インデント・アウトデントは「どの**辺**を動かすか」の操作なので、**クリックした行の親**に効く（`moveNodeUp` などが取る `rowPath`）。ノード id から親を引くと、最初に見つかった親＝別の行が動いてしまう。ツールバーとショートカットも `active_row_path`（ツリーでいま操作している行）を見る
- **同じノードの複数の出現は同一オブジェクトを共有する**。`archived` とノードの中身（名前・状態・メモ）はノードの属性なので、片方の出現にだけ子が足されるのは誤り（並び順だけは辺の属性で、`parents[].order` に持つ）。共有できるのは経路に依らない部分木だけで、循環を打ち切った部分木は共有しない。ツリーを作り直す関数（`updateNodeDataById` / `bulkUpdateNodeData` / `bulkRemoveNodes`）は同じ入力に同じ出力を返して共有を保つ

#### 孤児を作らない

どのノードも必ず 1 つ以上の親を持つ。保存はツリーを辿って書き出すため、ルートから辿れなくなったタスク（＝孤児）は**ファイルごと消える**。孤児は 2 つの経路で生まれうるので、両方で受け止める。

- **削除時**（`reattachOrphans`）。削除は「辺を 1 本切る」操作でしかない。切った先が唯一の親だった子は、その場でルート直下に付け直す。他にも親があるノードは動かさない。まとめて消したノード同士も拾わない
- **読み込み時**（`workspaceToProjectData`）。存在しない親を指している、親をたどると自分に戻る、といったタスクはアプリの外（エディタ・CLI・同期）で生まれうる。読み込み時に 1 パスで検出してルート直下に付け直す。次の保存で `parents` も直る
- 循環がファイル側にある場合、木に描けない辺が出る。これは `TreeData.cutParentIds` に載せて保存で書き戻す（木からは導けないので、ここでしか復元できない）。アプリ内では循環を作れない（`canIndentNode` / `canDropTarget` が止める）ので、これは外で作られたデータの受け皿
- 辺は集合なので、すでに親であるノードの下へ動かしても二重に足さない（`addNode` / `bulkAddNodes`）。二重になると行の経路が衝突して描画が壊れる
- 回帰テストは `tests/unit/orphans.test.ts`
- `projectDataToWorkspaceTasks` は同じノードを複数回訪れるので、**ノードごとに 1 件だけ出し、親は全出現の和**を採る。木が全ての辺を見せるようになったため、木の位置から親を正確に導ける。片方の出現だけを動かせばその辺だけが変わり、他の親は残る
- 回帰テストは `tests/unit/multi_parent.test.ts`
- root task 配下の通常タスクは、root task の子ノードとして表示する
- `tree_data` がワークスペース読み込みで更新された場合、検索フィルタの変更を待たずに表示用ツリーも同期する

#### タグ

ワークスペースタスクのタグは、タスクの `_index.md`（ルートタスクは `_project.md`）の frontmatter に `tags:` リストとして保存する。

```yaml
---
id: 1b2c...
name: トップページ実装
status: In Progress
tags:
  - frontend
  - 設計
created: 2026-09-01
---
```

- タグが 1 件もないタスクには `tags:` キー自体を書かない（既存ファイルとの差分を増やさないため）
- 読み込み時は前後の空白・先頭の `#` を落とし、大文字小文字を無視して重複排除する。ファイルを手で編集して `tags: frontend, 設計` のようにカンマ区切りで書いた場合も配列として読む
- メモのタグ（各メモファイルの frontmatter）とは独立している。サイドバーの Tags フィルタは両者を 1 つの索引として扱う

#### 添付ファイル

ワークスペースタスクは、任意ファイルをタスク単位の添付として保持できる。添付は `db.json` には保存せず、ワークスペースプロジェクトのタスクディレクトリ配下に実ファイルとして置く。

```
<projectDir>/
├── _project.md
├── attachments/              ← root task の添付
│   └── <file>
└── <task-id>/
    ├── _index.md
    ├── <memo-id>.md
    ├── assets/               ← メモ内ペースト画像
    └── attachments/          ← 通常タスクの添付
        └── <file>
```

- 添付ファイル名は `safeFileName` / `uniqueFileName` で正規化し、同名衝突時は `-2`, `-3` … のサフィックスを付ける
- `readProject` は各タスクの `attachments/` 直下にある通常ファイルを列挙し、`WorkspaceAttachment { id, name, relativePath, size, modifiedAt }` として返す
- `relativePath` は `./attachments/<file>` 形式に限定する。`resolveTaskAttachmentFilePath` は `attachments/` 外へのパストラバーサル、絶対パス、NUL 文字を拒否する
- 添付追加・削除は単発 IPC として実行し、成功時に main 側の `wsCache` と renderer 側の `tree_data` を更新する。タスク本文 `_index.md` には添付一覧を書かない
- タスクツリーの `attachments` 列は `attachments` 配列の長さを表示する。既存データのように `attachments` が未定義の場合は `0` として扱う

添付関連 IPC:

| チャネル | ペイロード | 役割 |
| --- | --- | --- |
| `ws:save-task-attachment` | `{ projectDir, taskId, fileName, bytes }` | ファイルを対象タスクの `attachments/` へコピーし、作成された `WorkspaceAttachment` を返す |
| `ws:delete-task-attachment` | `{ projectDir, taskId, attachmentPath }` | `./attachments/<file>` を削除し、削除後の添付一覧を返す |
| `ws:open-task-attachment` | `{ projectDir, taskId, attachmentPath }` | 添付ファイルを OS の既定アプリで開く |
| `ws:open-task-attachment-with` | `{ projectDir, taskId, attachmentPath }` | Windows の「プログラムから開く」ダイアログを表示する |

### 4.1 永続化の挙動

Workspace の通常編集では、renderer 側の Svelte store を単一の信頼元とする。

- `tree_data` は現在開いている Workspace プロジェクトのタスクツリー本体であり、保存処理はこのメモリスナップショットを main プロセスへ渡して非同期にディスクへ反映する
- `workspace_store.projects` はサイドバー用のプロジェクト summary であり、root task 名や並び順など `tree_data` から派生できる情報はメモリ上で同期する。通常操作の直後に `ws:list-projects` でディスクを読み直して UI を補正してはならない
- `workspace_tasks_cache` は保存時に `createdAt` など tree 表現に含まれないメタデータを保つ補助キャッシュであり、summary 側から task cache へ逆流させない
- ディスクから renderer のメモリへ取り込むのは、起動、workspace 切替、project 選択、migration/export 後の明示 refresh、外部更新リコンサイル、ユーザーが競合解決で reload を選んだ場合に限る
- 書込失敗時もディスクを読み戻してメモリ状態を勝手に巻き戻さない。エラー状態を通知し、ユーザー操作または明示的な reload で解決する

ワークスペース保存は、メモリ上の `tree_data` を唯一の正として、main プロセスが非同期にディスクへ反映する形をとる。renderer は保存完了を待たず（fire-and-forget）、状態は main からの IPC push で更新する。

- **差分パッチ保存**: 通常編集では renderer が前回保存時の `tree_data` と現在の `tree_data` を比較し、変更されたタスクと削除された task id だけを `ws:write-project-patch` で main へ送る。前回データがない初回保存や互換経路では、従来どおり `ws:write-project` で全体スナップショットを送る
- **実ファイルの増分書込**: `electron/workspace.js` の `writeFileIfChanged` が既存ファイルとバイト比較し、内容に差がなければ書込をスキップする。差分パッチの対象になったタスクでも、最終的に内容が同じファイルは書き直さない。OneDrive 等の同期フォルダで、変更のないタスク/メモが無用にアップロードされない
- **原子的書込**: `atomicWriteFile` が同一ディレクトリ内の一時ファイル（`.<basename>.<pid>.<ts>.<uuid>.tmp`）に書いてから `rename` で確定する。Reconciler はファイル名に `.tmp` を含むイベントを無視する
- **書込ログ（自前書込フィルタ）**: `atomicWriteFile` は成功直後に optional コールバック `onWritten(filePath, buffer)` を発火する。queue 経由の書込パスはこれを `reconciler.recordWrite(filePath, buffer)` に紐づけ、`knownFileHashes` を同期的にその場で最新ハッシュへ更新する。chokidar の change イベントが届いたとき `knownFileHashes.get(path) === hashFile(path)` が成立すれば「自前書込」として suppress される。これにより、大規模プロジェクトの書込バッチが長時間化しても reconcile タイマーが先に発火して偽陽性 conflict を出すことがなくなる
- **リトライ**: `retryFileOperation` が `EBUSY` / `EPERM` / `ENOTEMPTY` に対して指数バックオフで 5 回まで再試行する（初期 40ms）。それでも書込が失敗した場合、`forceLocal: true` のジョブは queue の `processLoop` が指数バックオフ（初期 200ms、最大 5 回）で再エンキューし、`saveStatus: "retrying"` を発火する
- **キューイング**: `WorkspaceWriteQueue`（`electron/workspace-write-queue.js`）が `projectDir` をキーに最新の全体スナップショットまたは差分パッチを保持し、直列に書き出す。同一 projectDir のペンディングパッチはマージし、全体スナップショットが既に待機している場合はそこへパッチを反映する。同時にペンディング可能な projectDir は最大 8 個。renderer の `ws:write-project` / `ws:write-project-patch` IPC は enqueue だけ行い `{ success, queued: true }` を即返す。enqueue は `{ forceLocal? }` オプションを受け付ける
- **Task Detail 別ウィンドウ同期**: Workspace 編集時は disk queue の完了を待たず、renderer が `ws:broadcast-project-snapshot` で現在のタスクスナップショットを main へ渡す。main はその内容を optimistic な `wsCache` として保持し、他ウィンドウへ `workspace-project-updated (reason: "local-update")` を送る。`ws:read-project` は pending / optimistic 状態の projectDir では disk よりこの cache を優先するため、OneDrive 同期フォルダで書込が遅れていても Task Detail 別ウィンドウは stale な disk ではなくメイン画面と同じ in-memory tree を開く。queue 書込完了後は `workspace-project-updated (reason: "local-write")` を送って確定状態へ揃える
- **競合の取り扱い**: `workspaceConflictPolicy === "ask"` のときは reconciler が `workspace-conflict` を発火し、saveStatus が `conflict` に遷移する。renderer はバナーで「維持 / 再読込」を問い合わせる。`"prefer-memory"` のときは renderer が `wsWriteProject` / `wsWriteProjectPatch` 呼出に `forceLocal: true` を自動付与し、reconciler は `workspace-notice (kind: "overwritten-external")` のみ発火する。saveStatus は `conflict` には遷移せず、メモリ内容で上書き保存を続行する
- **保存状態**: 1 回の保存サイクルでステータスは `queued` → `writing` → `saved` を取り、失敗時は `error`、外部書込との衝突時は `conflict`、`forceLocal` のリトライ中は `retrying` をとる。renderer の `saveStatus` ストアはこの状態を `workspace-save-status` イベントで受信する
- **終了時 flush**: アプリ終了要求時、キューにペンディングが残っていれば `mainWindow` の `close` を `event.preventDefault()` で抑止し、renderer にオーバーレイを表示させたうえで `flush()` の完了を待ってから `mainWindow.destroy()` する。30 秒タイムアウトで「強制終了 / 継続」のダイアログを出す。詳細は [`docs/architecture.md` §8.9](architecture.md#89-ワークスペース永続化パイプライン) 参照

### 4.2 エクスポート（db.json → Workspace）

`db.json` プロジェクトをワークスペースプロジェクトへ一方向に変換する。逆方向（Workspace → `db.json`）のパスは存在しない。

- エクスポート先のワークスペースプロジェクトには新規 UUID を発行する。各メモにも新規 UUID を発行する（ソースの ID は引き継がない）
- エクスポート時にメモのフォーマットを保持するか、全メモを Markdown に変換するかを選択できる
- 内部実装はバッチ処理のため、ワークスペースの通常書込（非同期キュー）ではなく同期版 API を使用する

## 5. ステータス

ステータスは次のいずれかである。

- `Open`
- `Pending`
- `In Progress`
- `Completed`
- `Canceled`
- **無し**（`status:` キーを書かない）

### 5.1 「無し」は既定値ではなく状態のひとつ

メモがノードになると、同じツリーに「期限とステータスで追跡するノード」と
「ただ書いてあるノード」が並ぶ。後者に既定のステータスを与えると、ノート 1 つ
1 つが「未着手のタスク」として積み上がり、ステータス列も絞り込みも意味を失う。
だから「無し」は `Open` へのフォールバックではなく、対等な状態として扱う。

- **ファイルでは `status:` キーごと書かない。** 空文字を書くと、次に読んだとき
  「値がある」と「無い」を区別できなくなる。タグが 0 件のとき `tags:` を書かない
  のと同じ流儀
- **読みで `Open` を埋めない。** `data.status || "Open"` のようなフォールバックが
  1 箇所でも残ると、そこを通ったノードだけ勝手に未着手のタスクになる。読みは
  main 側の 3 箇所（`readRootTask` / `readTaskDir` / `buildTaskFromFrontmatter`）
- **renderer 側では空文字**（`NO_STATUS`）で表す。ステータスは選択コントロールの
  値として往復するため。境界での変換は `workspace_tree.ts` の 2 箇所だけ
- 既存ファイルは全て `status:` を持つので、今までのタスクは今までどおりに読める。
  `status:` の無い手書きファイルは「無し」になる（従来は `Open` だった）
- 絞り込みは**完全一致**で見る。部分一致だと、あらゆる文字列が空文字を含むので
  「なし」で絞ったときに全行が残ってしまう
- 選択済みステータスを取り出すときに `filter(Boolean)` を使わないこと。「無し」は
  空文字なので落ち、選んでもフィルタが効いていないように見える
- 並べ替えでは「無し」を最後に置く。並べ替えは進み具合を見る操作なので、
  進み具合を持たないものを間に挟むと列が読みにくくなる
- 予定ビューでは「終わっていない」側として扱う。追跡していないだけで、片付いた
  わけではないので、期限があるなら出す
- 回帰テストは `tests/unit/no_status.test.ts`

## 6. メモ

各メモは次の情報を持つ。

- `title` — メモタブ名
- `content` — メモ本文
- `format` — `"markdown"` または `"quill"`

> **実装上の注意**：メモのフィールドは 5 箇所で個別に列挙されている。新しいフィールドを足すときは**すべてに追加する**こと。1 つでも漏れると、画面とキャッシュだけが変わってファイルに書かれない、という形で壊れる。
>
> 1. `electron/workspace.js` の `readMemos` / `buildMemoEntry`（読み）
> 2. `electron/workspace.js` の `writeMemoFiles` / `writeMemoFilesAsync`（書き）
> 3. `src/features/workspace/utils/workspace_tree.ts`（ワークスペース → ツリー）
> 4. 同ファイル（ツリー → ワークスペース）
> 5. `src/features/tasks/stores/tree.ts` の `comparableWorkspaceTask`（**差分判定**。ここに無いフィールドは「変更なし」と見なされ、ディスクに書かれない）
>
> 5 が落ちると「画面とキャッシュだけが変わってファイルに書かれない」という形で
> 壊れる。過去に `kind` で実際に起きた。

### 6.1 フォーマットの決定ルール

フォーマットはメモごとに保持される。省略時のデフォルトはプロジェクトの保存先によって異なる。

- `db.json` プロジェクトのメモで `format` が省略されている場合 → `"quill"` として扱う
- ワークスペースプロジェクトのメモで `format` が省略されている場合 → `"markdown"` として扱う

新規作成するメモのデフォルトもプロジェクトの保存先に従う。

- `db.json` プロジェクト → `"quill"`
- ワークスペースプロジェクト → `"markdown"`

### 6.2 ワークスペースメモのファイル形式

ワークスペースプロジェクトのメモは、フォーマットに関わらずすべて `.md` ファイルとして保存される。内部構造はフォーマットによって異なる。

- **Markdown メモ**：YAML フロントマター + Markdown 本文
- **Quill メモ**：フロントマターに `format: quill` を追加し、本文は Quill Delta を JSON として fenced コードブロックに格納する

### 6.3 フォーマット変換

メモのフォーマットは個別または一括で切り替えられる。

- **個別変換**：各メモのフォーマット切替 UI で Markdown ⇄ Quill を切り替える
- **一括変換**：ツールバーの「全メモを Markdown / Quill に一括変換」ボタンで、現在開いているプロジェクトの全メモを変換する
  - 変換内容の警告フェーズと、完了結果フェーズを持つモーダルで確認する
  - プロジェクト全体の変換は単一の Undo アクションとして記録され、1 回の Undo で元に戻せる

### 6.4 Markdown プレビュー

Markdown メモのプレビューでは次の表現を扱う。

- 見出し、箇条書き、引用、コード、表などの GitHub Flavored Markdown
- task list / Markdown 画像記法
- 同一タスク内メモへの `[[Wiki Link]]` と `[[Wiki Link|Alias]]`
- 外部 URL への wiki link

画像ペーストの保存先は保存モードによって異なる。

- ワークスペースプロジェクト：画像を対象タスク配下の `assets/` に保存し、本文には `![](./assets/<file>)` の相対パスを挿入する
- `db.json` プロジェクト：対応するタスクディレクトリがないため、画像を `data:image/...;base64,...` の data URL として本文に埋め込む
- プレビュー時、外部 URL と `data:` URL はそのまま表示し、ワークスペース内の相対画像パスは Electron 側で file URL へ解決する

旧 Quill 形式の Delta オブジェクト（`{ ops: [...] }`）が文字列フィールドに残っている場合は、表示時に `ops[].insert` を連結してプレーンテキストへ変換する。それ以外の非文字列値は後方互換用に JSON 文字列として表示する。

## 7. 外部書込とコンフリクト解決

ワークスペース配下のファイルが、本アプリ以外（OneDrive 同期、手動編集、別エディタなど）によって書き換えられたケースに対応する。

`WorkspaceReconciler`（`electron/workspace-reconciler.js`）が、アクティブワークスペース直下を `chokidar` で監視している。

- **自前書込の除外**: `atomicWriteFile` の `onWritten` フックから `reconciler.recordWrite(filePath, buffer)` が同期的に呼ばれ、`knownFileHashes` が常に最新ハッシュを保つ。chokidar が発火した change イベントについて、`hashFile(path) === knownFileHashes.get(path)` が成立すれば「自分の書込」として無視する。これにより、書込みごとに per-file 単位で偽陽性が発生しないことが保証される
- **OneDrive 等の待機**: `awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }` でファイルサイズが安定するまで待つ
- **デバウンス**: 同一プロジェクトへの連続イベントは 100ms でデバウンスしてから `reconcileProject` を呼ぶ

`reconcileProject` の挙動は次のとおりである。

- ローカルにペンディング書込がある（`workspaceWriteQueue.hasPending(projectDir)` が真）
  - 現在進行中のジョブが `forceLocal: true` の場合
    - `workspace-conflict` は発火しない。代わりに `workspace-notice (kind: "overwritten-external")` を発火し、ユーザに「外部変更を検知したがメモリ優先設定で上書きした」ことを通知する
    - saveStatus は `conflict` に遷移しない
  - それ以外（`forceLocal: false` の通常時）
    - `workspace-conflict` イベントを発火し、`saveStatus` を `conflict` にする
    - 取り込みは行わない。renderer 側でユーザに「維持 / 再読込」を選ばせる
- ペンディングがない
  - ディスクを再読込し、`workspace-project-updated` を発火する
  - main の `wsCache` を新しい `tasks` / `taskDirs` で更新し、renderer の `tree_data` も同期する
  - `workspace-notice (kind: "workspace-updated")` 通知バナーを表示する

ファイル名に `conflicted copy` を含む変更を検知した場合は、内容は触らず `workspace-notice (kind: "conflicted-copy")` を発火してユーザに知らせる。自動マージは行わない。

renderer がコンフリクトを解決するには、`ws:resolve-conflict` IPC に次のいずれかを渡す。

- `action: "keep-local"`
  - キュー内のペンディング書込をそのまま継続。次の保存で外部変更を上書きすることになる
- `action: "reload"`
  - キュー内のペンディング書込を破棄してディスクを再読込し、renderer に `workspace-project-updated (reason: "conflict-reload")` を push する
  - ただし当該プロジェクトの保存ジョブが既に `writing` 中の場合はリロードを拒否する
