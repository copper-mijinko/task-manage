# How to Contribute

このリポジトリでは、通常の変更は Pull Request で `main` に入れ、リリースだけは専用の GitHub App が version commit と tag を作成します。

目的は次の3つです。

- `main` への通常変更はレビューを必須にする
- Codex や Claude などの自動化も通常変更では PR を通す
- リリース用の version commit と tag 作成だけを、承認付き workflow で安全に例外扱いする

## 通常の開発フロー

1. `main` から作業ブランチを作成します。
2. 変更を実装します。
3. ローカルで必要な確認を実行します。

```bash
npm run lint
npm run format:check
npm run check
npm run test:unit
npm run test:component
```

UI や Electron の挙動に関わる変更では、必要に応じて E2E も実行します。

```bash
npm run test:e2e
```

4. Pull Request を作成します。
5. `Lint` と `CI` が通ってから `main` にマージします。

`main` は ruleset で保護されており、通常変更は direct push できません。手元の git、Codex、Claude のいずれで作業しても、通常は Pull Request 経由で取り込みます。

## Workflow 一覧

| Workflow             | ファイル                                   | 何をすると実行されるか                                           | 意図                                                               |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Lint`               | `.github/workflows/lint.yml`               | `main` への push、または `main` 向け Pull Request                | ESLint と Prettier の形式確認を軽く先に走らせる                    |
| `CI`                 | `.github/workflows/main.yml`               | Pull Request、`main`/`master` への push、`v*` tag push、手動実行 | 型チェック、unit/component/E2E test、tag 時の release 作成         |
| `Create Release Tag` | `.github/workflows/tag-release.yml`        | Actions 画面から手動実行                                         | version commit と `vX.Y.Z` tag を作り、release workflow を起動する |
| `Claude Code`        | `.github/workflows/claude.yml`             | issue/PR comment などで `@claude` を呼ぶ                         | Claude に実装やPR作成を依頼する                                    |
| `Claude Code Review` | `.github/workflows/claude-code-review.yml` | Bot 以外が作成・更新した Pull Request                            | Claude にコードレビューを依頼する                                  |

## Lint

`Lint` は Pull Request と `main` push で実行されます。

実行内容は次の通りです。

```bash
npm ci
npm run lint
npm run format:check
```

`format:check` が失敗した場合は、対象ファイルを Prettier で整形してから再度 push します。

## CI

`CI` の `test` job は Pull Request、`main`/`master` push、`v*` tag push、手動実行で走ります。

実行内容は次の通りです。

```bash
npm ci
npm run check
npm run test:unit
npm run test:component
xvfb-run -a npm run test:e2e
```

E2E では Electron を xvfb 上で起動します。失敗時は `playwright-report` と `test-results` が artifact としてアップロードされます。

## Release

リリースは `Create Release Tag` workflow から開始します。

1. GitHub Actions の `Create Release Tag` を開きます。
2. `Run workflow` を押します。
3. `version` は空欄でも構いません。
4. `release` environment の承認待ちになります。
5. 承認後、workflow が version commit と tag を作成します。
6. `v*` tag push により `CI` の release job が起動します。
7. test job が通ると、Windows build と GitHub Release が作成されます。

`version` を空欄にした場合、既存の stable tag `vX.Y.Z` のうち最新のものを探し、patch version を 1 増やします。たとえば最新 tag が `v0.1.19` なら `v0.1.20` になります。stable tag が1つもない場合は `v0.1.0` になります。

明示的に指定する場合は `0.1.20` または `v0.1.20` のどちらでも指定できます。内部では `v` 付き tag に正規化されます。

release job は tag から version を取り出し、build 時に `package.json` の version をその tag に合わせます。その後 `npm run dist` を実行し、生成された `.tar.gz` と `.exe` を GitHub Release に添付します。

## リリース用 GitHub App

`main` は Pull Request 必須のため、通常の `GITHUB_TOKEN` では `git push origin HEAD:main` が拒否されます。

そのため、リリース用に専用 GitHub App を使います。この App だけを ruleset の bypass actor に登録し、`Create Release Tag` workflow だけがその App token を使います。

推奨設定は次の通りです。

- GitHub App 名: `task-manage-release`
- Repository permissions: `Contents: Read and write`
- インストール先: この repository のみ
- `main` ruleset bypass actor: `task-manage-release`
- bypass mode: `Always`
- secret 保存先: `release` environment
- environment secrets:
  - `RELEASE_APP_ID`
  - `RELEASE_APP_PRIVATE_KEY`

`release` environment には required reviewer を設定します。このため、`Create Release Tag` は毎回承認待ちになります。承認されるまで App private key は job に渡らず、version commit や tag push も実行されません。

## 認証と認可

| 実行主体              | 使う認証情報                   | 主な権限                   | `main` へ直接 push できるか            |
| --------------------- | ------------------------------ | -------------------------- | -------------------------------------- |
| 人間の開発者          | GitHub user token / SSH key    | ユーザー自身の権限         | 原則不可。Pull Request 必須            |
| Codex                 | 操作者の git/gh 認証           | 操作者と同等               | 原則不可。Pull Request 必須            |
| Claude Code           | workflow の権限と Claude token | PR/issue 対応用            | 原則不可。リリース bypass には使わない |
| 通常の GitHub Actions | `GITHUB_TOKEN`                 | workflow で指定された権限  | 原則不可。ruleset に従う               |
| Release GitHub App    | App installation token         | `Contents: Read and write` | `Create Release Tag` の承認後だけ可    |

Codex や Claude を ruleset bypass に追加しない方針です。AI による通常変更は Pull Request と CI を通し、リリースに必要な最小の例外だけを専用 App に閉じ込めます。

## セキュリティ方針

- `GITHUB_TOKEN` に broad な write 権限や main bypass を与えません。
- 個人アクセストークンで release commit を作りません。
- release App の private key は `release` environment secret に置きます。
- release App の権限は `Contents: Read and write` に絞ります。
- `release` environment の承認を必須にし、リリース操作を毎回人間が確認します。
- release App を他 repository に広くインストールしません。

この設計により、通常の開発速度を保ちながら、main bypass の範囲を release workflow に限定できます。

## よくある失敗

### `GH013: Changes must be made through a pull request`

`Create Release Tag` が `main` に push できていません。次を確認します。

- release App が repository にインストールされているか
- release App が `main` ruleset の bypass actor に入っているか
- `RELEASE_APP_ID` と `RELEASE_APP_PRIVATE_KEY` が `release` environment secret にあるか
- checkout が `steps.release-token.outputs.token` を使っているか
- `release` environment の承認が完了しているか

### `Tag already exists`

指定した tag が既に存在します。別の version を指定するか、tag をどう扱うかを確認してから再実行します。

### `Invalid semver version`

`version` 入力が semver として不正です。`0.1.20` や `v0.1.20` の形式で指定します。

### `format:check` が失敗する

Prettier の整形差分があります。対象ファイルを整形し、再度 `npm run format:check` を実行します。
