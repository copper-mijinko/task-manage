const fs = require("fs");
const path = require("path");

/**
 * アプリが持つ小さな状態ファイル（設定・ウィンドウ位置）の置き場所。
 *
 * `TASK_MANAGE_DATA_DIR` があればそこを使う（E2E とエージェント検証が、
 * 利用者のデータに触れずに起動するため）。
 */
function resolveAppDataPath(fileName) {
  const customDataDir = process.env.TASK_MANAGE_DATA_DIR;
  if (customDataDir) {
    fs.mkdirSync(customDataDir, { recursive: true });
    return path.join(customDataDir, fileName);
  }
  return path.join(__dirname, fileName);
}

module.exports = { resolveAppDataPath };
