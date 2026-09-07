import graphEngine from "../../electron/workspace-graph-engine.js";

const { executeGraphCommand, reachableFromRoot, validateGraph } = graphEngine;

function node(id, parents = []) {
  return {
    id,
    name: id,
    parents: parents.map((parent, order) => ({ id: parent, order })),
    createdAt: "2026-01-01",
  };
}

function graph(nodes) {
  return {
    schemaVersion: 1,
    workspaceId: "w",
    rootId: "root",
    revision: 0,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}

describe("workspace graph commands", () => {
  it("repairs a disconnected cyclic component after detaching its root entry", () => {
    const input = graph([
      node("root"),
      node("a", ["root", "c"]),
      node("b", ["a"]),
      node("c", ["b"]),
    ]);
    const { graph: next } = executeGraphCommand(input, {
      type: "detach",
      childId: "a",
      parentId: "root",
    });
    expect(reachableFromRoot(next).size).toBe(4);
    expect(next.nodes.a.parents.some((p) => p.id === "root")).toBe(true);
    expect(next.nodes.a.parents.some((p) => p.id === "c")).toBe(true);
  });

  it("deletes only one node and incident links, preserving a shared child", () => {
    const input = graph([
      node("root"),
      node("a", ["root"]),
      node("b", ["root"]),
      node("child", ["a", "b"]),
    ]);
    const { graph: next } = executeGraphCommand(input, { type: "delete-node", nodeId: "a" });
    expect(next.nodes.a).toBeUndefined();
    expect(next.nodes.child.parents.map((p) => p.id)).toEqual(["b"]);
  });

  it("allows graph cycles but rejects them from tree and finder", () => {
    const input = graph([node("root"), node("a", ["root"]), node("b", ["a"])]);
    expect(() =>
      executeGraphCommand(input, { type: "link", childId: "a", parentId: "b" }, "tree")
    ).toThrow(/cycle/);
    const result = executeGraphCommand(
      input,
      { type: "link", childId: "a", parentId: "b" },
      "graph"
    );
    expect(result.graph.nodes.a.parents.map((p) => p.id)).toEqual(["root", "b"]);
  });

  it("rejects self, duplicate, and destructive root changes", () => {
    const input = graph([node("root"), node("a", ["root"])]);
    expect(() => executeGraphCommand(input, { type: "link", childId: "a", parentId: "a" })).toThrow(
      /Self/
    );
    expect(() =>
      executeGraphCommand(input, { type: "link", childId: "a", parentId: "root" })
    ).toThrow(/Duplicate/);
    expect(() => executeGraphCommand(input, { type: "delete-node", nodeId: "root" })).toThrow(
      /protected/
    );
  });

  it("implements all copy modes", () => {
    const input = graph([
      node("root"),
      node("target", ["root"]),
      node("a", ["root", "b"]),
      node("b", ["a"]),
      node("external", ["b"]),
    ]);
    const nodeCopy = executeGraphCommand(input, {
      type: "copy",
      nodeId: "a",
      targetParentId: "target",
      mode: "node",
    });
    const nodeId = nodeCopy.selectedNodeIds[0];
    expect(nodeCopy.graph.nodes[nodeId].parents.map((p) => p.id)).toEqual(["target"]);
    expect(
      Object.values(nodeCopy.graph.nodes).filter((n) => n.parents.some((p) => p.id === nodeId))
    ).toHaveLength(0);

    const shared = executeGraphCommand(input, {
      type: "copy",
      nodeId: "a",
      targetParentId: "target",
      mode: "share-children",
    });
    const sharedId = shared.selectedNodeIds[0];
    expect(shared.graph.nodes.b.parents.some((p) => p.id === sharedId)).toBe(true);

    const copied = executeGraphCommand(input, {
      type: "copy",
      nodeId: "a",
      targetParentId: "target",
      mode: "subgraph",
    });
    expect(copied.selectedNodeIds).toHaveLength(3);
    const clones = copied.selectedNodeIds.map((id) => copied.graph.nodes[id]);
    expect(
      clones.every((n) =>
        n.parents.every((p) => p.id === "target" || copied.selectedNodeIds.includes(p.id))
      )
    ).toBe(true);
    validateGraph(copied.graph);
  });

  it("moves only the requested incoming edge and keeps descendants", () => {
    const input = graph([
      node("root"),
      node("a", ["root"]),
      node("other", ["root"]),
      node("target", ["root"]),
      node("child", ["a"]),
    ]);
    input.nodes.a.parents.push({ id: "other", order: 7 });
    const { graph: next } = executeGraphCommand(
      input,
      { type: "move", childId: "a", fromParentId: "root", toParentId: "target", order: 3 },
      "tree"
    );
    expect(next.nodes.a.parents).toEqual([
      { id: "other", order: 7 },
      { id: "target", order: 3 },
    ]);
    expect(next.nodes.child.parents).toEqual([{ id: "a", order: 0 }]);
  });

  it("repairs every source needed when alphabetical entry cannot reach its component", () => {
    const input = graph([
      node("root"),
      node("anchor", ["root"]),
      node("a", ["anchor", "z"]),
      node("z", ["a"]),
    ]);
    const { graph: next } = executeGraphCommand(input, {
      type: "detach",
      childId: "a",
      parentId: "anchor",
    });
    expect(reachableFromRoot(next).size).toBe(4);
  });

  it("copies a cyclic diamond exactly once per id and preserves the back edge", () => {
    const input = graph([
      node("root"),
      node("target", ["root"]),
      node("a", ["root", "d"]),
      node("b", ["a"]),
      node("c", ["a"]),
      node("d", ["b", "c"]),
    ]);
    const result = executeGraphCommand(
      input,
      { type: "copy", nodeId: "a", targetParentId: "target", mode: "subgraph" },
      "graph"
    );
    expect(result.selectedNodeIds).toHaveLength(4);
    const clones = result.selectedNodeIds.map((id) => result.graph.nodes[id]);
    const rootClone = clones.find((n) => n.parents.some((p) => p.id === "target"));
    const diamondClone = clones.find(
      (n) => n.parents.length === 2 && !n.parents.some((p) => p.id === "target")
    );
    expect(diamondClone).toBeTruthy();
    expect(rootClone.parents.some((p) => p.id === diamondClone.id)).toBe(true);
  });

  it("rejects cyclic subgraph and share-children copies outside graph view", () => {
    const cyclic = graph([node("root"), node("a", ["root", "b"]), node("b", ["a"])]);
    expect(() =>
      executeGraphCommand(
        cyclic,
        { type: "copy", nodeId: "a", targetParentId: "root", mode: "subgraph" },
        "finder"
      )
    ).toThrow(/cyclic/);
    const shareCycle = graph([
      node("root"),
      node("source", ["root"]),
      node("child", ["source"]),
      node("target", ["child"]),
    ]);
    expect(() =>
      executeGraphCommand(
        shareCycle,
        { type: "copy", nodeId: "source", targetParentId: "target", mode: "share-children" },
        "tree"
      )
    ).toThrow(/cycle/);
  });

  it("validates real dates, ordering, status and root protection", () => {
    const input = graph([node("root"), node("a", ["root"])]);
    expect(() =>
      executeGraphCommand(input, {
        type: "update-node",
        nodeId: "a",
        changes: { startDate: "2026-02-31" },
      })
    ).toThrow(/date/);
    expect(() =>
      executeGraphCommand(input, {
        type: "update-node",
        nodeId: "a",
        changes: { startDate: "2026-03-02", dueDate: "2026-03-01" },
      })
    ).toThrow(/after/);
    expect(() =>
      executeGraphCommand(input, { type: "update-node", nodeId: "a", changes: { status: "Bogus" } })
    ).toThrow(/status/);
    expect(() =>
      executeGraphCommand(input, { type: "link", childId: "root", parentId: "a" })
    ).toThrow(/root/);
    expect(() =>
      executeGraphCommand(input, {
        type: "move",
        childId: "root",
        fromParentId: "a",
        toParentId: "a",
      })
    ).toThrow();
    expect(() =>
      executeGraphCommand(input, { type: "detach", childId: "root", parentId: "a" })
    ).toThrow(/protected/);
    expect(() =>
      executeGraphCommand(input, {
        type: "copy",
        nodeId: "root",
        targetParentId: "a",
        mode: "node",
      })
    ).toThrow(/cannot be copied/);
    expect(() =>
      executeGraphCommand(input, {
        type: "update-node",
        nodeId: "root",
        changes: { archived: true },
      })
    ).toThrow(/protected/);
    expect(
      executeGraphCommand(input, {
        type: "create-node",
        parentId: "root",
        node: { name: "Created", status: "Undefined" },
      }).selectedNodeIds
    ).toHaveLength(1);
  });
});
