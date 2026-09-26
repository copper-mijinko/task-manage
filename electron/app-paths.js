const fs = require("fs");
const path = require("path");

/**
 * ポータブル版のデータフォルダ（実行ファイルの隣の `data`）。
 *
 * 配布版で、実行ファイルと同じフォルダに `data` フォルダがあればポータブル
 * 版とみなす。リリースの tar.gz には空の `data` を入れて配り、インストーラー
 * 版には入れない。`TASK_MANAGE_DATA_DIR` があるときはそちらを優先するので
 * ここでは見ない。
 *
 * @param {{ env?: NodeJS.ProcessEnv, electronApp?: { isPackaged: boolean }, execPath?: string }} [options]
 * @returns {string | null}
 */
function portableDataDirectory(options = {}) {
  const env = options.env ?? process.env;
  if (env.TASK_MANAGE_DATA_DIR) return null;
  const electronApp = options.electronApp ?? require("electron").app;
  if (!electronApp?.isPackaged) return null;
  const directory = path.join(path.dirname(options.execPath ?? process.execPath), "data");
  try {
    return fs.statSync(directory).isDirectory() ? directory : null;
  } catch {
    return null;
  }
}

/**
 * ポータブル版なら、Electron の利用者データ領域そのものを `data` に移す。
 *
 * 設定ファイルだけでなく、renderer の localStorage やキャッシュ、ログも
 * 利用者データ領域に置かれるので、丸ごと移さないと PC 側に残る。
 * `app` の ready より前、ほかのモジュールが利用者データ領域を使う前に呼ぶ。
 *
 * @param {{ isPackaged: boolean, setPath: (name: "userData", value: string) => void }} electronApp
 * @param {{ env?: NodeJS.ProcessEnv, execPath?: string }} [options]
 * @returns {string | null} 使うことにしたフォルダ。ポータブル版でなければ null
 */
function usePortableDataDirectory(electronApp, options = {}) {
  const directory = portableDataDirectory({ ...options, electronApp });
  if (directory) electronApp.setPath("userData", directory);
  return directory;
}

/**
 * アプリが持つ小さな状態ファイル（設定・ウィンドウ位置）の置き場所。
 *
 * 1. `TASK_MANAGE_DATA_DIR` があればそこ（E2E とエージェント検証が、
 *    利用者のデータに触れずに起動するため）
 * 2. 配布版は利用者データ領域（`app.getPath("userData")`）。ポータブル版では
 *    起動時に `usePortableDataDirectory` が実行ファイルの隣の `data` へ
 *    向けている。インストーラー版は OS の既定（Windows なら %APPDATA%）。
 *    アプリのインストール先は書き込めないことがあり、更新やアンインストールで
 *    消えるので、設定を置いてはいけない
 * 3. 開発中は従来どおり `electron/` の中（git 管理外）
 *
 * @param {string} fileName
 * @param {{ env?: NodeJS.ProcessEnv, electronApp?: { isPackaged: boolean, getPath: (name: "userData") => string } }} [options]
 */
function resolveAppDataPath(fileName, options = {}) {
  const env = options.env ?? process.env;
  const customDataDir = env.TASK_MANAGE_DATA_DIR;
  if (customDataDir) {
    fs.mkdirSync(customDataDir, { recursive: true });
    return path.join(customDataDir, fileName);
  }
  const electronApp = options.electronApp ?? require("electron").app;
  if (electronApp?.isPackaged) {
    const directory = electronApp.getPath("userData");
    fs.mkdirSync(directory, { recursive: true });
    return path.join(directory, fileName);
  }
  return path.join(__dirname, fileName);
}

module.exports = { portableDataDirectory, usePortableDataDirectory, resolveAppDataPath };
