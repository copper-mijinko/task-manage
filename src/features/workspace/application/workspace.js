import { derived, get } from "svelte/store";
import { workspace_graph_store } from "../stores/graph";
import { workspace_store } from "../stores/workspace";

export const workspaceNavigation = derived(
  [workspace_graph_store, workspace_store],
  ([state, workspace]) => {
    const graph = state.workspacePath === workspace.activeWorkspacePath ? state.graph : null;
    if (!graph) return null;
    return {
      rootId: graph.rootId,
      inboxId: graph.inboxId,
      names: Object.fromEntries(Object.values(graph.nodes).map((n) => [n.id, n.name])),
      scopes: Object.values(graph.nodes)
        .filter((n) => !n.archived && n.parents.some((p) => p.id === graph.rootId))
        .map((n) => ({
          rootId: n.id,
          protected: n.id === graph.inboxId,
          name: n.name,
          order: n.parents.find((p) => p.id === graph.rootId).order,
        }))
        .sort(
          (a, b) =>
            a.order - b.order || a.name.localeCompare(b.name) || a.rootId.localeCompare(b.rootId)
        ),
    };
  }
);
let loading;
let loadingPath;
export const workspaceApplication = {
  async load(path) {
    const current = get(workspace_graph_store);
    if (current.workspacePath === path && current.graph) return current.graph;
    if (loading && loadingPath === path) return loading;
    loadingPath = path;
    const next = workspace_graph_store.load(path);
    loading = next;
    try {
      return await next;
    } finally {
      if (loading === next) loading = undefined;
    }
  },
  async createScope(path, name) {
    const graph = await this.load(path);
    return workspace_graph_store.execute(
      { type: "create-node", parentId: graph.rootId, node: { name } },
      "tree",
      path
    );
  },
  async removeScope(path, nodeId) {
    await this.load(path);
    return workspace_graph_store.execute({ type: "delete-node", nodeId }, "tree", path);
  },
  async reorderScopes(path, scopes) {
    const graph = await this.load(path);
    return workspace_graph_store.execute(
      {
        type: "batch",
        commands: scopes.map((scope, order) => ({
          type: "move",
          childId: scope.rootId,
          fromParentId: graph.rootId,
          toParentId: graph.rootId,
          order,
        })),
      },
      "tree",
      path
    );
  },
  undo: () => workspace_graph_store.undo(),
  redo: () => workspace_graph_store.redo(),
};
