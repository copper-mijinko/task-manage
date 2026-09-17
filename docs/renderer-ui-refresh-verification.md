# Renderer UI刷新：実装と検証記録

検証日: 2026-09-17。対象はTree Gridを中心とする既存ElectronアプリのRenderer刷新。
この記録のF01–F60は依頼仕様の機能ID、U01–U07は未確定事項IDに対応する。
実装済みであることと、全条件での手動検証が済んだことを区別する。

## 実装の境界

Node、親との配置関係、本文、添付の既存モデルを使用する。NavigationにNode Treeや新しいViewを追加しない。
Workspaceの更新・履歴・配置変更は既存TreeGrid applicationとGraph commandへ接続する。
旧Projectの保存・Inbox / Agenda専用画面の既存分岐も保持する。

| UIの状態・操作 | 保持場所または既存処理への対応 |
| --- | --- |
| 概要・添付・本文Tab、編集モード、Menu開閉 | Component内のView state。Nodeには保存しない |
| 本文の保存失敗時の下書き | Renderer内の一時Map。再訪時に回復し、成功時に破棄する。クラッシュ復旧用の永続データではない |
| 列幅・列順・列表示、Pane、Density | 既存設定Storeと保存キー |
| 親Linkからの移動 | 既存Scope・選択経路・展開状態・Navigation history |
| 本文、添付、配置、Archive、コピー | 既存Domain command / 保存API |
| Theme | 既存Theme定義とStoreへSemantic Tokenを追加 |
| 倍率 | trusted senderを検証する限定的なwindow:zoom IPC。Electronの既存zoom APIを使用 |

本文は初回の本文Tab訪問までEditorを生成せず、Tab間では保持する。Nodeまたは本文形式が変わると再生成する。
保存先IDをEditor生成時に固定し、選択変更後の遅延保存が別Nodeへ入る問題を防ぐ。
形式変換・編集終了・Tab移動前にflushし、失敗時はその操作を止める。
保存要求の受付とディスク保存完了は同一視しない。

WindowsのGraph保存では、一時的なEPERMでUndo / Redoが失敗する問題を実Electronで確認した。
独自の再試行層は追加せず、既存atomicWriteFileを使用して一時ファイルの書込み・rename再試行・後始末を共通化した。

実画面で追加検証した結果、Ganttの行高がTree Gridとずれる問題と、Graphの別WindowでTheme設定が初期化されない問題も修正した。
Ganttと固定祖先行は共通の行高Tokenを使用し、別WindowはTheme・Density・日時表示設定を初期化する。
名前編集ではIME確定中のEnterを保存確定として扱わない。狭い日付セルは折り返さず省略表示し、titleで日付を確認できる。

## 機能対応表

「保持」は既存操作経路を残したことを示す。下表だけで全組合せの回帰成功を意味しない。

| ID | 機能 | 今回の対応 |
| --- | --- | --- |
| F01–02 | 追加・名前編集 | Tree操作とDetail編集を保持。通常Detailは閲覧表示 |
| F03–04 | 単一・複数選択 | 既存IDとoccurrence path、Bulk操作を保持 |
| F05–06 | 展開・全展開 | 経路ごとの展開と表示Menuを保持 |
| F07–10 | 順序・Indent・D&D・配置 | Drop後に移動／子孫もコピーを選択。Detail…から移動・Detachへ到達 |
| F11–12 | 親編集・親遷移 | 「所属する場所」、追加、項目…、親Link。Scope外を展開し、Filter解除は明示操作 |
| F13 | Related | 新設しない。既存本文Wiki Linkは独立したRelatedモデルではない |
| F14–16 | Archive・復元・完全削除 | Detail…とTree操作。Graphの履歴による復元可能範囲を確認文へ反映 |
| F17 | Undo / Redo | 既存Node履歴とEditor履歴を保持。EditorにGUI操作を追加 |
| F18–19 | コピー・貼付・範囲 | 既存3種類と循環保護を保持。rootのMenu条件をShortcutと統一 |
| F20 | Bulk属性 | 既存batch commandを使用 |
| F21–24 | 検索・Filter・Sort | 検索欄のタグモード、全列共通の条件表示・解除、添付数Sortを追加 |
| F25–28 | 列表示・順序・幅・保存 | Toolbar「列の設定」IconButtonへ集約。幅入力、既存設定復元。Escapeで選択を解除しない |
| F29–31 | Project・Navigation | Sidebarは画面へ重なるスライド表示。Project…に上下移動・削除を追加 |
| F32–33 | Workspace管理・移行 | 既存管理Dialogと保存方針を保持 |
| F34 | 戻る・進む | occurrence pathを復元し、旧Project読込みによるGraph選択解除を防止 |
| F35–38 | タグ・Status・日付 | 概要は未設定値も表示。編集前後で項目位置を維持。Tree日付は継承表示を保持 |
| F39–40 | 添付 | 専用Tab、追加・Drop・削除・開く・openWith。Archiveでは更新不可 |
| F41–45 | 本文・Markdown・表・Quill | 専用Tabから直接表示モードを選択。MarkdownはPreview / Edit / Split、QuillはPreview / Edit。既存表示要素とDeltaを保持 |
| F46–47 | 形式変換・一括変換 | 確認・flush後に変換。一括は共有Nodeを重複計上せず、成功・失敗を正しく集計 |
| F48–49 | 保存・失敗・競合 | 保存GUI、flush、失敗下書き保持、既存Conflict解決UIを保持 |
| F50–51 | Pane・別Window | 既存Split、表示切替、別Windowを保持。詳細Titleを小さくし、冗長な最大幅・高さ制限を除去 |
| F52 | Theme・Density | HeaderにTheme色。標準は角丸16pxと余白、Compactは角丸・外余白なし。行高36px / 32px |
| F53–54 | 日時挿入・Window・倍率 | Editorに日時GUI、設定に倍率GUI。既存Window操作を保持 |
| F55 | Inbox / Capture | Headerから到達、追加・追加して閉じるButton。Graphの正規Inboxへ保存 |
| F56 | 旧専用画面 | 既存条件分岐を保持し、新たな再接続はしない |
| F57–58 | Gantt・Folder | 既存Ganttと保存方式別Folder操作を保持 |
| F59–60 | Overlay・Editor command | Escape伝播停止、Focus復帰、Menu矢印操作、下記GUI入口を追加 |

