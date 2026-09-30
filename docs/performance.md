# 性能設計

← [outline.md](outline.md)

## 1. 目的

本文書は、起動時とワークスペースプロジェクト選択時の読み込みを軽く保つための実装上の約束をまとめる。
対象は、Electron main process、renderer の初期バンドル、ワークスペース Markdown 読み込み、メモ本文の遅延読み込みである。
あわせて、編集・スクロール・フィルタのたびに走る renderer 側の再計算を、ツリー規模に対して無駄に重くしないための約束も扱う。

## 2. 起動時の読み込み

### 2.1 renderer 初期バンドル

起動直後の renderer は、メモエディタ本体を eager import しない。

- `src/features/memos/components/Memo.svelte` は `MarkdownMemo.svelte` と `QuillMemo.svelte` を `import()` で遅延読み込みする
- Markdown の構文ハイライトは `MarkdownMemo.svelte` 側で設定する
- `src/features/memos/utils/memo_utils.ts` はフォーマット正規化と Markdown / Quill 変換に責務を絞り、`highlight.js` など表示専用の重い依存を読み込まない

この分離により、アプリ起動時はエディタを表示する場面まで CodeMirror、Quill、Markdown preview 周辺の大きい依存を初期評価しない。

### 2.2 main process の起動処理

main process は、起動時に不要な同期 I/O を前倒ししない。

- `meta.json` は起動時に 1 回だけ読み、書込は遅延（debounce）させてまとめる（`electron/settings-store.js`）
- 開いているワークスペースは、画面の読み込みと並行して main 側で先に読み始める。画面からの最初の要求（`ws:read-graph`）は、その結果を使う。ファイル監視は持たない

## 3. ワークスペースの読み込み

ワークスペースの正本はノードごとの Markdown ファイルなので、起動時（と「読み込み直す」）に全ノードのファイルを読む。読み込みの時間はノード数にほぼ比例する。引き換えに、編集 1 回の仕事はノード数に依らない（§ 4）。

- ファイルの読み込み（`gatherWorkspace`、非同期 I/O）と、グラフの組み立て・修復（`assembleWorkspace`、純粋関数）を分ける。読み込みは同時に 32 ファイルまで並べ、イベントループを塞がない
- 小さいファイルは `stat` を挟まず、開いて 1 回で読み切る（OS への往復の回数が、読み込み時間のほとんどを占めるため）
- ノードの本文も一緒に読む。ノードを選ぶたびの追加 IPC は要らない
- main process は読んだグラフをメモリに保持し、読み直さない。ファイルは監視しない。アプリの外の変更は「読み込み直す」で取り込む
- 画像・添付の中身は読まない（ファイルの一覧と参照だけ）

計測値（参考。本文 3,000 文字（約 9 KB）付きのノード、OS のキャッシュが温まった状態、開発用コンテナ）:

| ノード数 | 読み込み（読む + 組み立て） |
| ---: | ---: |
| 500 | 約 0.15 秒 |
| 2,000 | 約 0.5 秒 |
| 5,000 | 約 1.2 秒 |

画面の最初の表示はこの読み込みを待つので、これより大きいワークスペースで起動が重くなってきたら、ノードごとの索引（本文を読まず、見出しの情報だけを先に読むキャッシュ）を持つ。いまは持たない。

**試して採らなかったもの: 読み取りのキャッシュ。** ファイルの大きさと更新時刻（mtime・ctime）が前回と同じなら、前回の中身を使う方式を試した。`stat` だけの確認は 2,000 ファイルで約 50 ms（全部読むと約 400 ms）と速いが、中身をどこかに控えておく必要があり、その読み込みが残る。2,000 ノードでの読み込みは、本文なし・約 1 KB で約 300 ms → 約 200 ms、約 9 KB では 430〜560 ms → 410〜460 ms にとどまった。控えのファイル（本文の写し、7〜17 MB）と、古い中身を返さないための配慮（ctime の照合、更新直後のファイルは覚えない）に見合わないので入れていない。これ以上速くするなら、本文を起動時に読まない（見出しの情報だけを索引として持ち、本文は選んだときに読む）作りに変える必要がある。

## 4. 保存

編集 1 回の仕事は、ワークスペースの大きさではなく変えたノードの数で決まるようにする。

