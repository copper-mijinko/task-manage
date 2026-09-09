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
    async readInbox(workspacePath) {
      const graph = await prepare(workspacePath);
      const root = Object.values(graph.nodes).find((node) => node.name.toLowerCase() === "inbox");
      const tasks = root
        ? Object.values(graph.nodes).filter(
            (node) => node.id === root.id || node.parents.some((parent) => parent.id === root.id)
          )
        : [];
      return {
        rootId: root?.id ?? null,
        tasks: Object.fromEntries(tasks.map((node) => [node.id, node])),
      };
    },
    async execute({ workspacePath, command, origin = "tree", expectedRevision }) {
      await prepare(workspacePath);
      const result = await repository.executeWorkspaceGraphCommand(
        workspacePath,
        command,
        origin,
        expectedRevision
      );
      publish(workspacePath, result.graph);
      return result;
    },
    async history({ workspacePath, direction, expectedRevision }) {
      if (direction !== "undo" && direction !== "redo")
        throw new Error("Invalid history direction");
      await prepare(workspacePath);
      const result = await repository[
        direction === "undo" ? "undoWorkspaceGraph" : "redoWorkspaceGraph"
      ](workspacePath, expectedRevision);
      if (result.changed) publish(workspacePath, result.graph);
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
