import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bodies_epoch,
  ensureAllBodies,
  node_bodies,
  workspace_graph,
  workspace_graph_store,
} from "@features/workspace/stores/graph";
import { filter } from "@features/search/stores/search";
import { saveStatus } from "@stores/save_status";

const mocks = vi.hoisted(() => ({
  readGraph: vi.fn(),
  executeGraphCommand: vi.fn(),
  undoGraph: vi.fn(),
  redoGraph: vi.fn(),
  reloadWorkspace: vi.fn(),
  readAllBodies: vi.fn(),
  graphUpdated: undefined as
    | ((event: { workspacePath: string; graph?: unknown; delta?: unknown }) => void)
    | undefined,
}));

vi.mock("@lib/ipc/platform", () => ({
  wsReadGraph: (...args: unknown[]) => mocks.readGraph(...args),
  wsExecuteGraphCommand: (...args: unknown[]) => mocks.executeGraphCommand(...args),
  wsUndoGraph: (...args: unknown[]) => mocks.undoGraph(...args),
  wsRedoGraph: (...args: unknown[]) => mocks.redoGraph(...args),
  wsReloadWorkspace: (...args: unknown[]) => mocks.reloadWorkspace(...args),
  wsReadAllNodeBodies: (...args: unknown[]) => mocks.readAllBodies(...args),
  onWorkspaceGraphUpdated: (callback: typeof mocks.graphUpdated) => {
    mocks.graphUpdated = callback;
  },
}));

const graph = (workspaceId: string, revision: number) => ({
  schemaVersion: 1 as const,
  workspaceId,
  rootId: "root",
  revision,
  nodes: { root: { id: "root", name: "Root", parents: [], createdAt: "2026-01-01" } },
});

