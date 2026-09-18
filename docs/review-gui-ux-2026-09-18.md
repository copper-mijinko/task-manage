# GUI / UX 点検 (2026-09-18)

## 対象と方法

`claude/gui-ux-design-review-tuck9z` 時点の renderer を対象に、実 Electron
`BrowserWindow` (CDP `127.0.0.1:9222`) へ Playwright を接続して確認した。ソース
読解だけの指摘は含めず、すべて実行中のレンダラー上で再現・計測している。

判断基準として次の原則を用いた。

- **Nielsen のユーザビリティ 10 原則**（以下 N1〜N10）
- **WCAG 2.2**（達成基準番号で記載）
- **WAI-ARIA Authoring Practices (APG)** の `treegrid` / `menu` パターン
- **Fitts の法則**（ターゲット寸法と到達コスト）
- **Material Design 3** — `public/global.css` が自ら「M3-aligned」と宣言しており、
  そのトークン体系に対する内部整合性を基準にした

P1 は「ユーザーが機能を失う／誤った状態を信じさせられる」問題、P2 は
「操作効率・アクセシビリティ・一貫性の問題」とする。

---

## P1

### 1. 「戻る」「進む」が機能せず、かつ状態表示が誤っている

`src/stores/navigation_history.ts` / `src/features/navigation/components/Header.svelte:170-215`

実測（実 Electron、リロード直後）:

| 操作 | 表示中のページ | 戻るボタン | 進むボタン |
| --- | --- | --- | --- |
| 起動直後（未遷移） | `ws-demo` | **有効** | 無効 |
| Inbox へ遷移 | `Inbox` | 有効 | 無効 |
| 「戻る」をクリック | **`Inbox` のまま** | 有効 | **無効のまま** |

- 一度も遷移していない起動直後から「戻る」が有効になっている。
- 遷移後に「戻る」を押してもページが戻らず、「進む」も有効化されない。

`canGoBack` は `index > 0` で導出されるため、初期化時に積まれるエントリの持ち方と
`navigateTo()` の着地判定が噛み合っていない。ブラウザ風の戻る/進むは N3（ユーザーの
自由と離脱口）そのものの UI であり、それが無反応かつ「押せます」と表示している状態は
N1（システム状態の可視性）の違反でもある。

### 2. ウィンドウ幅 820px 未満で、ウィンドウ操作ボタンが画面外に出る

`src/features/navigation/components/Header.svelte:436-505` / `electron/window-state.js:16`

ウィンドウは `frame: false`（`electron/index.js:277`）で、最小化・最大化・閉じるは
ヘッダー右端の自前ボタンだけが提供する。そのヘッダーが幅に応じて縮まない。

実測（`Emulation.setDeviceMetricsOverride`、右端座標はビューポート幅との比較）:

| ウィンドウ幅 | 設定 | 最小化 | 最大化 | 閉じる |
| --- | --- | --- | --- | --- |
| 900px | 可視 | 可視 | 可視 | 可視 |
| 760px | 可視 | 可視 | **right=787（画面外）** | **right=817（画面外）** |
| 700px（`minWidth`） | **right=711（画面外）** | **right=757** | **right=787** | **right=817** |

`minWidth: 700` なので、この幅はユーザーが普通にリサイズして到達できる。ヘッダーは
`overflow` がスクロールしないため、はみ出したボタンは取り戻せない。**アプリを閉じる
手段が UI から消える**。N3 と N5（エラーの防止）の違反。

なお `Header.svelte:882` の `@media (max-width: 700px)` が唯一の折り返し規則だが、
`minWidth` が 700 のため実質 1px 幅のバンドでしか発火せず、緩和策として機能していない。

### 3. Inbox / 予定ボタンの選択状態が、永久に「未選択」を返す

`src/features/navigation/components/Header.svelte:307, 341`

```svelte
class:Active={$selected_type === "Inbox"}
aria-pressed={$selected_type === "Inbox"}
```

しかしクリックハンドラ（同 118-127 行）は `selected_type` に `"WorkspaceProject"`
を代入し、識別はセンチネル `selected_id` 側で行う。`selected_type` に `"Inbox"` /
`"Agenda"` を代入する箇所はソース全体に存在しない。

実測（Inbox ビューを開いた状態）:

```
ON INBOX VIEW: {"heading":"Inbox Workspace","pressed":"false","hasActive":false}
```

トグルボタンが自分の状態を常に false と報告する。N1 の違反であり、`aria-pressed` が
実態と食い違うため WCAG 4.1.2 (Name, Role, Value) にも抵触する。

### 4. `html { font-size: 75% }` がデザイントークン体系とユーザー設定の両方を壊している

`src/App.svelte:650`、`src/TaskDetailApp.svelte:294`

