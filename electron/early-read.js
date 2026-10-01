const fs = require("fs");

/**
 * Electron が起動しきる（`app` の ready）より前に、開いているワークスペースを読み始める。
 *
 * ファイルを読むのは Node の機能だけで足りるので、ウィンドウを作るのも画面を読み込むのも
 * 待たなくてよい。読んだ結果は main 側が持ち続けるので、画面からの最初の要求
 * （権限の確認を通った `ws:read-graph`）は、その結果をそのまま使う。権限の確認は
 * 省かない。読み始めるのは、設定（`meta.json`）にある、いま開いているワークスペースだけ。
 *
 * 設定が読めない・ワークスペースが無いときは何もしない（あとの要求で改めて読む）。
 *
 * @param {object} options
 * @param {string} options.metaPath 設定ファイル（`meta.json`）
 * @param {(workspacePath: string) => Promise<unknown>} options.read ワークスペースの読み込み
 * @param {(error: Error) => void} [options.onError] 読み込みに失敗したとき（記録だけ）
 * @param {(file: string, encoding: "utf8") => string} [options.readFile]
 * @returns {string | null} 読み始めたワークスペース
 */
function startEarlyWorkspaceRead({
  metaPath,
  read,
  onError = () => {},
  readFile = fs.readFileSync,
}) {
  let workspacePath;
  try {
    workspacePath = JSON.parse(readFile(metaPath, "utf8"))?.activeWorkspace;
  } catch {
    return null;
  }
  if (typeof workspacePath !== "string" || workspacePath === "") return null;
  // 失敗しても、画面からの要求で改めて読んでエラーを出すので、ここでは記録だけ。
  Promise.resolve()
    .then(() => read(workspacePath))
    .catch(onError);
  return workspacePath;
}

module.exports = { startEarlyWorkspaceRead };
