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

### electron-builder 系 6 パッケージ (high) — ビルド時のみ・実体は 2 件

`app-builder-lib` / `builder-util` / `builder-util-runtime` / `dmg-builder` / `electron-publish` /
`electron-builder-squirrel-windows` は同一チェーン。

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

## 対処手順 (検証済み)

以下 5 行で **25 件 → 1 件** (非該当の quill のみ) になることを、ロックファイルを更新して
`npm audit` を再実行し確認済み。すべて同一メジャー内のマイナー / パッチ更新である。

```bash
npm i -D electron@^41.10.6 electron-builder@^26.15.3 svelte@^5.56.10 vite@^8.2.2
npm i mermaid@^11.16.1
npm audit fix          # 残る dev 依存 (undici / js-yaml / fast-uri / brace-expansion / dompurify) を解消
npm run lint && npm run test:all
```

更新後に解決されるバージョン: electron 41.10.6 / electron-builder 26.15.3 / svelte 5.56.10 /
vite 8.2.2 / mermaid 11.17.0 / dompurify 3.4.14 / undici 7.29.0 / js-yaml 4.3.1 /
fast-uri 3.1.5 / brace-expansion 5.0.9。

## 併せて検討すべき事項 (CVE 対応とは別)

1. **Markdown プレビューのサニタイズ** — 本トリアージで唯一の実質的なリスク源。`marked.parse` の
   出力を DOMPurify に通してから `{@html}` に渡せば、Electron 系・Svelte 系の「条件付き該当」が
   まとめて成立しなくなる。バージョン更新よりこちらのほうが効果が大きい。
2. **`.github/dependabot.yml` が存在しない** — アラートは届くが自動更新 PR は作られない。
   npm エコシステムの設定を追加すれば追随が容易になる。
3. **未使用依存の削除** — `turndown` / `turndown-plugin-gfm` / `quill-delta-to-html` /
   `@editorjs/editorjs` / `picomatch` はソース中から参照されていない。削除すれば将来のアラート数と
   攻撃面が減る。
