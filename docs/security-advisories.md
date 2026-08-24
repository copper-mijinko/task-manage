# セキュリティアドバイザリ トリアージ (2026-08-22 時点)

GitHub から届いた Dependabot 通知の内容を整理し、本アプリでの **該非** と **対処方法** を明記する。

## 調査方法と前提

Dependabot のアラート一覧そのものは API 経由で取得していない。GitHub Advisory DB と同一ソースである
`npm audit` を、コミット済みの `package-lock.json` に対して実行して再現した結果が以下である
(**25 件**: critical 1 / high 20 / moderate 3 / low 1)。

該非判定は次のアプリ構成に基づく。

| 前提 | 確認箇所 |
| --- | --- |
| ローカル Electron デスクトップアプリ。本番は `file://` で `renderer/index.html` を読み込む | `electron/index.js` の `loadFile` |
| SSR なし (Vite の SPA ビルド) | `vite.config.js` |
| カスタムプロトコル・カスタム session / partition を一切登録していない | `electron/*.js` に `protocol.*` / `fromPartition` なし |
| `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` (Electron 41 の既定値)。子ウィンドウは明示指定 | `electron/index.js` |
| アプリコードから外部への HTTP 通信を行わない | `fetch` / `net.request` の呼び出しなし |
| 扱うデータはすべてローカル (ユーザー自身のワークスペース) | `electron/workspace.js` |

**ただし 1 点だけ例外がある。** Markdown プレビューは `marked` の出力をサニタイズせずに
`{@html renderedHtml}` で描画している (`src/features/memos/components/MarkdownMemo.svelte:1919,1990`)。
`marked` は生 HTML を素通しするため、`<img onerror=...>` を含むメモを開けば renderer 内で任意の
JavaScript が動く。この 1 点が、後述の Electron 系・Svelte 系の判定を「非該当」から
「条件付き該当」に押し上げている。

## 該当 — 実行時に効くもの

### electron 41.2.1 (high / 5 件)

| Advisory | 内容 | 該非 |
| --- | --- | --- |
| GHSA-h7rp-cf8h-j98x | context isolation を `Function.prototype.bind` の乗っ取りで回避 (< 41.2.2) | **該当** |
| GHSA-ff2p-hmqr-hxm4 | `contextBridge` のオブジェクトコピーが prototype setter を尊重する (< 41.2.2) | **該当** |
| GHSA-9f4c-93c8-jc8g | sandbox 化した iframe が OpenURL 経由で `allow-popups` 制限を回避 (< 41.10.3) | 条件付き該当 |
| GHSA-v3j7-r9gq-3gjw | `supportFetchAPI` 有・`corsEnabled` 無のカスタムプロトコルで cross-origin 読み取り | 非該当 (カスタムプロトコル未登録) |
| GHSA-r4w5-6pfg-jxp5 | `ProtocolResponse.url` が既定 session のキャッシュを使う | 非該当 (同上) |

前 2 件は preload + `contextBridge` という本アプリの設計そのものを突くもので、renderer 内で任意 JS が
動くことが発火条件。上記の未サニタイズ `{@html}` がその経路になり得るため実質的に該当扱いとする。

**対処**: `electron` を `^41.10.6` へ更新 (同一メジャー内のパッチ更新)。

### mermaid 11.15.0 (moderate / 5 件)

prototype pollution 2 件 (GHSA-c4c3-pg64-4m4v / GHSA-3rrr-jr9j-h3q3)、CSS injection
(GHSA-6x64-9x62-f2gx)、XY チャートの無限ループ DoS (GHSA-2v8p-3f2j-5mp7)、radar 図の DoS
(GHSA-rhh3-jpg6-66xh)。

