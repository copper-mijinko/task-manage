import { vi } from "vitest";
import engine from "../../electron/workspace-graph-engine.js";

export const TEST_WORKSPACE = "/test/workspace";

/**
 * 旧来のテスト用フィクスチャ（入れ子の木）をワークスペースグラフにする。
 *
 * 木の各項目は `{ id, data: { name, status, "start date", "due date", body,
 * format, tags, attachments }, children, archived }`。ルート（プロジェクト）は
 * ワークスペースのルート直下に置く。
 */
export function graphFromTree(project, { rootId = "workspace-root", inboxId } = {}) {
  const nodes = {
    [rootId]: { id: rootId, name: "Workspace", parents: [], createdAt: "2026-01-01" },
  };
  const visit = (item, parentId, order) => {
    const data = item.data ?? {};
    const existing = nodes[item.id];
    if (existing) {
      existing.parents.push({ id: parentId, order });
      return;
    }
    const node = {
      id: item.id,
      name: String(data.name ?? ""),
      parents: [{ id: parentId, order }],
      createdAt: "2026-01-01",
      tags: [...(data.tags ?? [])],
      attachments: structuredClone(data.attachments ?? []),
    };
    if (data.status) node.status = data.status;
    if (data["start date"]) node.startDate = data["start date"];
    if (data["due date"]) node.dueDate = data["due date"];
    if (data.body !== undefined) node.body = structuredClone(data.body);
    if (data.format) node.format = data.format;
    if (item.archived) node.archived = true;
    nodes[item.id] = node;
    (item.children ?? []).forEach((child, index) => visit(child, item.id, index));
  };
  const projects = Array.isArray(project) ? project : [project];
  // `{ data: 木 }`（プロジェクト全体）か、木の項目そのものかを受け付ける。
  const rootOf = (item) => (item.data?.id !== undefined ? item.data : item);
  projects.forEach((item, index) => visit(rootOf(item), rootId, index));
  const graph = { schemaVersion: 1, workspaceId: "test", rootId, revision: 1, nodes };
  if (inboxId) graph.inboxId = inboxId;
  engine.validateGraph(graph);
  return graph;
}

/**
 * `window.electronAPI` を、メモリ上のグラフで動く偽物にする。コマンドは
 * main プロセスと同じエンジン（`workspace-graph-engine.js`）で実行する。
 */
export function installGraphBackend(initialGraph, extraApi = {}) {
  let graph = structuredClone(initialGraph);
  const undo = [];
  const redo = [];
  const listeners = new Set();
  const withHistory = () => ({
    ...structuredClone(graph),
    history: { undo: undo.length, redo: redo.length },
  });
  const publish = () => {
    const snapshot = withHistory();
    for (const listener of listeners) listener({ workspacePath: TEST_WORKSPACE, graph: snapshot });
    return snapshot;
  };
  const checkRevision = (expected) => {
    if (Number.isFinite(expected) && expected !== graph.revision)
      throw new Error(
        `Workspace graph changed (expected revision ${expected}, found ${graph.revision})`
      );
  };
  const meta = new Map();
  const api = {
    wsReadGraph: vi.fn(async () => withHistory()),
    wsExecuteGraphCommand: vi.fn(async (_path, command, origin, expectedRevision) => {
      checkRevision(expectedRevision);
      const result = engine.executeGraphCommand(graph, command, origin);
      undo.push(graph);
      redo.length = 0;
      graph = result.graph;
      return { graph: publish(), selectedNodeIds: result.selectedNodeIds };
    }),
    wsUndoGraph: vi.fn(async (_path, expectedRevision) => {
      checkRevision(expectedRevision);
      if (!undo.length) return { graph: withHistory(), changed: false };
      redo.push(graph);
      graph = { ...undo.pop(), revision: graph.revision + 1 };
      return { graph: publish(), changed: true };
    }),
    wsRedoGraph: vi.fn(async (_path, expectedRevision) => {
      checkRevision(expectedRevision);
      if (!redo.length) return { graph: withHistory(), changed: false };
      undo.push(graph);
      graph = { ...redo.pop(), revision: graph.revision + 1 };
      return { graph: publish(), changed: true };
    }),
    onWorkspaceGraphUpdated: vi.fn((callback) => listeners.add(callback)),
    wsSaveGraphAsset: vi.fn(async (_path, nodeId, fileName) => ({
      relativePath: `assets/${nodeId}/${fileName}`,
    })),
    wsResolveGraphAsset: vi.fn(async () => ({ url: "data:image/png;base64," })),
    wsOpenGraphAsset: vi.fn(async () => undefined),
    wsGetWorkspaces: vi.fn(async () => ({
      workspaces: [{ path: TEST_WORKSPACE, label: "Test" }],
      activeWorkspace: TEST_WORKSPACE,
    })),
    getMetaData: vi.fn(async (key) => meta.get(key)),
    setMetaData: vi.fn((key, value) => meta.set(key, value)),
    deleteMetaData: vi.fn((key) => meta.delete(key)),
    openTaskDetailWindow: vi.fn(),
    openExternalLink: vi.fn(),
    openImageExternal: vi.fn(async () => ({ success: true })),
    openImageWindow: vi.fn(),
    message: vi.fn(),
    ...extraApi,
  };
  Object.defineProperty(window, "electronAPI", { configurable: true, value: api });
  return {
    api,
    /** いまの（保存済みの）グラフ。 */
    graph: () => graph,
    node: (id) => graph.nodes[id],
    /** 親の下の子の id を、並び順どおりに返す。 */
    childrenOf: (parentId) =>
      Object.values(graph.nodes)
        .filter((node) => node.parents.some((parent) => parent.id === parentId))
        .sort(
          (a, b) =>
            a.parents.find((p) => p.id === parentId).order -
            b.parents.find((p) => p.id === parentId).order
        )
        .map((node) => node.id),
  };
}