describe("workspace graph store races", () => {
  beforeEach(() => {
    mocks.readGraph.mockReset();
    mocks.executeGraphCommand.mockReset();
    mocks.undoGraph.mockReset();
    mocks.redoGraph.mockReset();
  });

  it("does not notify graph subscribers when a broadcast or result carries the same revision", async () => {
    mocks.readGraph.mockResolvedValue(graph("same", 1));
    await workspace_graph_store.load("same");
    const next = graph("same", 2);
    mocks.executeGraphCommand.mockResolvedValue({ graph: next });
    let notifications = 0;
    const unsubscribe = workspace_graph.subscribe(() => notifications++);
    notifications = 0;

    // 通知が先に届き、そのあと同じ版が戻り値で届く（逆順もありうる）。
    mocks.graphUpdated?.({ workspacePath: "same", graph: next });
    await workspace_graph_store.execute({
      type: "update-node",
      nodeId: "root",
      changes: {},
    } as never);
    mocks.graphUpdated?.({ workspacePath: "same", graph: { ...next } });

    expect(notifications).toBe(1);
    expect(get(workspace_graph)).toBe(next);
    unsubscribe();
  });

  it("guards stale successful and failed loads", async () => {
    let resolveOld!: (value: unknown) => void;
    let rejectStale!: (error: Error) => void;
    mocks.readGraph.mockImplementation((path: string) => {
      if (path === "old")
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      if (path === "stale")
        return new Promise((_, reject) => {
          rejectStale = reject;
        });
      return Promise.resolve(graph(path, 2));
    });
    const oldLoad = workspace_graph_store.load("old");
    await workspace_graph_store.load("new");
    resolveOld(graph("old", 99));
    await oldLoad;
    expect(get(workspace_graph_store).workspacePath).toBe("new");
    const staleLoad = workspace_graph_store.load("stale");
    const staleFailure = expect(staleLoad).rejects.toThrow("stale failure");
    await workspace_graph_store.load("newer");
    rejectStale(new Error("stale failure"));
    await staleFailure;
    expect(get(workspace_graph_store).workspacePath).toBe("newer");
    expect(get(workspace_graph_store).error).toBeNull();
  });

  it("does not replace a broadcast revision with a stale load response", async () => {
    let resolveLoad!: (value: unknown) => void;
    mocks.readGraph.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
    );
    const loading = workspace_graph_store.load("w");
    mocks.graphUpdated?.({ workspacePath: "w", graph: graph("w", 5) });
    resolveLoad(graph("w", 2));
    await loading;
    expect(get(workspace_graph_store).graph?.revision).toBe(5);
  });

  it("uses the newest queued revision and ignores an older response", async () => {
    mocks.readGraph.mockResolvedValue(graph("w", 1));
    await workspace_graph_store.load("w");
    let resolveFirst!: (value: unknown) => void;
    mocks.executeGraphCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const first = workspace_graph_store.execute({
      type: "set-position",
      nodeId: "root",
      x: 1,
      y: 1,
    });
    const second = workspace_graph_store.execute({
      type: "set-position",
      nodeId: "root",
      x: 2,
      y: 2,
    });
    await Promise.resolve();
    await Promise.resolve();
    mocks.graphUpdated?.({ workspacePath: "w", graph: graph("w", 5) });
    mocks.executeGraphCommand.mockResolvedValue({ graph: graph("w", 6), selectedNodeIds: [] });
    resolveFirst({ graph: graph("w", 2), selectedNodeIds: [] });
    await first;
    await second;
    expect(mocks.executeGraphCommand.mock.calls[0][3]).toBe(1);
    expect(mocks.executeGraphCommand.mock.calls[1][3]).toBe(5);
    expect(get(workspace_graph_store).graph?.revision).toBe(6);
  });

  it("allows an editor flush to target its captured workspace after switching", async () => {
    mocks.readGraph.mockImplementation((path: string) =>
      Promise.resolve(graph(path, path === "a" ? 7 : 3))
    );
    await workspace_graph_store.load("a");
    await workspace_graph_store.load("b");
    mocks.executeGraphCommand.mockResolvedValue({ graph: graph("a", 8), selectedNodeIds: [] });
    await workspace_graph_store.execute(
      { type: "set-position", nodeId: "root", x: 1, y: 1 },
      "graph",
      "a"
    );
    expect(mocks.executeGraphCommand).toHaveBeenCalledWith("a", expect.anything(), "graph", 7);
    expect(get(workspace_graph_store).workspacePath).toBe("b");
  });

  it.each(["execute", "undo", "redo"] as const)(
    "ignores stale %s response and error after switching workspace",
    async (kind) => {
      mocks.readGraph.mockImplementation((path: string) => Promise.resolve(graph(path, 1)));
      await workspace_graph_store.load("old");
      let resolveOperation!: (value: unknown) => void;
      let rejectOperation!: (error: Error) => void;
      const deferred = new Promise((resolve, reject) => {
        resolveOperation = resolve;
        rejectOperation = reject;
      });
      const method =
        kind === "execute"
          ? mocks.executeGraphCommand
          : kind === "undo"
            ? mocks.undoGraph
            : mocks.redoGraph;
      method.mockReturnValueOnce(deferred);
      const command = { type: "set-position", nodeId: "root", x: 1, y: 1 } as const;
      const operation =
        kind === "execute"
          ? workspace_graph_store.execute(command)
          : kind === "undo"
            ? workspace_graph_store.undo()
            : workspace_graph_store.redo();
      await workspace_graph_store.load("new");
      resolveOperation({ graph: graph("old", 2), selectedNodeIds: [] });
      await operation;
      expect(get(workspace_graph_store).workspacePath).toBe("new");
      await workspace_graph_store.load("old");
      method.mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectOperation = reject;
        })
      );
      const failed =
        kind === "execute"
          ? workspace_graph_store.execute(command)
          : kind === "undo"
            ? workspace_graph_store.undo()
            : workspace_graph_store.redo();
      await workspace_graph_store.load("new");
      const failure = expect(failed).rejects.toThrow("old failure");
      rejectOperation(new Error("old failure"));
      await failure;
      expect(get(workspace_graph_store).workspacePath).toBe("new");
      expect(get(workspace_graph_store).graph?.workspaceId).toBe("new");
    }
  );

  it("refreshes on revision conflict without replaying the command", async () => {
    mocks.readGraph.mockResolvedValueOnce(graph("w", 1)).mockResolvedValueOnce(graph("w", 3));
    await workspace_graph_store.load("w");
    mocks.executeGraphCommand.mockRejectedValue(new Error("Workspace graph changed"));
    await expect(
      workspace_graph_store.execute({ type: "set-position", nodeId: "root", x: 1, y: 1 })
    ).rejects.toThrow("別の変更が先に保存されました");
    expect(mocks.executeGraphCommand).toHaveBeenCalledTimes(1);
    expect(get(workspace_graph_store).graph?.revision).toBe(3);
    expect(get(workspace_graph_store).error).toContain("changed");
  });
});