実測: `getComputedStyle(document.documentElement).fontSize === "12px"`。

影響は 2 つある。

**(a) px トークンと rem 指定が別スケールで乖離している。**
`global.css` の `--sp*` / `--font-*` / `--col-min-*` は px 固定なので等倍のまま、
コンポーネント側の `rem` 指定だけが 0.75 倍される。設計意図と実寸が全面的にずれる:

| 指定 | 意図 | 実測 |
| --- | --- | --- |
| `.InboxBtn { width: 1.75rem }` | 28px | **21px** |
| `.ExpandButton { width: 1rem }` | 16px | **12px** |
| `--card-header-min-h: 2.25rem` | 36px | 27px |
| `aside.Sidebar { width: 18rem }` | 288px | 216px |

`global.css` のコメントは「`--card-header-min-h: 2rem` を IconButton の 2rem に合わせる」
のように rem を実 px として説明しており、前提が成立していない。M3 の 4pt グリッドを
標榜する以上、この二重スケールは土台の不整合にあたる。

**(b) ユーザーのフォントサイズ設定を無効化している。**
ルート font-size を固定比率で縮めるため、OS / Chromium 側で既定フォントを大きくして
いる利用者の設定が 25% 縮小される。WCAG 1.4.4 (Resize Text) の趣旨に反する。

---

## P2

### 5. クリックターゲットが広範に 24px 未満（実測 39 箇所）

WCAG 2.2 SC 2.5.8 (Target Size, Minimum) は 24×24 CSS px を最低線とする。実測での
主な違反:

| 要素 | 実測 |
| --- | --- |
| 行の展開／折りたたみ `.ExpandButton` | **12 × 12** |
| 全選択チェックボックス `.HeaderCheckbox` | **11 × 11** |
| 列ソートボタン（6 列分） | 18 × 18 |
| 列フィルターボタン（6 列分） | 高さ 15 |
| 戻る／進む／Inbox／設定 | 21 × 21 |
| 行メニュー `.menu-button` | 21 × 21 |
| ステータス／日付セル | 高さ 23 |
| ペイン分割ハンドル `.Resizer` | 幅 **5** |

ツリー UI で最も反復操作される展開トグルが 12px 角なのは、Fitts の法則上もっとも
コストの高い配置になっている。原因の多くは P1-4 の 0.75 倍縮小である。

### 6. treegrid の roving tabindex が行内の子要素に破られ、文書全体で 90 タブストップ

`src/features/tasks/components/TreeTableRow.svelte`

行 (`role="row"`) 自体は `tabindex="-1" / "0"` で roving tabindex を実装しているが、
行内の操作要素は素の `tabindex` のまま（実測）:

```
row1 tabindex=-1 children=[DIV:-1, BUTTON:null, INPUT:null, BUTTON:null, BUTTON:null, BUTTON:null, BUTTON:null]
```

結果、6 行しかない状態で文書内のタブストップが **90** ある。APG の treegrid は
「グリッド全体で 1 タブストップ、内部は矢印キー」を要求しており、行あたり 5〜6 個の
タブストップが残っているため roving tabindex が無効化されている。実データ規模では
ツリーを通過するだけで数百回の Tab が必要になる。

加えて、ツールバー 10 個 + 列ヘッダー 13 個の計 23 タブストップを越えないと
最初のデータ行に到達しない。

### 7. 確認ダイアログのボタンが英語のまま、破壊的操作にも既定スタイル

`src/lib/primitives/Dialog.svelte:9-10`

```ts
export let ok = "ok";
export let cancel = "cancel";
```

全 6 箇所の呼び出し（`MenuList.svelte:695,702` プロジェクト削除 /
`TaskDetail.svelte:946,953` / `TreeTable.svelte:1641` / `MainPage.svelte:1332`）が
この既定値をそのまま使っている。実測スクリーンショットでも、日本語の
「アーカイブの確認」ダイアログに **`cancel` / `ok`** が並ぶ。

さらに `MainPage.svelte` には英語のまま残った文字列がある:

- `1356`: `header="Alert."`
- `249`: `let alert_content = "Cannot delete the root node.";`

問題は 3 点。

1. 言語の不統一（N2: 現実世界との一致）。
2. ボタンラベルが動作を述べていない。破壊的確認は「アーカイブする」「完全に削除」と
   名詞化するのが定石で、`ok` は何が起きるか伝えない。
3. 完全削除を含む破壊的操作でも `ok` が `variant="filled"`（通常のプライマリ青）で、
   危険度が色に反映されない。N5（エラーの防止）。

また実測ではダイアログを開いた直後のフォーカスが**閉じる (×) ボタン**に当たる。
破壊的確認では安全側（キャンセル）かダイアログ本体に置くべき。

### 8. ホバー／選択状態が視覚的に no-op になっている

