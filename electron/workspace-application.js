/** Canonical workspace application contract. Electron IPC is one transport.
 * All callers pass through authorization, initialization, revision checks and
 * the same domain command/persistence engine. No renderer tree is accepted.
 *
 * 操作の結果は、グラフ全体ではなく差分（変わったノードだけ）で返す。画面は
 * 持っているグラフにそれを当てる（`docs/architecture.md` の「差分で伝える」）。
 */
function createWorkspaceApplication({ authorize, initialize, repository, publish, openAsset }) {
  async function prepare(workspacePath) {
    await authorize(workspacePath);
    return initialize(workspacePath);
  }
  return {
    read: prepare,
    // `requester` は要求元（Electron では webContents）。結果は戻り値で受け取る
    // ので、同じ変更を通知で二重に送らない。
    async execute({ workspacePath, command, origin = "tree", expectedRevision, requester }) {
      await prepare(workspacePath);
      const result = await repository.executeWorkspaceGraphCommand(
        workspacePath,
        command,
        origin,
        expectedRevision
      );
      publish(workspacePath, { delta: result.delta }, requester);
      return { selectedNodeIds: result.selectedNodeIds, delta: result.delta };
    },
    async history({ workspacePath, direction, expectedRevision, requester }) {
      if (direction !== "undo" && direction !== "redo")
        throw new Error("Invalid history direction");
      await prepare(workspacePath);
      const result = await repository[
        direction === "undo" ? "undoWorkspaceGraph" : "redoWorkspaceGraph"
      ](workspacePath, expectedRevision);
      if (!result.changed) return { changed: false, delta: null };
      publish(workspacePath, { delta: result.delta }, requester);
      return { changed: true, delta: result.delta };
    },
    /** ディスクから読み直す（外で書き換えたファイルを取り込む）。全体を返す。 */
    async reload({ workspacePath, requester }) {
      await authorize(workspacePath);
      const graph = await repository.reloadWorkspaceGraph(workspacePath);
      publish(workspacePath, { graph }, requester);
      return graph;
    },
    async saveAsset({ workspacePath, nodeId, fileName, bytes, kind }) {
      await prepare(workspacePath);
      return repository.saveNodeAsset(workspacePath, nodeId, fileName, bytes, kind);
    },
    async resolveAsset({ workspacePath, nodeId, relativePath }) {
      await prepare(workspacePath);
      return repository.resolveNodeAsset(workspacePath, nodeId, relativePath);
    },
    async openAsset({ workspacePath, nodeId, relativePath, chooseProgram = false }) {
      await prepare(workspacePath);
      const resolved = await repository.resolveNodeAsset(workspacePath, nodeId, relativePath);
      await openAsset(resolved, chooseProgram === true);
    },
  };
}
module.exports = { createWorkspaceApplication };