## ShortcutとGUI入口

Markdownの太字・斜体・Link・表操作は既存Toolbarを使用する。
追加したGUI入口はUndo / Redo、検索・置換、全選択、Indent / Outdent、日時挿入、画像挿入、Hard break、表の前後セル移動。
QuillにはUndo / Redo、全選択、日時挿入を追加し、既存書式・表Toolbarを維持する。
Captureの確定、Project上下移動、列幅変更、倍率変更もButtonから操作できる。
Editorライブラリ標準のカーソル移動・選択拡張・補完・文字削除には個別のアプリMenuを設けていない。
従って「ライブラリ内蔵keymapの全コマンドにも個別GUIがある」とは主張しない。

## 自動検証

| 検証 | コマンドと結果 |
| --- | --- |
| Unit / Component全体 | `npx vitest run tests/unit tests/component --maxWorkers=2`：73 files、867成功、7 skip |
| 最終修正の関連回帰 | TaskDetail / TaskAttachments / MenuList / SearchBox / TaskMenu / workspace-graph-engine / search：7 files、59成功 |
| 名前編集のIME回帰 | `npx vitest run tests/component/TaskName.test.js --maxWorkers=2`：11成功 |
| 型・Svelte診断 | `npm run check`：0 errors / 0 warnings |
| 配布用build | `npm run build`：成功。chunk size等の既存build警告あり |
| Electron全体回帰 | `npx playwright test tests/e2e/app.smoke.spec.js tests/e2e/tags.spec.js tests/e2e/workspace-treegrid.spec.js`：最終実行28例すべて成功 |
| Electron追加回帰 | 上記28例に、Sidebar表示時の幅維持、戻る／進むの選択復元、概要項目の位置維持、Dropコピー元の保全・独立編集を含む |
| Lint / 整形 | `npm run lint`および今回変更した追跡対象ファイルのPrettier check成功 |

全体テストの初回はEditorの遅延import待ちで1例がタイムアウトした。並列数を2に制限した再実行では成功した。
Electron追加テストは制限環境で起動が完了せず、実Electronプロセスを起動できる実行環境で再実行して成功した。
行高変更前の固定座標を使っていたD&Dテストは行下端からの相対座標へ修正し、最終全体再実行で成功した。

主な回帰の証拠:

- 本文保存失敗→アンマウント→再訪→再試行、Quill失敗中の外部更新による入力上書き防止。
- Node即時切替で保存先が変わらないこと、終了flush後のディスク内容と再起動。
- 形式変換直前の入力、変換後のQuill保存、別occurrenceからの再読込み。
- MermaidのSVGが描画範囲を包含し、Theme切替・再生成後もCodeの文字列が二重escapeされないこと。
- Graph一時EPERM再試行で履歴を二重作成しないこと。
- Modal / 列PopupのEscape、共有Node・循環・Move / Detach、添付Undo / Redo / 再起動。
- 一括変換対象の重複排除、dispatch成功・false・例外の結果表示。
- GanttとTree Gridの行位置が両Densityで一致し、期間作成・移動・両端編集がGraphへ保存されること。
- Graphファイルのrevisionを外部変更した際に本文入力が残り、再試行後も外部変更した別Nodeが保持されること。
- 別WindowのLight / DarkおよびDensity同期、IME確定中Enterの保護。
- Semantic Tokenのcontrast、既存タグ・Status・日付・列・Scope・保護条件のUnit / Component回帰。

## 実Electronの対話検証