`src/features/navigation/components/Header.svelte:593-596, 731-741`

ヘッダーは `--hover-bg: rgba(255,255,255,0.14)` を定義し、それを**通常時の背景色**に
使っている。そのうえでホバー時にも同じ変数を指定している:

```css
.NavHistoryBtn        { background-color: var(--hover-bg); }
.NavHistoryBtn:hover:not(:disabled) { background-color: var(--hover-bg); }  /* 同値 */
.InboxBtn             { background-color: var(--hover-bg); }
.InboxBtn:hover       { background-color: var(--hover-bg); }                /* 同値 */
.InboxBtn.Active      { background-color: var(--hover-bg);
                        box-shadow: inset 0 0 0 1px var(--hover-bg); }      /* 背景と同色の内枠 */
.SearchField:focus-within { background-color: var(--hover-bg); }            /* 同値 */
```

実測で `.NavHistoryBtn` の背景が `rgba(255, 255, 255, 0.14)` = `--hover-bg` と一致する
ことを確認した。ホバーは border-color だけが変わり、`.Active` はホバーと区別できず、
内側 box-shadow は背景と同色のため不可視。検索欄のフォーカスも背景が変わらない。
N1 の違反。

### 9. ヘッダーで「muted」が「default」に潰され、プレースホルダーと入力値が同色

`src/features/navigation/components/Header.svelte:531-532`

```css
--fg-default: var(--on-theme-text);
--fg-muted:   var(--on-theme-text);   /* 同じ値 */
```

ヘッダー配下の 8 箇所（`.SearchInput::placeholder`、`.SearchCount`、`.SearchShortcut`、
`.SaveIndicator`、`.WinCtrlBtn` ほか）が `--fg-muted` を参照しているため、階層が消える。

実測:

```
input_color:       rgb(244, 247, 255)
placeholder_color: rgb(244, 247, 255)   ← 同一
```

**プレースホルダーと実入力値が同じ色で描かれる**ため、検索欄が空なのか
「画面内をハイライト検索…」と入力済みなのかを見分けられない。N1 の違反。

### 10. 対象が存在しなくてもアーカイブ・元に戻す・やり直しが有効

`src/pages/MainPage.svelte`

リロード直後（操作履歴ゼロ・選択ゼロ）の実測:

| ボタン | disabled |
| --- | --- |
| 上に移動 / 下に移動 / インデント / アウトデント | `true`（正しい） |
| **元に戻す** | `false` |
| **やり直し** | `false` |
| **アーカイブ** | `false` |

押しても何も起きず、フィードバックもない。同じツールバーの中で無効化ロジックの
基準が揃っていないため、ユーザーは「無効化＝実行不可」という手がかりを信頼できなく
なる。N5、および N4（一貫性と標準）。

### 11. オーバーフローメニューの ARIA 構造が不正、トグル項目に状態がない

`src/features/tasks/components/TaskMenu.svelte:142-153`

実測した構造:

```
UL role=menu
  └ LI role=null          ← menu の直接の子が menuitem でない
      └ BUTTON role=menuitem
```

`role="menu"` が所有できるのは `menuitem` / `menuitemradio` / `menuitemcheckbox` /
`group` / `separator` に限られる。間に role のない `li` が挟まるため所有関係が切れ、
支援技術への項目数の伝達が壊れる（WCAG 4.1.2）。

加えて、表示トグル 3 項目（「ガントチャートを表示」「詳細欄を隠す」
「アーカイブ済みを表示」）はすべて `role="menuitem"` で `aria-checked` を持たない。
視覚的にもチェックマークがなく、ラベルの動詞が反転するだけなので、現在どちらの状態か
をメニューから読み取れない。`menuitemcheckbox` + `aria-checked` が適切。

### 12. 行追加後にフォーカスが移らず、全行が「新しいノード」になる

`src/pages/MainPage.svelte:855-874`

実測:

```
focus before add: BUTTON aria=タスク追加
focus after  add: BUTTON aria=タスク追加   ← 変わらない
```

追加された行の名前は既定文字列「新しいノード」のまま、名前入力にフォーカスが入らない。
3 回押すと同名の行が 3 つ並び、サイドバーにも「新しいノード」が 4 件並ぶ状態を実測した。
アウトライナ／ツリー系 UI では「追加 → 即入力」が基本動線であり、毎回マウスに持ち替え
させている。N7（柔軟性と効率性）。

### 13. サイドバーがスクリム付きモーダルドロワーで、現在地の表示もない

`src/App.svelte:512, 687-705`

デスクトップアプリ（`minWidth` 700、既定 1280px）にもかかわらず、プロジェクト
ナビゲーションは `position: absolute` + 背面スクリムのオーバーレイになっている。
実測スクリーンショット（1280px 幅）では、幅 216px のサイドバーを開くだけで残り
1064px のツリーと詳細ペインが暗転して操作不能になる。