describe("workspace graph store save status", () => {
  beforeEach(() => {
    mocks.readGraph.mockReset();
    mocks.executeGraphCommand.mockReset();
    saveStatus.set("idle");
  });

  it("reports writing, then saved after a successful command", async () => {
    mocks.readGraph.mockResolvedValue(graph("ws", 1));
    await workspace_graph_store.load("ws");
    let resolve!: (value: unknown) => void;
    mocks.executeGraphCommand.mockReturnValue(new Promise((r) => (resolve = r)));
    const running = workspace_graph_store.execute(
      { type: "create-node", parentId: "root", node: { name: "A" } },
      "tree"
    );
    await vi.waitFor(() => expect(get(saveStatus)).toBe("writing"));
    resolve({ graph: graph("ws", 2), selectedNodeIds: [] });
    await running;
    expect(get(saveStatus)).toBe("saved");
  });

  it("reports an error when the command fails", async () => {
    mocks.readGraph.mockResolvedValue(graph("ws", 1));
    await workspace_graph_store.load("ws");
    mocks.executeGraphCommand.mockRejectedValue(new Error("disk full"));
    await expect(
      workspace_graph_store.execute(
        { type: "create-node", parentId: "root", node: { name: "A" } },
        "tree"
      )
    ).rejects.toThrow("disk full");
    expect(get(saveStatus)).toBe("error");
  });
});

