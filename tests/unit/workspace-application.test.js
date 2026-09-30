import { describe, it, expect, vi } from "vitest";
import applicationModule from "../../electron/workspace-application.js";
import engine from "../../electron/workspace-graph-engine.js";
const fixture = () => ({
  schemaVersion: 1,
  workspaceId: "test",
  rootId: "root",
  revision: 3,
  nodes: {
    root: { id: "root", name: "Root", parents: [] },
    a: { id: "a", name: "A", parents: [{ id: "root", order: 0 }] },
    b: { id: "b", name: "B", parents: [{ id: "a", order: 0 }] },
  },
});
describe("Canonical workspace application", () => {
  it("opens non-image assets only after authorization and repository path validation", async () => {
    const events = [];
    const resolveNodeAsset = vi.fn(async () => {
      events.push("resolve");
      return "validated/report.txt";
    });
    const app = applicationModule.createWorkspaceApplication({
      authorize: async () => events.push("authorize"),
      initialize: async () => events.push("initialize"),
      repository: { resolveNodeAsset },
      publish: vi.fn(),
      openAsset: async (path, picker) => events.push([path, picker]),
    });
    await app.openAsset({
      workspacePath: "w",
      nodeId: "a",
      relativePath: "assets/report.txt",
      chooseProgram: true,
    });
    expect(events).toEqual(["authorize", "initialize", "resolve", ["validated/report.txt", true]]);
    events.length = 0;
    resolveNodeAsset.mockRejectedValueOnce(new Error("Unsafe asset path"));
    await expect(
      app.openAsset({ workspacePath: "w", nodeId: "a", relativePath: "../outside" })
    ).rejects.toThrow("Unsafe");
    expect(events).toEqual(["authorize", "initialize"]);
  });
  it("authorizes and initializes before dispatch and publishes only committed results", async () => {
    const events = [];
    const app = applicationModule.createWorkspaceApplication({
      authorize: async () => events.push("authorize"),
      initialize: async () => events.push("initialize"),
      repository: {
        executeWorkspaceGraphCommand: vi.fn(async (path, command, origin, revision) => {
          events.push([command.type, origin, revision]);
          return { selectedNodeIds: [], delta: { baseRevision: 3, revision: 4 }, graph: fixture() };
        }),
      },
      publish: () => events.push("publish"),
    });
    await app.execute({
      workspacePath: "w",
      command: { type: "update-node" },
      expectedRevision: 3,
    });
    expect(events).toEqual(["authorize", "initialize", ["update-node", "tree", 3], "publish"]);
  });
  it("tells publish who asked, so the requester is not sent the same graph twice", async () => {
    const publish = vi.fn();
    const requester = { id: "window-1" };
    const app = applicationModule.createWorkspaceApplication({
      authorize: async () => {},
      initialize: async () => {},
      repository: {
        executeWorkspaceGraphCommand: vi.fn(async () => ({
          selectedNodeIds: [],
          delta: { revision: 4 },
          graph: fixture(),
        })),
      },
      publish,
    });
    await app.execute({ workspacePath: "w", command: { type: "update-node" }, requester });
    expect(publish).toHaveBeenCalledWith("w", expect.anything(), requester);
  });
  it("returns and publishes only the delta, never the whole graph", async () => {
    const delta = { baseRevision: 3, revision: 4, nodes: { a: null } };
    const publish = vi.fn();
    const app = applicationModule.createWorkspaceApplication({
      authorize: async () => {},
      initialize: async () => {},
      repository: {
        executeWorkspaceGraphCommand: vi.fn(async () => ({
          selectedNodeIds: ["a"],
          delta,
          graph: fixture(),
        })),
        undoWorkspaceGraph: vi.fn(async () => ({ changed: true, delta, graph: fixture() })),
      },
      publish,
    });
    const result = await app.execute({ workspacePath: "w", command: { type: "delete-node" } });
    expect(result).toEqual({ selectedNodeIds: ["a"], delta });
    expect(publish).toHaveBeenLastCalledWith("w", { delta }, undefined);
    const undone = await app.history({ workspacePath: "w", direction: "undo" });
    expect(undone).toEqual({ changed: true, delta });
    expect(publish).toHaveBeenLastCalledWith("w", { delta }, undefined);
  });
  it("does not publish an undo that changed nothing", async () => {
    const publish = vi.fn();
    const app = applicationModule.createWorkspaceApplication({
      authorize: async () => {},
      initialize: async () => {},
      repository: { undoWorkspaceGraph: vi.fn(async () => ({ changed: false, delta: null })) },
      publish,
    });
    expect(await app.history({ workspacePath: "w", direction: "undo" })).toEqual({
      changed: false,
      delta: null,
    });
    expect(publish).not.toHaveBeenCalled();
  });
  it("reloads after authorization and sends the whole graph to the other windows", async () => {
    const events = [];
    const graph = fixture();
    const app = applicationModule.createWorkspaceApplication({
      authorize: async () => events.push("authorize"),
      initialize: async () => events.push("initialize"),
      repository: { reloadWorkspaceGraph: vi.fn(async () => graph) },
      publish: (path, payload) => events.push(["publish", payload]),
    });
    expect(await app.reload({ workspacePath: "w" })).toBe(graph);
    expect(events).toEqual(["authorize", ["publish", { graph }]]);
  });
  it("does not dispatch an unauthorized request", async () => {
    const initialize = vi.fn(),
      publish = vi.fn();
    const app = applicationModule.createWorkspaceApplication({
      authorize: async () => {
        throw Error("denied");
      },
      initialize,
      repository: {},
      publish,
    });
    await expect(app.execute({ workspacePath: "w" })).rejects.toThrow("denied");
    expect(initialize).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
  it("rejects an invalid batch without changing any node", () => {
    const input = fixture();
    expect(() =>
      engine.executeGraphCommand(
        input,
        {
          type: "batch",
          commands: [
            { type: "update-node", nodeId: "a", changes: { name: "changed" } },
            { type: "link", childId: "a", parentId: "a" },
          ],
        },
        "tree"
      )
    ).toThrow(/Self/);
    expect(input.nodes.a.name).toBe("A");
    expect(input.revision).toBe(3);
  });
  it("commits a batch at one revision and supports cycles from TreeGrid", () => {
    const result = engine.executeGraphCommand(
      fixture(),
      {
        type: "batch",
        commands: [
          { type: "update-node", nodeId: "a", changes: { name: "changed" } },
          { type: "link", childId: "a", parentId: "b" },
        ],
      },
      "tree"
    );
    expect(result.graph.revision).toBe(4);
    expect(result.graph.nodes.a.parents.map((p) => p.id)).toEqual(["root", "b"]);
  });
});
