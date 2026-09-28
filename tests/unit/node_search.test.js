import { describe, expect, test } from "vitest";
import {
  descendantIds,
  nodePathLabels,
  rankCandidates,
} from "../../src/features/tasks/utils/node_search";

describe("node_search", () => {
  const list = [
    { id: "root", name: "Workspace", path: "" },
    { id: "work", name: "Work", path: "Workspace" },
    { id: "spec", name: "Spec", path: "Workspace / Work" },
    { id: "net", name: "Network", path: "Workspace / Home" },
  ];

  test("ranks earlier and closer matches first and drops non-matches", () => {
    expect(rankCandidates(list, "wor").map((c) => c.id)).toEqual(["work", "root", "spec", "net"]);
    // 文字が順に含まれていれば拾う（Workspace も s-p-c を含む）が、名前の一致が上。
    expect(rankCandidates(list, "spc")[0].id).toBe("spec");
    expect(rankCandidates(list, "zzz")).toEqual([]);
  });

  test("excludes ids and returns everything for an empty query", () => {
    expect(rankCandidates(list, "", ["root"]).map((c) => c.id)).toEqual(["work", "spec", "net"]);
  });

  test("descendantIds follows every parent edge", () => {
    const records = {
      a: { id: "a", parents: [] },
      b: { id: "b", parents: [{ id: "a" }] },
      c: { id: "c", parents: [{ id: "b" }, { id: "x" }] },
      x: { id: "x", parents: [] },
    };
    expect([...descendantIds(records, "a")].sort()).toEqual(["b", "c"]);
    expect([...descendantIds(records, "x")]).toEqual(["c"]);
  });

  test("nodePathLabels summarises nodes reached by several paths", () => {
    const tree = {
      id: "root",
      data: { name: "W" },
      children: [
        {
          id: "a",
          data: { name: "A" },
          children: [{ id: "s", data: { name: "S" }, children: [] }],
        },
        {
          id: "b",
          data: { name: "B" },
          children: [{ id: "s", data: { name: "S" }, children: [] }],
        },
      ],
    };
    expect(nodePathLabels(tree)).toMatchObject({ a: "W", s: "W / A 他 1 件" });
  });
});