**該当。** メモ内の ` ```mermaid ` ブロックの中身をそのまま `mermaid.render(id, source)` に渡している
(`MarkdownMemo.svelte:1066`)。共有ワークスペースや他者から受け取った `.md` を開くと発火する。

**対処**: `mermaid` を `^11.16.1` 以上へ更新。

### dompurify 3.4.5 (moderate / 9 件)

**条件付き該当。** アプリは DOMPurify を直接呼んでおらず、`mermaid` の内部依存として入っている。
報告の大半は `IN_PLACE` モード固有で、その使い方をしていない限り非該当。mermaid を更新すれば
3.4.14 に追随するため、個別対応は不要。

### svelte 5.55.4 (moderate / 4 件)

devDependency だがコンパイル結果はバンドルに載るため実行時コードとして扱う。

| Advisory | 内容 | 該非 |
| --- | --- | --- |
| GHSA-rcqx-6q8c-2c42 | 内部状態の DOM Clobbering による XSS | 条件付き該当 (未サニタイズ HTML 描画が前提) |
| GHSA-f3cj-j4f6-wq85 | SSR の Promise シリアライズ経由の XSS | 非該当 (SSR 未使用) |
| GHSA-pr6f-5x2q-rwfp | SSR の spread 属性経由の XSS | 非該当 (同上) |
| GHSA-9rmh-mm8f-r9h6 | `<svelte:element>` のタグ検証で ReDoS | 非該当 (`<svelte:element>` 未使用) |

**対処**: `svelte` を `^5.56.10` へ更新。

## 非該当 — 対処不要 / 更新のみ

### quill 2.0.3 (low) — 非該当・修正版なし

GHSA-v3m3-f69x-jf25 は **HTML エクスポート機能 (`getSemanticHTML`) の XSS**。
`getSemanticHTML` はリポジトリ全体で使用していない。さらに npm 上の最新版が 2.0.3 (=脆弱版) であり
upstream に修正版が存在しない。`npm audit` が言う "fix" は 2.0.2 へのダウングレードである。

**対処**: 不要。このアラートは dismiss (Not affected) してよい。

### vite 8.0.8 (high / 2 件) — 開発時のみ

`server.fs.deny` の Windows 別名パス経由バイパス (GHSA-fx2h-pf6j-xcff) と launch-editor の
NTLMv2 ハッシュ漏洩 (GHSA-v6wh-96g9-6wx3)。どちらも `npm run dev` の dev サーバに対するもので、
配布物には含まれない。**対処**: `vite` を `^8.2.2` へ更新 (低コストなので実施推奨)。

### electron-builder 系 7 パッケージ (high) — ビルド時のみ・実体は 2 件

`electron-builder` / `app-builder-lib` / `builder-util` / `builder-util-runtime` / `dmg-builder` /
`electron-publish` / `electron-builder-squirrel-windows` は同一チェーンで、警告 7 件の実体は
アドバイザリ 2 件にすぎない。

- GHSA-7g7r-gx96-252g (AppImage の search path 制御不備): 本アプリのビルドは Windows NSIS のみ
  (`electron-builder -w`)。AppImage を生成しないため **非該当**。
- GHSA-p2f4-r6v6-j797 (cross-origin redirect で `PRIVATE-TOKEN` / `Authorization` が漏れる):
  `package.json` の `build.publish` が `null` で配信設定・認証トークンを使っていないため **非該当**。

**対処**: `electron-builder` を `^26.15.3` へ更新すればチェーンごと解消する。

### その他のビルド / 開発時依存 — すべて非該当

| パッケージ | 深刻度 | 経路 | 非該当の理由 |
| --- | --- | --- | --- |
| tar | critical | electron-builder / node-gyp | 扱うのは npm レジストリ由来のアーカイブのみ |
| extract-zip | high | electron のダウンロード展開 | electron 41.10.6 で `@electron-internal/extract-zip` に置換され消滅 |
| undici | high (12 件) | electron-builder / node-gyp | アプリの実行時 HTTP 経路に存在しない |
| postcss | high | vite / stylelint | 自プロジェクトの CSS のみを処理 |
| js-yaml | high | electron-builder | 自プロジェクトの設定ファイルのみ |
| brace-expansion | high | eslint / glob 等 | glob パターンの DoS。入力は自プロジェクトのパス |
| fast-uri | high | ajv (lint 系) | ビルド時のスキーマ検証のみ |
| form-data | high | node-gyp 系 | アプリからの multipart 送信なし |
| ip-address | high | socks (proxy 系) | プロキシ経由通信を行わない |
| tmp | high | electron-builder | ビルド時の一時ディレクトリのみ |
| nanoid | high | postcss | ビルド時の ID 生成のみ |
| devalue | high | vite / svelte ツールチェーン | SSR 未使用 |

## 対処手順 (適用済み・回帰テスト済み)

以下の更新をコミット済み。すべて同一メジャー内のマイナー / パッチ更新で、破壊的変更はない。

```bash
npm i -D electron@^41.10.6 electron-builder@^26.15.3 svelte@^5.56.10 vite@^8.2.2
npm i mermaid@^11.16.1
npm audit fix          # 残る dev 依存 (undici / js-yaml / fast-uri / brace-expansion / dompurify) を解消
```

解決されたバージョン: electron 41.10.6 / electron-builder 26.15.3 / svelte 5.56.10 /
vite 8.2.2 / mermaid 11.17.0 / dompurify 3.4.14 / undici 7.29.0 / js-yaml 4.3.1 /
fast-uri 3.1.5 / brace-expansion 5.0.9。**25 件 → 1 件** (非該当の quill のみ)。

### 回帰テスト結果

更新前にベースラインを取得し、更新後に同一項目を再実行して比較した。全テストスイートを実行している。

| スイート | ファイル | 定義 | 成功 | 失敗 | スキップ | 成功率 (実行分) |
| --- | --- | --- | --- | --- | --- | --- |
| `test:unit` | 21 | 343 | 343 | 0 | 0 | 343/343 = 100% |
| `test:component` | 19 | 156 | 149 | 0 | 7 | 149/149 = 100% |
| E2E (Playwright + Electron) | 2 | 13 | 13 | 0 | 0 | 13/13 = 100% |
| **合計** | **42** | **512** | **505** | **0** | **7** | **505/505 = 100%** |

定義済みテスト全体に対する成功率は 505/512 = **98.6%**。差の 7 件はスキップで、失敗は 0 件。

スキップ 7 件は `tests/component/App.test.js` の `describe.skip("App - save status indicator")`
ブロックで、コミット `52f9308` (Inbox 機能追加) 時点から存在する既存のスキップである。
セーブ状態インジケータが `Header.svelte` へ移動し、App テストでは Header をモックするため
無効化されたもので、今回の依存更新とは無関係。更新前のベースラインでも同じ 7 件がスキップされている。

静的チェックも全て pass。

| 項目 | 更新前 | 更新後 |
| --- | --- | --- |
| `npm run lint` (eslint) | pass | pass |
| `npm run format:check` (prettier) | pass | pass |
| `npm run check` (svelte-check) | 467 files / 0 errors / 0 warnings | 467 files / 0 errors / 0 warnings |
| `npm run build` (vite) | 成功 | 成功 |

E2E はヘッドレス環境だと Electron が SIGSEGV で起動できないため `xvfb-run` 経由で実行した。
これは更新前後で共通の環境要因であり、依存更新とは無関係である
(更新前のベースラインでも同様に 13 件全て SIGSEGV で落ち、`xvfb-run` 経由なら 13 件全て pass した)。

### 画面テスト

自動テストは mermaid を 1 件もカバーしていないため、実際の Electron アプリを起動し、
mermaid ブロックを含むメモを実際に描画させて確認した。light / dark の両テーマで実施。

| 確認項目 | 結果 |
| --- | --- |
| アプリ起動・ワークスペースプロジェクト表示・タスク選択 | 正常 |
| Markdown 描画 (見出し / 強調 / インラインコード / リンク / リスト / 表 / 引用) | 正常 |
| GFM チェックボックス (クリック可能な状態で出力) | 正常 |
| コードブロックのシンタックスハイライト + 言語バッジ + Copy ボタン | 正常 |
| mermaid ブロックの SVG 化 | 3 ブロック → SVG 3 個 |
| `mermaid-error` (描画失敗) | 0 件 |
| JavaScript エラー / console error | 0 件 |
| dark テーマでの mermaid 再初期化 | 正常 (図がダークテーマで描画される) |

#### 検出した見た目の問題 — 回帰ではない

図中のノードラベルが途中で切れる (`Start` → `Star`、`Choice` → `Choic`)。ただしこれは
**mermaid 11.15.0 に戻して同じ画面を撮り直しても完全に同一**であり、今回の更新による回帰ではない。
原因は検証コンテナのフォント不足 (`fc-list` で 59 件、DejaVu / FreeSans のみで日本語フォントなし) で、
`fontFamily: "inherit"` を指定している mermaid のテキスト実測値と実際の描画フォントがずれるため。
Windows 上の実利用環境では再現しない見込み。

スクリーンショットのバイト差分については、**同一バージョンを 2 回実行しても同じ差分パターンが出る**
ことを確認済み (mermaid が生成する ID 等が実行ごとに変わるため)。したがってバイト差分は
バージョン間の差ではなく実行ごとのゆらぎであり、視覚的な回帰は検出されなかった。

## 修正の影響範囲

ロックファイルの前後差分を実測した結果、パッケージの変更は 90 件、追加 39 件、完全削除 71 件。
ただし**配布物に入るものに限れば変更 5 件・追加 2 件・削除 0 件**で、いずれも mermaid とその依存である。

### A. 実行時（配布物に入る）— mermaid 系のみ

| パッケージ | 更新前 | 更新後 | 位置づけ |
| --- | --- | --- | --- |
| mermaid | 11.15.0 | 11.17.0 | 直接依存 |
| dompurify | 3.4.5 | 3.4.14 | mermaid の内部依存 |
| cytoscape | 3.33.4 | 3.34.1 | mermaid の内部依存 |
| dayjs | 1.11.20 | 1.11.23 | mermaid の内部依存 |
| @mermaid-js/parser | 1.1.1 | 1.2.1 | mermaid の内部依存 |
| fastdom | — | 1.0.12 | mermaid 11.17 の新規依存 |
| strictdom | — | 1.0.1 | mermaid 11.17 の新規依存 |

**機能面で影響を受けるのは Markdown メモの mermaid 図描画のみ。**
quill / marked / marked-highlight / highlight.js / codemirror 各種 / lodash / chokidar /
electron-log / @commonify/lowdb / turndown など、その他の実行時依存は 1 つも変わっていない。
削除された実行時パッケージは 0 件なので、機能が失われる箇所はない。

### B. 実行基盤（Electron）— セキュリティパッチのみ

| | 更新前 | 更新後 |
| --- | --- | --- |
| Electron | 41.2.1 | 41.10.6 |
| Chromium | 146.0.7680.188 | 146.0.7680.216 |
| Node | 24.14.1 | 24.18.0 |
| V8 | 14.6.202.33-electron.0 | 14.6.202.34-electron.0 |

Chromium は同一ビルドライン (146.0.7680) 内のパッチ更新にとどまる。レンダリングエンジンや
JavaScript エンジンの挙動が変わる規模の更新ではない。Electron のメジャー / マイナーも 41 系のまま。

### C. ビルド出力 — チャンク構成が変わる

vite 8.0.8 → 8.2.2 に伴い、内部のバンドラ rolldown が `1.0.0-rc.15` → `1.2.5`
(リリース候補版から安定版) へ上がる。これによりチャンク分割の結果が変わった。

| | 更新前 | 更新後 | 差分 |
| --- | --- | --- | --- |
| 総バンドルサイズ | 5,791,480 B | 6,037,928 B | +246,448 B (+4.3%) |
| 起動時ロード量 (entry + preload + CSS) | 1,022.5 KB | 1,020.7 KB | −1.8 KB |
| 起動時に読むファイル数 | 11 | 4 | −7 |

総サイズの +246KB は mermaid 11.17 の増加分。起動時に読み込む総バイト数はほぼ変わらず、
分散していたチャンクが entry へ集約されてファイル数が 11 → 4 に減った。本番は `file://`
からの読み込みなので、ファイル数が減ることは不利にならない。

