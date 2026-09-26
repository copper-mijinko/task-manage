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
- ワークスペースのグラフは renderer が要求したときに初めて読む（`ws:read-graph`）。ファイル監視は持たない

## 3. ワークスペースの読み込み

ワークスペースの正本は `graph-v1.json` 1 ファイルなので、読み込みは 1 回の非同期読み取りと JSON の parse で済む。
ノードの本文もグラフに含まれるため、ノードを選ぶたびの追加 IPC はない。

- main process はワークスペースごとに読んだグラフをメモリに保持し、ファイルの更新時刻と大きさが変わらない限り読み直さない
- 旧 Markdown 形式からの取り込みは、初回の自動取り込みか、ユーザーが選んだときだけ行う

## 4. 保存

- 編集はコマンド（差分）として送る。ツリー全体を送り直さない
- main process はコマンドをワークスペースごとに直列に適用し、`graph-v1.json` を一時ファイル経由で置き換える
- 画像・添付は別ファイルとして保存し、グラフには参照だけを書く
- renderer は保存の完了を待たずに次の操作を受け付け、保存状態は `saveStatus` で示す

## 6. 編集・スクロール・フィルタ時の再計算

読み込みだけでなく、編集・スクロール・フィルタのたびに走る再計算も、ツリー規模に対して無駄に重くしない。

- スクロール時の sticky パンくず（`buildStickyTrail`）は、可視行の id→row マップを毎フレーム作り直さない。`TreeTable.svelte` は `rows` でメモ化したマップを引数で渡し、行高もスクロール毎に `getComputedStyle` で取り直さない（テーマ変更時のみ更新する）。スクロール毎のコストは、先頭可視行から祖先を辿る木の深さぶんに限定する。
- 他ウィンドウへの同期は main process が保存後のグラフを broadcast するだけで、renderer 側で差分を計算しない。
- 表示用ツリー（`filtered`）はツリーグリッドのアプリケーションがグラフ・フィルタ条件・ソート・アーカイブ表示から派生させる。保存経路から再フィルタを発火させない。

## 7. 守るべき境界

性能を保つため、次の境界を維持する。

- 起動経路から `MarkdownMemo.svelte` / `QuillMemo.svelte` / `highlight.js` を直接 import しない
- 編集のたびにグラフ全体を IPC で送らない（コマンドだけを送る）
- 画像・添付の中身をグラフに入れない

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
- `imageFirstOpenMs`: セッション内で最初の画像ウィンドウが読み込みを終えるまで
- `imageReopenMs`: 同じセッション内で画像ウィンドウを再度開き、読み込みを終えるまで
- `renderer`: DOMContentLoaded、load、First Contentful Paint、Svelte mount の各ブラウザ計測値
- `detailRenderer`: 詳細ウィンドウのDOMContentLoaded、load、First Contentful Paint、task data取得完了の各ブラウザ計測値

サンプル数を変える場合は `PERF_SAMPLES` 環境変数を設定する。OneDriveの一時的な遅延を評価する場合は20回以上を推奨する。

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

所要時間とevent-loop delayを別々に集計する。対象はグラフの読み込み・コマンド実行・Undo・Redo である（`--projects` / `--tasks` はグラフのノード数を決める）。event-loop delayは各処理中にheartbeatを継続し、その最大driftを1サンプルとして記録する。処理終了直前のblockingも最後のheartbeatで検出する。所要時間が長くてもevent-loop delayが低ければUIは応答を維持できるため、両方を比較する。

### 9.4 比較方法

変更前後で同じ保存場所、fixtureサイズ、サンプル数を使用する。平均値は一時的なOneDrive待ちを隠すため、判断にはp50 / p95 / maxと個別サンプルを用いる。OSキャッシュ、ウイルス対策、GPU process初期化の影響を避けるため、測定中は条件を揃える。

起動経路では、プロジェクト画面、クイックキャプチャ、タスク詳細画面を動的 import の境界として維持する。CodeMirror と Quill は日時ショートカットの登録だけでは読み込まず、対象エディタでショートカットが実行されたときに初めて読み込む。Lodash はパッケージ全体ではなく、使用する関数のサブパスから import する。