describe("workspace graph store deltas", () => {
  const node = (id: string, name: string, parentId = "root") => ({
    id,
    name,
    parents: [{ id: parentId, order: 0 }],
    createdAt: "2026-01-01",
  });
  const delta = (
    baseRevision: number,
    revision: number,
    nodes: Record<string, unknown>,
    extra: Record<string, unknown> = {}
  ) => ({
    baseRevision,
    revision,
    nodes,
    fields: {},
    history: { undo: revision, redo: 0 },
    ...extra,
  });

  beforeEach(() => {
    mocks.readGraph.mockReset();
    mocks.executeGraphCommand.mockReset();
    mocks.undoGraph.mockReset();
    mocks.redoGraph.mockReset();
    mocks.reloadWorkspace.mockReset();
  });

  async function loaded(name = "d") {
    mocks.readGraph.mockResolvedValue({
      ...graph(name, 1),
      nodes: { ...graph(name, 1).nodes, a: node("a", "A"), b: node("b", "B") },
    });
    await workspace_graph_store.load(name);
    return name;
  }

  it("applies the delta of a command result to the graph it holds", async () => {
    const path = await loaded();
    const before = get(workspace_graph)!;
    mocks.executeGraphCommand.mockResolvedValue({
      selectedNodeIds: ["c"],
      delta: delta(1, 2, { a: node("a", "Renamed"), b: null, c: node("c", "New") }),
    });
    const result = await workspace_graph_store.execute({
      type: "update-node",
      nodeId: "a",
      changes: {},
    } as never);
    const graphNow = get(workspace_graph)!;
    expect(graphNow.revision).toBe(2);
    expect(Object.keys(graphNow.nodes).sort()).toEqual(["a", "c", "root"]);
    expect(graphNow.nodes.a.name).toBe("Renamed");
    expect(graphNow.history).toEqual({ undo: 2, redo: 0 });
    // 変わっていないノードは、前のグラフと同じオブジェクトのまま。
    expect(graphNow.nodes.root).toBe(before.nodes.root);
    // 呼び出し側は、これまでどおり結果からグラフのリビジョンを読める。
    expect(result.graph?.revision).toBe(2);
    expect(result.selectedNodeIds).toEqual(["c"]);
    expect(get(workspace_graph_store).workspacePath).toBe(path);
  });

  it("applies the inbox and position fields, and removes a field that became null", async () => {
    await loaded();
    mocks.graphUpdated?.({
      workspacePath: "d",
      delta: delta(1, 2, {}, { fields: { inboxId: "a", positions: { a: { x: 1, y: 2 } } } }),
    });
    expect(get(workspace_graph)!.inboxId).toBe("a");
    expect(get(workspace_graph)!.positions).toEqual({ a: { x: 1, y: 2 } });
    mocks.graphUpdated?.({
      workspacePath: "d",
      delta: delta(2, 3, {}, { fields: { inboxId: null, positions: null } }),
    });
    expect(get(workspace_graph)!.inboxId).toBeUndefined();
    expect(get(workspace_graph)!.positions).toBeUndefined();
  });

  it("applies a delta broadcast by another window", async () => {
    await loaded();
    mocks.graphUpdated?.({ workspacePath: "d", delta: delta(1, 2, { a: node("a", "Edited") }) });
    expect(get(workspace_graph)!.nodes.a.name).toBe("Edited");
    expect(get(workspace_graph)!.revision).toBe(2);
  });

  it("ignores a delta it already has, without notifying subscribers", async () => {
    await loaded();
    mocks.graphUpdated?.({ workspacePath: "d", delta: delta(1, 2, { a: node("a", "Edited") }) });
    const current = get(workspace_graph);
    let notifications = 0;
    const unsubscribe = workspace_graph.subscribe(() => notifications++);
    notifications = 0;
    mocks.graphUpdated?.({ workspacePath: "d", delta: delta(1, 2, { a: node("a", "Edited") }) });
    expect(notifications).toBe(0);
    expect(get(workspace_graph)).toBe(current);
    unsubscribe();
  });

  it("reads the whole graph again when a delta skips an update it missed", async () => {
    await loaded();
    mocks.readGraph.mockResolvedValue({
      ...graph("d", 6),
      nodes: { root: graph("d", 6).nodes.root, a: node("a", "Latest") },
    });
    mocks.graphUpdated?.({ workspacePath: "d", delta: delta(5, 6, { a: node("a", "Latest") }) });
    await vi.waitFor(() => expect(get(workspace_graph)!.revision).toBe(6));
    expect(get(workspace_graph)!.nodes.a.name).toBe("Latest");
    expect(mocks.readGraph).toHaveBeenCalledTimes(2);
  });

  it("reads the whole graph again when a command result cannot be applied", async () => {
    await loaded();
    mocks.readGraph.mockResolvedValue({
      ...graph("d", 4),
      nodes: { root: graph("d", 4).nodes.root },
    });
    mocks.executeGraphCommand.mockResolvedValue({
      selectedNodeIds: [],
      delta: delta(3, 4, { a: null }),
    });
    const result = await workspace_graph_store.execute({
      type: "delete-node",
      nodeId: "a",
    } as never);
    expect(result.graph?.revision).toBe(4);
    expect(get(workspace_graph)!.revision).toBe(4);
  });

  it("does not apply a delta while the workspace is still loading", async () => {
    let resolveLoad!: (value: unknown) => void;
    mocks.readGraph.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
    );
    const loading = workspace_graph_store.load("w");
    mocks.graphUpdated?.({ workspacePath: "w", delta: delta(1, 2, { a: node("a", "Early") }) });
    resolveLoad(graph("w", 2));
    await loading;
    expect(get(workspace_graph)!.nodes.a).toBeUndefined();
    expect(mocks.readGraph).toHaveBeenCalledTimes(1);
  });

  it("applies the delta of an undo, and keeps the graph when there was nothing to undo", async () => {
    await loaded();
    mocks.undoGraph.mockResolvedValueOnce({
      changed: true,
      delta: delta(1, 2, { a: node("a", "Before") }, { history: { undo: 0, redo: 1 } }),
    });
    await workspace_graph_store.undo({ quiet: true });
    expect(get(workspace_graph)!.nodes.a.name).toBe("Before");
    expect(get(workspace_graph)!.history).toEqual({ undo: 0, redo: 1 });
    const current = get(workspace_graph);
    mocks.undoGraph.mockResolvedValueOnce({ changed: false, delta: null });
    await workspace_graph_store.undo({ quiet: true });
    expect(get(workspace_graph)).toBe(current);
  });

  it("replaces the graph with the one read again from the disk", async () => {
    await loaded();
    const reloaded = {
      ...graph("d", 5),
      nodes: { root: graph("d", 5).nodes.root, z: node("z", "From disk") },
    };
    mocks.reloadWorkspace.mockResolvedValue(reloaded);
    await workspace_graph_store.reload("d");
    expect(get(workspace_graph)).toBe(reloaded);
  });
});

