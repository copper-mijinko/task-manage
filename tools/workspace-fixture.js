/**
 * テストと計測用に、ワークスペースのフォルダーを Markdown ファイルで作る。
 *
 * アプリが保存するのと同じ形で書く（`docs/data.md`）。`graph-v1.json` で作って
 * 起動時に変換させると、変換の時間まで計測に混ざってしまう。
 */
const fs = require("fs");
const path = require("path");
const { renderNodeFile } = require("../electron/store/node-file");

/**
 * ノードの配列から、ワークスペースのフォルダーに Markdown ファイルを書く。
 * `parents` が空のノードがワークスペース自身。
 *
 * ワークスペース直下の子がプロジェクト（フォルダー名は id）で、それ以外のノードは
 * 最初の親をたどった先のプロジェクトに置く。
 *
 * @param {string} workspacePath
 * @param {any[]} nodes
 * @param {{ inboxId?: string }} [options]
 */
function writeWorkspaceFiles(workspacePath, nodes, { inboxId } = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes.find((n) => n.parents.length === 0);
  const isProject = (n) => n.parents.some((parent) => parent.id === root.id);
  const projectOf = (n) => {
    const seen = new Set();
    let current = n;
    while (current && !isProject(current) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parents[0]?.id);
    }
    return current ?? n;
  };
  fs.mkdirSync(workspacePath, { recursive: true });
  for (const n of nodes) {
    const text = renderNodeFile(n, { inbox: n.id === inboxId });
    const target =
      n === root
        ? path.join(workspacePath, "_workspace.md")
        : isProject(n)
          ? path.join(workspacePath, n.id, "_project.md")
          : path.join(workspacePath, projectOf(n).id, n.id, "_index.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}

module.exports = { writeWorkspaceFiles };