- 編集はコマンド（差分）として送る。ツリー全体を送り直さない
- main process はコマンドをワークスペースごとに直列に適用し、**変わったノードのファイルだけ**を一時ファイル経由で置き換える（ほかに、元に戻す履歴の 1 段を 1 ファイル書く）。ワークスペース全体は書き直さない
- どのノードが変わったかは、適用前後のグラフをオブジェクトの同一性で比べて見つける。エンジンは変わらないノードを前のグラフと共有するので、この比較はノード数に依らず軽い
- エンジン（`workspace-graph-engine.js`）はグラフ全体を複製しない。ノードの表だけを浅く写し、書き換えるノードはその直前に複製する。入力のグラフは書き換えない
- 親子関係を変えない操作（名前・状態・日付・本文・タグの変更、ノードの追加）は、変えたノードだけを検証する。親子関係を変える操作だけが全体の到達可能性を確かめる
- 結果と他のウィンドウへの通知は、グラフ全体ではなく**変わったノードだけ**（差分）。画面は持っているグラフにそれを当てる。間の更新を取りこぼしたときだけ、全体を読み直す
- 結果は要求元のウィンドウには戻り値だけで返し、ほかのウィンドウにだけ通知する。renderer のストアは、同じ版を受け取っても購読者へ通知しない（通知するとツリーの射影を丸ごと作り直す）
- 画像・添付は別ファイルとして保存し、ノードのファイルには参照だけを書く
- renderer は保存の完了を待たずに次の操作を受け付け、保存状態は `saveStatus` で示す

計測値（参考。同じ開発用コンテナ）:

| 条件 | main での 1 回の処理（p50） |
| --- | ---: |
| 2,000 ノードで 1 ノードの名前を変える | 約 5 ms |
| 2,000 ノードで元に戻す / やり直す | 約 12 ms |
| 5,000 ノードで 1 ノードの名前を変える | 約 11 ms |

画面の操作から表示までの通しでは、本文付き 2,000 ノードでの名前の変更が、ワークスペース全体を 1 つの JSON に書き直していた方式の約 280 ms から、約 55 ms になった。

## 6. 編集・スクロール・フィルタ時の再計算

読み込みだけでなく、編集・スクロール・フィルタのたびに走る再計算も、ツリー規模に対して無駄に重くしない。

- スクロール時の sticky パンくず（`buildStickyTrail`）は、可視行の id→row マップを毎フレーム作り直さない。`TreeTable.svelte` は `rows` でメモ化したマップを引数で渡し、行高もスクロール毎に `getComputedStyle` で取り直さない（テーマ変更時のみ更新する）。スクロール毎のコストは、先頭可視行から祖先を辿る木の深さぶんに限定する。
- 他ウィンドウへの同期は main process が保存後の差分（変わったノード）を broadcast するだけで、renderer 側で差分を計算しない。
- ツリーの射影（`tree_projection.js`）はノードの本文・添付・タグを複製せず、グラフの値をそのまま渡す（下流では書き換えない）。
- ツリーとガントはどちらも、見えている範囲の行だけを描く（`virtual_rows.ts`）。描かない行は同じ高さの空白で置き換え、スクロールの長さと各行の位置を保つ。ガントではドラッグ中の行を常に描く。
- 絞り込み欄は打鍵ごとではなく、入力が 120ms 止まってから反映する。確定・削除・入力欄から離れたときはすぐ反映する。
- 表示用ツリー（`filtered`）はツリーグリッドのアプリケーションがグラフ・フィルタ条件・ソート・アーカイブ表示から派生させる。保存経路から再フィルタを発火させない。

## 7. 守るべき境界

性能を保つため、次の境界を維持する。

- 起動経路から `MarkdownMemo.svelte` / `QuillMemo.svelte` / `highlight.js` を直接 import しない
- 編集のたびにグラフ全体を IPC で送らない（コマンドを送り、差分を受け取る）
- 編集のたびにワークスペース全体を書き直さない（変えたノードのファイルだけを書く）
- エンジンで入力のグラフを書き換えない、全体を複製しない（書き換えるノードだけ複製する）
- ツリー・ガントで全行を DOM に出さない
- 画像・添付の中身をノードのファイルに入れない

## 8. 検証

性能関連の変更では、少なくとも次を確認する。

- `npm run check`
- `npm run build`
- `npm test`

加えて、production build 後の `renderer/index.html` で起動時に preload される module 数を確認する。
メモエディタ関連 chunk が初期 modulepreload に戻っている場合は、起動経路への eager import が再発している可能性が高い。

## 9. 再現可能な性能計測

計測は、画面全体のE2E時間、Electron内部のmilestone、Workspace filesystem I/Oを分けて行う。これにより、画面が遅い場合にrenderer、IPC、Workspace I/Oのどこで待っているかを切り分けられる。

### 9.1 画面全体のE2E時間