### D. パッケージング — 一部未検証

electron-builder 26.8.1 → 26.15.3。`electron-builder --dir` によるパッケージングは成功し、
生成された実行ファイルが起動して DB 初期化・IPC 登録・レンダラー描画まで到達することを確認した。

ただし**本来の配布ターゲットである Windows NSIS (`npm run dist` = `electron-builder -w`) は未検証**。
検証環境が Linux コンテナで wine がないため実行できなかった。

### E. 開発・テストのみ（配布物に影響なし）

変更 85 件、完全削除 71 件はすべて dev 依存。削除された 71 件には `extract-zip` と `ip-address`
が含まれており、これらは脆弱性ごとツリーから消滅した。主な変更は電子ビルド系
(app-builder-lib / builder-util / dmg-builder / electron-publish)、
lint / test 系 (svelte 5.56.10、vite 8.2.2、postcss、js-yaml、undici、tar) など。

svelte は dev 依存だがコンパイル結果はバンドルに載るため、5.55.4 → 5.56.10 により
**全 Svelte コンポーネントが再コンパイルされる**。これは特定機能ではなく UI 全体に及ぶ変更だが、
コンポーネントテスト 149 件と E2E 13 件が更新前と同じ結果で通過している。

### F. 機能・仕様は変わったか — mermaid の実出力を新旧 diff

