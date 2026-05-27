import { describe, expect, test } from "vitest";
import {
  archiveNode,
  bulkArchiveNodes,
  bulkRestoreNodes,
  flattenVisibleTree,
  restoreNode,
  stripArchivedNodes,
  type TreeData,
} from "@features/tasks/utils/tree_control";

function nodeData(name: string) {
  return {
    name,
    status: "Open" as const,
    "start date": undefined,
    "due date": undefined,
    memo: [],
  };
}

function makeTree(): TreeData {
  return {
    id: "root",
    data: nodeData("Root"),
    children: [
      {
        id: "a",
        data: nodeData("A"),
        children: [
          { id: "a1", data: nodeData("A1"), children: [] },
          { id: "a2", data: nodeData("A2"), children: [] },
        ],
      },
      { id: "b", data: nodeData("B"), children: [] },
      { id: "c", data: nodeData("C"), children: [] },
    ],
  };
}

describe("archive / restore tree helpers", () => {
  test("archiveNode は対象に archived=true と archivedAt を立てる", () => {
    const tree = makeTree();
    archiveNode("a1", tree);
    const a = tree.children.find((c) => c.id === "a")!;
    const a1 = a.children.find((c) => c.id === "a1")!;
    expect(a1.archived).toBe(true);
    expect(a1.archivedAt).toEqual(expect.any(String));
  });

  test("archiveNode はルートには作用しない", () => {
    const tree = makeTree();
    archiveNode("root", tree);
    expect(tree.archived).toBeUndefined();
  });

  test("archiveNode は既に archived のノードは触らない（archivedAt を上書きしない）", () => {
    const tree = makeTree();
    archiveNode("b", tree);
    const beforeAt = tree.children.find((c) => c.id === "b")!.archivedAt;
    archiveNode("b", tree);
    const afterAt = tree.children.find((c) => c.id === "b")!.archivedAt;
    expect(afterAt).toBe(beforeAt);
  });

  test("restoreNode は archived を外し、親 children 配列の末尾へ移動する", () => {
    const tree = makeTree();
    // a を archive。children: [a(archived), b, c]
    archiveNode("a", tree);
    expect(tree.children[0].archived).toBe(true);
    // restore すると a は末尾へ。children: [b, c, a]
    restoreNode("a", tree);
    expect(tree.children.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(tree.children[2].archived).toBeUndefined();
    expect(tree.children[2].archivedAt).toBeUndefined();
  });

  test("restoreNode は archived でないノードに対しては no-op", () => {
    const tree = makeTree();
    const before = tree.children.map((c) => c.id);
    restoreNode("b", tree);
    expect(tree.children.map((c) => c.id)).toEqual(before);
  });

  test("bulkArchiveNodes は複数ノードに同じ archivedAt を一括で立てる", () => {
    const tree = makeTree();
    bulkArchiveNodes(tree, new Set(["a", "b"]));
    const a = tree.children.find((c) => c.id === "a")!;
    const b = tree.children.find((c) => c.id === "b")!;
    expect(a.archived).toBe(true);
    expect(b.archived).toBe(true);
    expect(a.archivedAt).toBe(b.archivedAt);
  });

  test("bulkRestoreNodes は対象を末尾へ寄せ、archived を外す", () => {
    const tree = makeTree();
    bulkArchiveNodes(tree, new Set(["a", "b"]));
    bulkRestoreNodes(tree, new Set(["a", "b"]));
    // 残った c は元の位置にいた → restore 順に末尾へ並ぶ
    expect(tree.children[0].id).toBe("c");
    expect(tree.children.find((c) => c.id === "a")!.archived).toBeUndefined();
    expect(tree.children.find((c) => c.id === "b")!.archived).toBeUndefined();
  });

  test("flattenVisibleTree は archived とその子孫を既定で除外する", () => {
    const tree = makeTree();
    archiveNode("a", tree);
    const rows = flattenVisibleTree(tree, new Set());
    // root, b, c のみ可視（a は archived 配下なので a1/a2 もスキップ）
    expect(rows.map((r) => r.id)).toEqual(["root", "b", "c"]);
  });

  test("flattenVisibleTree は includeArchived=true で archived も並べる", () => {
    const tree = makeTree();
    archiveNode("a", tree);
    const rows = flattenVisibleTree(tree, new Set(), true);
    expect(rows.map((r) => r.id)).toEqual(["root", "a", "a1", "a2", "b", "c"]);
  });

  test("stripArchivedNodes は archived の子孫を完全に取り除いた新ツリーを返す", () => {
    const tree = makeTree();
    archiveNode("a", tree);
    const stripped = stripArchivedNodes(tree);
    // 元のツリーは変えない
    expect(tree.children.find((c) => c.id === "a")).toBeDefined();
    // 新ツリーには a が居ない
    expect(stripped.children.map((c) => c.id)).toEqual(["b", "c"]);
  });

  test("親が archived のとき、子の独立した archived 状態は表示には影響しない", () => {
    const tree = makeTree();
    archiveNode("a1", tree);
    archiveNode("a", tree);
    const rowsHidden = flattenVisibleTree(tree, new Set());
    expect(rowsHidden.map((r) => r.id)).toEqual(["root", "b", "c"]);
    const rowsShown = flattenVisibleTree(tree, new Set(), true);
    // includeArchived=true なら子孫も含めてすべて見える
    expect(rowsShown.map((r) => r.id)).toEqual(["root", "a", "a1", "a2", "b", "c"]);
  });

  test("restoreNode で親を復元しても、独立 archived な子は archived のまま", () => {
    const tree = makeTree();
    archiveNode("a1", tree);
    archiveNode("a", tree);
    restoreNode("a", tree);
    const a = tree.children.find((c) => c.id === "a")!;
    expect(a.archived).toBeUndefined();
    const a1 = a.children.find((c) => c.id === "a1")!;
    expect(a1.archived).toBe(true);
  });
});