production build を対象に、起動、タスク詳細ウィンドウ、画像ウィンドウを同じ条件で計測する。

```powershell
npm run build
npm run measure:performance
```

`measure:performance` は一時ディレクトリに計測用のワークスペースを作り、次の時間を計測する。出力には後方互換用の中央値、各サンプルに加えて、p50 / p95 / max の集計が含まれる。既存のユーザーデータは使用しない。

- `startupInteractiveMs`: Electron の起動開始から、保存済みプロジェクトが操作可能になるまで
- `detailInteractiveMs`: 別ウィンドウを要求してから、タスク詳細が表示されるまで
- `addNodeMs`: ツールバーのノード追加から、新しい行が表示されるまで（編集 1 回の重さの目安）
- `imageFirstOpenMs`: セッション内で最初の画像ウィンドウが読み込みを終えるまで
- `imageReopenMs`: 同じセッション内で画像ウィンドウを再度開き、読み込みを終えるまで
- `renderer`: DOMContentLoaded、load、First Contentful Paint、Svelte mount の各ブラウザ計測値
- `detailRenderer`: 詳細ウィンドウのDOMContentLoaded、load、First Contentful Paint、task data取得完了の各ブラウザ計測値

サンプル数を変える場合は `PERF_SAMPLES` 環境変数を設定する。OneDriveの一時的な遅延を評価する場合は20回以上を推奨する。

大きいワークスペースでの重さを測るときは `PERF_NODES` でノード数を指定する（既定は 3 ノード）。性能に関わる変更では、`PERF_NODES=2000` でも前後を比べる。

```powershell
$env:PERF_SAMPLES="20"
npm run measure:performance
```

### 9.2 Electron内部のmilestone

`TASK_MANAGE_PERF=1` でアプリを起動すると、計測値を最大500サンプルまでメモリ内に保持し、終了時に `[perf-summary]` ログとして p50 / p95 / max を出力する。計測を有効にしない通常起動では、Workspace I/Oのタイマーとサンプル保持は行わない。

```powershell
$env:TASK_MANAGE_PERF="1"
npm start
```

起動のmilestoneは次の順序で記録する。

| Metric | Start | End |
| --- | --- | --- |
| `startup.processToAppReady` | Electron process start | `app` ready |
| `startup.appReadyToBrowserWindow` | `app` ready | main `BrowserWindow`生成 |
| `startup.processToDomReady` | Electron process start | main window `dom-ready` |
| `startup.processToLoadFinished` | Electron process start | main window `did-finish-load` |
| `startup.processToInitialWorkspaceVisible` | Electron process start | 初期Workspace選択後のDOM反映 |

詳細ウィンドウは、クリック時刻、main processでの要求受信、`BrowserWindow`生成、DOM ready、task data取得、interactiveを同じrun IDで関連付ける。既存ウィンドウを再利用した場合は `detail.requestToExistingWindowFocus` として別に記録する。

### 9.3 Workspace I/O

`perf:workspace` は指定した保存場所の直下に一時Workspaceを作成し、終了時にその一時ディレクトリだけを削除する。既存Workspaceは読み書きしない。`--root` を省略した場合はOSの一時ディレクトリを使用する。

```powershell
npm run perf:workspace -- --root "C:\path\inside\OneDrive" --iterations 20 --projects 8 --tasks 30
```

所要時間とevent-loop delayを別々に集計する。対象はグラフの読み込み・コマンド実行・Undo・Redo である（`--projects` / `--tasks` はグラフのノード数を決める。一時Workspaceは Markdown ファイルとして作る）。最初の読み込み（ファイルを読む時間）はワークスペースを開く 1 回だけなので、ここではメモリ上のグラフを返す時間になる。event-loop delayは各処理中にheartbeatを継続し、その最大driftを1サンプルとして記録する。処理終了直前のblockingも最後のheartbeatで検出する。所要時間が長くてもevent-loop delayが低ければUIは応答を維持できるため、両方を比較する。

### 9.4 比較方法

変更前後で同じ保存場所、fixtureサイズ、サンプル数を使用する。平均値は一時的なOneDrive待ちを隠すため、判断にはp50 / p95 / maxと個別サンプルを用いる。OSキャッシュ、ウイルス対策、GPU process初期化の影響を避けるため、測定中は条件を揃える。

起動経路では、プロジェクト画面、クイックキャプチャ、タスク詳細画面を動的 import の境界として維持する。CodeMirror と Quill は日時ショートカットの登録だけでは読み込まず、対象エディタでショートカットが実行されたときに初めて読み込む。Lodash はパッケージ全体ではなく、使用する関数のサブパスから import する。