**アプリのソースコードは 1 行も変更していない。** `main..HEAD` の差分は `package.json` と
`package-lock.json` のみで、`src/` `electron/` `tests/` の変更行数はいずれも 0。
したがって仕様変更・機能追加・機能削除はいずれも発生していない。

挙動が変わり得るのはライブラリ側だけである。配布物に入るライブラリで変わったのは mermaid とその
依存のみなので、**同一の図ソースを 11.15.0 と 11.17.0 の両方で `mermaid.render()` に通し、
生成される SVG 文字列そのものを diff** して確認した (図種 18 種、実行毎に変わる生成 ID は正規化)。

| 図種 | SVG 差分の内容 | 見た目 |
| --- | --- | --- |
| flowchart / sequence / state / gantt / er / journey / mindmap / xychart-beta / architecture-beta / quadrant / timeline / sankey-beta (12 種) | `<style>` ブロックのみ | 同一 |
| gitgraph | コミットハッシュ (描画毎の乱数) | 同一 |
| requirement | roughjs の手描き風パスの制御点 (乱数)。端点は一致 | 同一 |
| pie | 空の `<g>` ラッパーが 1 つ増えるのみ | 同一 |
| class | marker の内部 id / クラス名が `class-` → `classDiagram-` | 同一 |
| **radar-beta** | 軸ラベルに `text-anchor` / `dominant-baseline` が追加、y 座標 −315 → −319、svg に `overflow="visible"` | **ラベル配置が変わる** |
| **block-beta** | viewBox が 57×42 → 105×50、矢印マーカーが 12 → 8、`-margin` 系マーカーが追加 | **描画幅が約 2 倍になる** |

