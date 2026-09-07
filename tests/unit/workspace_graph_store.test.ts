import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspace_graph_store } from "@features/workspace/stores/graph";

const mocks = vi.hoisted(() => ({
  readGraph: vi.fn(),
  executeGraphCommand: vi.fn(),
  undoGraph: vi.fn(),
  redoGraph: vi.fn(),
  graphUpdated: undefined as
    | ((event: { workspacePath: string; graph: unknown }) => void)
    | undefined,
}));

vi.mock("@lib/ipc/platform", () => ({
  wsReadGraph: (...args: unknown[]) => mocks.readGraph(...args),
  wsExecuteGraphCommand: (...args: unknown[]) => mocks.executeGraphCommand(...args),
  wsUndoGraph: (...args: unknown[]) => mocks.undoGraph(...args),
  wsRedoGraph: (...args: unknown[]) => mocks.redoGraph(...args),
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
    ).rejects.toThrow("changed");
    expect(mocks.executeGraphCommand).toHaveBeenCalledTimes(1);
    expect(get(workspace_graph_store).graph?.revision).toBe(3);
    expect(get(workspace_graph_store).error).toContain("changed");
  });
});
