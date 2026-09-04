import { describe, expect, it } from "vitest";
import { workspaceToProjectData } from "../../src/features/workspace/utils/workspace_tree";
import {
  bulkRemoveNodes,
  flattenVisibleTree,
  getNode,
  reattachOrphans,
  rmNode,
  updateNodeDataById,
  type TreeData,
} from "../../src/features/tasks/utils/tree_control";
import type { WorkspaceTask } from "../../src/types/workspace";

/**
 * ノードは必ず 1 つ以上の親を持つ、という前提を壊さないための守り。
 * 孤児（ルートから辿れないノード）は木に現れず、保存はツリーを辿って書き出す
 * ので、そのままだとファイルごと消える。
 */

const T = (id: string, name: string, parents: string[]) =>
  ({
    id,
    name,
    status: "Open",
    parents,
    memos: [],
    createdAt: "2026-09-04",
  }) as WorkspaceTask;

const N = (id: string, children: TreeData[] = []): TreeData => ({
  id,
  data: { name: id, status: "Open", "start date": undefined, "due date": undefined, memo: [] },
  children,
});

describe("読み込み時の孤児の受け皿", () => {
  it("存在しない親を指すタスクはルート直下に出る", () => {
    const tasks = {
      root: T("root", "プロジェクト", []),
      A: T("A", "生きている", ["root"]),
      X: T("X", "迷子", ["消えた親"]),
    };
    const rows = flattenVisibleTree(workspaceToProjectData(tasks, "root").data, new Set(), false);

    expect(rows.map((r) => r.path)).toEqual(["root", "root/A", "root/X"]);
  });

  it("ルートに繋がらない循環も丸ごと拾う", () => {
    const tasks = {
      root: T("root", "プロジェクト", []),
      X: T("X", "X", ["Y"]),
      Y: T("Y", "Y", ["X"]),
    };
    const rows = flattenVisibleTree(workspaceToProjectData(tasks, "root").data, new Set(), false);

    // どこかで打ち切られるが、両方とも木の中に現れる（＝保存で消えない）。
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(["root", "X", "Y"]));
  });

  it("辿れるタスクを勝手にルート直下へ動かさない", () => {
    const tasks = {
      root: T("root", "プロジェクト", []),
      A: T("A", "A", ["root"]),
      B: T("B", "B", ["A"]),
    };
    const rows = flattenVisibleTree(workspaceToProjectData(tasks, "root").data, new Set(), false);

    expect(rows.map((r) => r.path)).toEqual(["root", "root/A", "root/A/B"]);
  });
});

describe("削除時の孤児の付け直し", () => {
  it("唯一の親を消された子はルート直下へ移る", () => {
    const child = N("C");
    const root = N("root", [N("A", [child])]);
    const removed = getNode("A", root)!;

    rmNode("A", root);
    expect(reattachOrphans(root, [removed])).toEqual(["C"]);
    expect(root.children.map((c) => c.id)).toEqual(["C"]);
  });

  it("他にも親があるノードは動かさない（切れたのは辺 1 本）", () => {
    const shared = N("C");
    const root = N("root", [N("A", [shared]), N("B", [shared])]);
    const removed = getNode("A", root)!;

    rmNode("A", root);
    expect(reattachOrphans(root, [removed])).toEqual([]);
    expect(root.children.map((c) => c.id)).toEqual(["B"]);
    expect(root.children[0].children[0]).toBe(shared);
  });

  it("一緒に消したノード同士は拾わない", () => {
    const root = N("root", [N("A", [N("B", [N("C")])])]);
    const removedNodes = ["A", "B"].map((id) => getNode(id, root)!);

    const next = bulkRemoveNodes(root, new Set(["A", "B"]))!;
    // A も B も「消す」と言われたもの。残るのは、その下で親を失った C だけ。
    expect(reattachOrphans(next, removedNodes)).toEqual(["C"]);
    expect(next.children.map((c) => c.id)).toEqual(["C"]);
  });

  it("多親ノードを削除しても、他の親の下に残っていれば何もしない", () => {
    const shared = N("C", [N("D")]);
    const root = N("root", [N("A", [shared]), N("B", [shared])]);
    const removed = getNode("C", root)!;

    // A の下の C を消す。getParent は最初に見つかった親から辺を外す。
    rmNode("C", root);
    expect(reattachOrphans(root, [removed])).toEqual([]);
    expect(flattenVisibleTree(root, new Set(), false).map((r) => r.path)).toEqual([
      "root",
      "root/A",
      "root/B",
      "root/B/C",
      "root/B/C/D",
    ]);
  });
});

describe("作り直しでも多親ノードの共有を壊さない", () => {
  it("updateNodeDataById は出現ごとに別オブジェクトを作らない", () => {
    const shared = N("C");
    const root = N("root", [N("A", [shared]), N("B", [shared])]);

    const next = updateNodeDataById(root, "C", { name: "変更後" })!;
    expect(next.children[0].children[0]).toBe(next.children[1].children[0]);
    expect(next.children[0].children[0].data.name).toBe("変更後");
  });

  it("bulkRemoveNodes は出現ごとに別オブジェクトを作らない", () => {
    const shared = N("C", [N("D"), N("E")]);
    const root = N("root", [N("A", [shared]), N("B", [shared])]);

    const next = bulkRemoveNodes(root, new Set(["E"]))!;
    expect(next.children[0].children[0]).toBe(next.children[1].children[0]);
    expect(next.children[0].children[0].children.map((c) => c.id)).toEqual(["D"]);
  });
});
