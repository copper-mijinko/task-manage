/** Canonical workspace application contract. Electron IPC is one transport.
 * All callers pass through authorization, initialization, revision checks and
 * the same domain command/persistence engine. No renderer tree is accepted.
 */
function createWorkspaceApplication({ authorize, initialize, repository, publish, openAsset }) {
  async function prepare(workspacePath) {
    await authorize(workspacePath);
    return initialize(workspacePath);
  }
  return {
    read: prepare,
    // `requester` は要求元（Electron では webContents）。結果は戻り値で受け取る
    // ので、同じグラフを通知で二重に送らない。
    async execute({ workspacePath, command, origin = "tree", expectedRevision, requester }) {
      await prepare(workspacePath);
      const result = await repository.executeWorkspaceGraphCommand(
        workspacePath,
        command,
        origin,
        expectedRevision
      );
      publish(workspacePath, result.graph, requester);
      return result;
    },
    async history({ workspacePath, direction, expectedRevision, requester }) {
      if (direction !== "undo" && direction !== "redo")
        throw new Error("Invalid history direction");
      await prepare(workspacePath);
      const result = await repository[
        direction === "undo" ? "undoWorkspaceGraph" : "redoWorkspaceGraph"
      ](workspacePath, expectedRevision);
      if (result.changed) publish(workspacePath, result.graph, requester);
      return result;
    },
    async listMarkdownImports(workspacePath) {
      await prepare(workspacePath);
      return repository.listMarkdownImportSources(workspacePath);
    },
    async importMarkdown({ workspacePath, dirNames, expectedRevision, requester }) {
      await prepare(workspacePath);
      const result = await repository.importMarkdownProjects(
        workspacePath,
        Array.isArray(dirNames) ? dirNames.map(String) : [],
        expectedRevision
      );
      publish(workspacePath, result.graph, requester);
      return result;
    },
    async saveAsset({ workspacePath, nodeId, fileName, bytes }) {
      await prepare(workspacePath);
      return repository.saveNodeAsset(workspacePath, nodeId, fileName, bytes);
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