`npm run dev:agent`で起動した実BrowserWindowに、`task_manage_ui` MCPからCDP接続した。
`verify:agent-ui -- --wait=30000 --json`でvite、cdp、electron、preloadすべてreadyを確認した。
通常Browserによる代用はしていない。データは専用fixtureを使用した。

- 共有Nodeの改名、親Linkと戻る、概要・添付・本文Tab、Markdown / Quill編集・保存を操作した。
- 本文形式変換後に編集・Tab切替し、本文が保持されることを確認した。
- 添付の追加、Undo / Redo、列幅入力、Captureの両Button、倍率110%と100%復帰を確認した。
- Settings / 列PopupのEscape後に背後の選択が残り、triggerへFocusが戻ることを確認した。
- 一括変換は共有Nodeが2箇所にあっても1件として扱われ、完了件数・OK表示が一致した。
- Light / Dark、標準 / Compact、1280 / 900pxの画面を操作し、Screenshotを確認した。改訂後のSidebarはOverlayで、開閉前後のTree位置・幅は変化しない。倍率100%で画面全体を使用する。
- 添付ButtonとファイルDropからそれぞれ画像を追加し、添付件数と表示を確認した。添付数Sort、添付数とタグの共通条件表示、条件の個別解除を操作した。
- Drop後の「子孫もコピー」で独立したコピーが追加され、Undoで元に戻ることを確認した。「移動」では別の親へ配置されることを確認した。
- 標準はツリーと詳細を角丸・薄い影のあるカードとして表示し、外周とカード間に16pxの余白を確保する。Lightの1280px、Darkの900pxで余白と表示を確認し、境界のドラッグ操作も確認した。Compactでは外余白・カード間余白・角丸・影がなくなることを確認した。
- Theme色のHeader、小さくした詳細Title、未設定項目、編集前後の項目位置を確認した。
- 本文Code・表・Checklist・Mermaid、Popupの収まり、日付セルの省略表示をScreenshotで確認した。
- Ganttの表示・非表示、日／週／月スケール切替、期間作成・移動・開始端・終了端のドラッグとディスク保存を確認した。
- 別Windowを開き、メインWindowからLight / Dark・Densityを切り替え、追従を確認した。
- Workspace Graphおよびアプリ内ProjectのMarkdown画像挿入Menuから実ファイルを選択し、画像読込みとプレビュー表示を確認した。
- 実Graphファイルのrevisionと別Nodeの名前を変更して競合を再現し、本文の保持・再試行・外部変更の保全を確認した。
- 名前入力へcompositionイベントを送り、IME確定中のEnterでは編集を継続し、次のEnterで確定することを確認した。これは実OS IMEの候補ウィンドウ操作とは区別する。
- 最後の操作後に新しいconsole errorがないことを確認した。

## 未確定事項と検証限界

| ID | 結論・残る確認 |
| --- | --- |
| U01 | Related Domainは追加しない。独立したRelated編集UIは確認できていない |
| U02 | 旧Inbox / Agenda条件分岐を保持。Workspace GraphのNavigationへ専用画面を再接続しない |
| U03 | Graphの完全削除は履歴が残る間の復元可能性を表示。旧保存方式の不可逆説明と区別 |
| U04 | Graph一括変換はatomic batch。成功・全体失敗・例外を検証。旧Projectの部分的な変換例外の手動再現は未実施 |
| U05 | root・Inbox・最後の親・Archive保護は既存engineとUI条件を使用。すべての混在選択を手動で網羅したわけではない |
| U06 | Escape伝播・Focus復帰を修正し自動・手動確認。Editor標準keymapの個別GUI化の境界は上記参照 |
| U07 | 再起動・別Window・Theme・保存失敗の自動回帰に加え、実ファイルの外部変更によるrevision競合を対話検証済み |

OSのopenWithは未検証として残る。起動処理はWindowsのOpenWith.exeへファイルパスを独立した引数として渡す方式に変更し、実Electronを再起動した。添付Menuの呼出しでRendererエラーは出ていないが、OSの選択画面と外部アプリ表示の成功は確認できていない。PRではこの制限を明記する。
Windows画面取得はGetCursorPosのアクセス拒否（0x80070005）、CreateForMonitor失敗（0x80070057）で停止した。Windowsへログインし、ロックを解除してデスクトップを表示した状態で、添付Menuからアプリ選択・外部表示を再検証する必要がある。プロセス起動やRenderer側の成功だけでは、この条件を満たしたと扱わない。
画像はWorkspace Graphとアプリ内ProjectのGUI入口を対話検証し、旧Workspace保存方式は既存Component回帰を使用した。OS IMEの全候補確定経路、旧Projectの部分変換例外、保護条件の全混在組合せを手動で網羅したとは扱わない。
失敗下書きはRenderer生存中の回復用であり、強制終了・クラッシュを跨ぐ永続的な復旧は保証しない。
本記録は対話検証と自動回帰を組み合わせた検証結果であり、全項目を手動で総当たりしたという記録ではない。
