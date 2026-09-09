import { describe, it, expect } from "vitest";
import {
  projectTreeGrid,
  nodeChanges,
} from "../../src/features/workspace/application/tree_projection";
import { flattenVisibleTree, filterTree } from "../../src/features/tasks/utils/tree_control";

const node = (id, parents = [], extra = {}) => ({
  id,
  name: id,
  parents: parents.map((id) => ({ id, order: 0 })),
  ...extra,
});
function fixture() {
  const nodes = [
    node("root"),
    node("a", ["root"]),
    node("b", ["root"]),
    node("shared", ["a", "b", "child"], { tags: ["design"] }),
    node("child", ["shared"]),
  ];
  return {
    schemaVersion: 1,
    rootId: "root",
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}
describe("Graph adapter for the existing TreeGrid", () => {
  it("filters tags with OR semantics and supports untagged nodes", () => {
    const projection = projectTreeGrid(
      {
        rootId: "root",
        nodes: {
          root: node("root"),
          a: node("a", ["root"], { tags: ["design"] }),
          b: node("b", ["root"], { tags: ["build"] }),
          c: node("c", ["root"]),
        },
      },
      "root"
    );
    expect(
      filterTree(projection.data, { tags: ["DESIGN", "build"] }).children.map((n) => n.id)
    ).toEqual(["a", "b"]);
    expect(filterTree(projection.data, { tags: [""] }).children.map((n) => n.id)).toEqual(["c"]);
  });
  it("preserves identity while providing separate occurrences and terminal cycles", () => {
    const graph = fixture();
    const projection = projectTreeGrid(graph, "root");
    const rows = flattenVisibleTree(projection.data, new Set());
    expect(rows.filter((r) => r.id === "shared")).toHaveLength(4);
    const terminal = rows.filter((r) => r.node.cycleReference);
    expect(terminal).toHaveLength(2);
    expect(terminal.every((r) => !r.hasChildren)).toBe(true);
    expect(new Set(rows.map((r) => r.path)).size).toBe(rows.length);
    projection.data.children[0].data.name = "disposable view edit";
    expect(graph.nodes.a.name).toBe("a");
  });
  it("limits search and projection to the selected scope", () => {
    const project = projectTreeGrid(fixture(), "a");
    expect(flattenVisibleTree(project.data, new Set()).some((r) => r.id === "b")).toBe(false);
    const filtered = filterTree(project.data, { full_text: ["shared"] });
    expect(flattenVisibleTree(filtered, new Set()).some((r) => r.id === "shared")).toBe(true);
  });
  it("preserves explicit Undefined separately from omitted status and maps cleared dates", () => {
    expect(nodeChanges({ status: "Undefined", "due date": "2026-09-08" })).toEqual({
      status: "Undefined",
      dueDate: "2026-09-08",
    });
    expect(nodeChanges({ status: "", "due date": "", parents: ["x"], id: "x" })).toEqual({
      status: undefined,
      dueDate: undefined,
    });
  });
});
