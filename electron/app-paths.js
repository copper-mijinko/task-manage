const fs = require("fs");
const path = require("path");

/**
 * アプリが持つ小さな状態ファイル（設定・ウィンドウ位置）の置き場所。
 *
 * - `TASK_MANAGE_DATA_DIR` があればそこを使う（E2E とエージェント検証が、
 *   利用者のデータに触れずに起動するため）
 * - 配布版は OS の利用者データ領域（`app.getPath("userData")`）。アプリの
 *   インストール先は書き込めないことがあり、更新やアンインストールで
 *   消えるので、設定を置いてはいけない
 * - 開発中は従来どおり `electron/` の中（git 管理外）
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

module.exports = { resolveAppDataPath };