追加された CSS ルール (`[data-look="neo"].swimlane.cluster rect` /
`.node .collapsed-indicator` / `.pieCircle.highlighted` / `.pieCircle.highlightedOnHover:hover`) は、
対応するクラスが実際の出力に一切付与されないことを確認済みで、現状では未使用＝無効である。

class 図の内部クラス名変更も影響しない。アプリの CSS が参照しているのは
`.mermaid-block` / `.mermaid-block svg` / `.mermaid-block.mermaid-error` という自前のラッパー
クラスだけで、mermaid 内部のクラス名には一切依存していない
(`MarkdownMemo.svelte` の `:global()` 定義)。

**結論: 見た目が変わるのは radar-beta と block-beta の 2 図種のみ。** どちらも mermaid 側の
描画改善であり、アプリの仕様ではない。加えて `.mermaid-block svg { max-width: 100%; height: auto }`
が効くため、サイズが変わってもコンテナ幅に収まるようスケールされる。

なお svelte 5.55.4 → 5.56.10 は 17 リリース分 (マイナー 1 つ) で、全 Svelte コンポーネントが
再コンパイルされる。ただしユニット 343 件・コンポーネント 149 件・E2E 13 件が更新前と同一の結果で
通過し、svelte-check も 0 errors、画面テストも同一であることから、観測可能な挙動変化は検出されていない。

### 残る未検証点

1. **Windows NSIS インストーラの生成と Windows 実機での動作**。特に「プログラムから開く」
   (`rundll32.exe shell32.dll,OpenAs_RunDLL`) など Windows 固有経路は今回一切踏んでいない。
2. **日本語フォントのある環境での mermaid ラベル描画**。検証コンテナにフォントがなく、
   ラベルの折り返し / 省略挙動は確認できていない (更新前後で同一であることは確認済み)。

## 併せて検討すべき事項 (CVE 対応とは別)

1. **Markdown プレビューのサニタイズ** — 本トリアージで唯一の実質的なリスク源。`marked.parse` の
   出力を DOMPurify に通してから `{@html}` に渡せば、Electron 系・Svelte 系の「条件付き該当」が
   まとめて成立しなくなる。バージョン更新よりこちらのほうが効果が大きい。
2. **`.github/dependabot.yml` が存在しない** — アラートは届くが自動更新 PR は作られない。
   npm エコシステムの設定を追加すれば追随が容易になる。
3. **未使用依存の削除** — `turndown` / `turndown-plugin-gfm` / `quill-delta-to-html` /
   `@editorjs/editorjs` / `picomatch` はソース中から参照されていない。削除すれば将来のアラート数と
   攻撃面が減る。