describe("workspace graph store bodies", () => {
  const node = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    parents: [{ id: "root", order: 0 }],
    createdAt: "2026-01-01",
    ...extra,
  });
  const bodies = { a: { body: "from disk", format: "markdown" } };

  async function loaded(name: string) {
    mocks.readGraph.mockResolvedValue({
      ...graph(name, 1),
      nodes: { ...graph(name, 1).nodes, a: node("a", { bodyLoaded: false }) },
    });
    await workspace_graph_store.load(name);
  }

  beforeEach(() => {
    mocks.readGraph.mockReset();
    mocks.readAllBodies.mockReset();
    mocks.reloadWorkspace.mockReset();
    mocks.readAllBodies.mockResolvedValue(bodies);
    filter.set({});
  });

  it("reads every body once, and keeps them until the workspace is loaded again", async () => {
    await loaded("bodies-1");
    expect(get(node_bodies)).toEqual({});
    await ensureAllBodies();
    await ensureAllBodies();
    expect(mocks.readAllBodies).toHaveBeenCalledTimes(1);
    expect(mocks.readAllBodies).toHaveBeenCalledWith("bodies-1");
    expect(get(node_bodies)).toEqual(bodies);
    const epoch = get(bodies_epoch);
    await loaded("bodies-2");
    expect(get(node_bodies)).toEqual({});
    expect(get(bodies_epoch)).toBeGreaterThan(epoch);
  });

  it("reads every body when the body search is turned on", async () => {
    await loaded("bodies-3");
    filter.set({ search_memo: ["1"] });
    await vi.waitFor(() => expect(get(node_bodies)).toEqual(bodies));
    expect(mocks.readAllBodies).toHaveBeenCalledTimes(1);
  });

  it("forgets the body it read for a node whose edit brings the body", async () => {
    await loaded("bodies-4");
    await ensureAllBodies();
    mocks.executeGraphCommand.mockResolvedValue({
      delta: {
        baseRevision: 1,
        revision: 2,
        nodes: { a: node("a", { body: "edited" }) },
        fields: {},
        history: { undo: 1, redo: 0 },
      },
    });
    await workspace_graph_store.execute({ type: "update-node", nodeId: "a", changes: {} } as never);
    expect(get(node_bodies)).toEqual({});
    expect(get(workspace_graph)!.nodes.a.body).toBe("edited");
  });

  it("reads again when a node without a body appears while the body search is on", async () => {
    await loaded("bodies-5");
    filter.set({ search_memo: ["1"] });
    await vi.waitFor(() => expect(mocks.readAllBodies).toHaveBeenCalledTimes(1));
    mocks.graphUpdated?.({
      workspacePath: "bodies-5",
      delta: {
        baseRevision: 1,
        revision: 2,
        nodes: { b: node("b", { bodyLoaded: false }) },
        fields: {},
        history: { undo: 1, redo: 0 },
      },
    });
    await vi.waitFor(() => expect(mocks.readAllBodies).toHaveBeenCalledTimes(2));
  });

  it("drops the bodies it read when the workspace is read again from the disk", async () => {
    await loaded("bodies-6");
    await ensureAllBodies();
    mocks.reloadWorkspace.mockResolvedValue(graph("bodies-6", 5));
    await workspace_graph_store.reload("bodies-6");
    expect(get(node_bodies)).toEqual({});
  });
});