- ツリーを見ながらプロジェクトを切り替える、ツリーへドラッグする、といった操作ができない。
- 開いている間、リストのどの項目が現在表示中かを示すハイライトがない（Inbox と 4 つの
  ノードが同一の見た目）。

常時表示できる幅があるのに一時的オーバーレイを使うのはモバイルパターンの流用であり、
N6（記憶より認識）と N1 の両方に効いている。

### 14. 面（サーフェス）と整列の一貫性が崩れている

- **詳細ペインの空状態にだけ Card がない。** 実測で、空状態の `Pane` の背景は
  `rgba(0,0,0,0)` で、親 `.Content` の `rgb(217,222,225)` がそのまま見える。左のツリーは
  白い Card（枠線・角丸つき）なので、右半分だけ「抜けた穴」に見える。
- **列ヘッダーは中央揃え、セルは左揃え。** 実測で `[role="columnheader"]` は
  `justify-content: center`。タスク名列（x=37..410）ではヘッダー「タスク名」が x≈200 に
  中央寄せされる一方、セルのテキストは x≈85 から始まる。列見出しと内容の視覚的な
  対応（ゲシュタルトの近接）が切れ、幅の広い列ほどずれが大きい。
- **本文の編集アフォーダンスが形式で変わる。** `TaskDetail.svelte:890` で
  「編集／プレビュー」トグルは `bodyFormat !== "markdown"` のときだけ出る。

N4（一貫性と標準）。

### 15. 行番号列が選択行でチェックボックスに化け、序数が飛ぶ

`src/features/tasks/components/TreeTableRow.svelte`

実測した行テキスト（3 行目を選択中）:

```
row1 "1/—/—/—/—"
row2 "2/未着手/—/—/—"
row3 "—/—/—/—"        ← 番号が消えている
row4 "4/—/—/—/—"
row5 "5/—/—/—/—"
```

同じ列が状況によって「行番号」と「選択チェックボックス」の 2 つの意味を持つため、
選択中は連番が 2 → （空白）→ 4 と飛ぶ。番号を手がかりに行を指し示すことができない。
選択という主要機能がホバー／選択時にしか現れない点も、発見可能性の問題（N6）。

### 16. 保存モデルが二重に提示されている

`src/features/tasks/components/TaskDetail.svelte:900-908`

ヘッダーは常時「保存済み」インジケータ（自動保存）を出しているのに、詳細ペインには
フロッピーディスク図像の「今すぐ保存」ボタン（`memoEditor?.flush()`）がある。
自動保存を謳う UI に手動保存ボタンが併存すると、「押さないと保存されないのでは」と
いう疑いを生み、自動保存の信頼を毀損する。N1 と N4。

あわせて、詳細ペインの読み取り専用フィールドが `<label class="detail-field">` で
マークアップされている（実測）。対応するフォームコントロールを持たない `label` は
支援技術にとって無意味な関連付けになる。

---

## 良かった点

指摘の公平を期すために記録する。

- **文字コントラストは実測で違反ゼロ。** レンダリング後の合成色で全テキストノードを
  走査したが、WCAG AA (4.5:1 / 大文字 3:1) を下回るものは 0 件だった。
  `theme.ts` の `Primary.text` / `Error.text` / `Warning.text` のように「塗り用」と
  「文字用」を分けた設計が効いている。
- `@media (prefers-reduced-motion: reduce)` を全域で尊重している。
- `:focus-visible` のフォーカスリングが全体で統一されている。
- 行 (`role="row"`) 側の roving tabindex、`aria-level`、`aria-selected`、
  `role="treegrid"` など、ツリーのセマンティクスの骨格自体は入っている（6 を直せば
  活きる）。
- オーバーフローメニューには `role="separator"` によるグルーピングがある。

---

## 推奨する着手順

1. **P1-4（`font-size: 75%`）を最初に外す。** これは 5（ターゲット寸法）の大半と、
   トークン体系のコメントと実寸の乖離を同時に解消する。ただし全画面の寸法が変わるため、
   px トークン側の再調整とセットで行う必要がある。
2. **P1-2（ウィンドウ操作ボタンの消失）** — 機能喪失であり、修正は局所的。
3. **P1-1 / P1-3** — 状態表示の嘘を止める。
4. P2-7 のダイアログ文言、P2-8 / P2-9 の no-op な状態表現は、いずれも小さい変更で
   体感が大きく変わる。

なお本点検は視覚・操作・アクセシビリティの観点に限っており、Gantt、Finder、Graph
ビュー、メモエディタ（Quill / Markdown）、添付・画像まわりは今回の走査対象に含めて
いない。
