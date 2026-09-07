import { describe, expect, it } from "vitest";
import { projectFinderRows, projectGraphTree } from "@features/workspace/utils/graph_projection";

const node = (id: string, parents: { id: string; order?: number }[]) => ({
  id,
  name: id,
  parents,
  createdAt: "2026-01-01",
});
const graph = (nodes: Record<string, ReturnType<typeof node>>) => ({
  schemaVersion: 1 as const,
  workspaceId: "w",
  rootId: "root",
  revision: 0,
  nodes,
});

describe("graph projection", () => {
  it("preserves parent order and emits diamond occurrences", () => {
    const result = projectGraphTree(
      graph({
        root: node("root", []),
        a: node("a", [{ id: "root", order: 2 }]),
        b: node("b", [{ id: "root", order: 1 }]),
        shared: node("shared", [{ id: "a" }, { id: "b" }]),
      })
    );
    expect(result.slice(0, 3).map((row) => row.nodeId)).toEqual(["root", "b", "shared"]);
    expect(result.filter((row) => row.nodeId === "shared").map((row) => row.occurrenceId)).toEqual([
      "root/b/shared",
      "root/a/shared",
    ]);
  });

  it("marks cycles and stops traversing their descendants", () => {
    const result = projectGraphTree(
      graph({
        root: node("root", []),
        a: node("a", [{ id: "root" }, { id: "b" }]),
        b: node("b", [{ id: "a" }]),
      })
    );
    const cycle = result.find((row) => row.nodeId === "a" && row.cycleReference);
    expect(cycle?.expandable).toBe(false);
    expect(result.some((row) => row.occurrenceId === "root/a/b/a")).toBe(true);
  });

  it("does not expand collapsed paths and reports truncation", () => {
    const g = graph({
      root: node("root", []),
      a: node("a", [{ id: "root" }]),
      b: node("b", [{ id: "a" }]),
    });
    expect(
      projectGraphTree(g, { expandedPaths: new Set(["root"]) }).map((row) => row.nodeId)
    ).toEqual(["root", "a"]);
    const limited = projectGraphTree(g, { maxRows: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.truncated).toBe(true);
  });

  it("projects finder rows with deterministic order", () => {
    const rows = projectFinderRows(
      graph({
        root: node("root", []),
        z: node("z", [{ id: "root" }]),
        a: node("a", [{ id: "root" }]),
      }),
      "root"
    );
    expect(rows.map((row) => row.nodeId)).toEqual(["a", "z"]);
  });
});
