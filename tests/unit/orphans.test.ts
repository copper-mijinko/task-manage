import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import {
  projectDataToWorkspaceTasks,
  workspaceToProjectData,
} from "../../src/features/workspace/utils/workspace_tree";
import {
  addNode,
  buildLineNumberMap,
  bulkAddNodes,
  bulkIndent,
  canIndentNode,
  buildInheritedDueDateMap,
  buildNodePathMap,
  buildStickyTrail,
  bulkMoveUp,
  bulkRemoveNodes,
  bulkRestoreNodes,
  getTopLevelSelection,
  isNodeEffectivelyArchived,
  reorderTree,
  restoreNode,
  canOutdentNode,
  indentNode,
  moveNodeUp,
  outdentNode,
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

/**
 * 移動・インデントは「どの辺を動かすか」の操作。多親ノードは同じ id の行が
 * 複数あるので、最初に見つかった親を使うとクリックした行と違う行が動く。
 */
describe("移動はクリックした行の親に効く", () => {
  const twoParents = () => {
    const shared = N("C");
    return N("root", [N("A", [N("A1"), shared]), N("B", [shared, N("B1")])]);
  };

  it("moveNodeUp は経路で指定した親の中だけを並べ替える", () => {
    const tree = twoParents();
    moveNodeUp("C", tree, "root/B/C");
    // B の中では C が先頭なので動かない。A の中も動かない。
    expect(tree.children[0].children.map((c) => c.id)).toEqual(["A1", "C"]);

    moveNodeUp("C", tree, "root/A/C");
    expect(tree.children[0].children.map((c) => c.id)).toEqual(["C", "A1"]);
    expect(tree.children[1].children.map((c) => c.id)).toEqual(["C", "B1"]);
  });

  it("indentNode は経路で指定した親の中の直前の兄弟に入る", () => {
    const tree = twoParents();
    indentNode("C", tree, "root/A/C");

    expect(tree.children[0].children.map((c) => c.id)).toEqual(["A1"]);
    expect(tree.children[0].children[0].children.map((c) => c.id)).toEqual(["C"]);
    // B の下の C はそのまま（辺は別物）。
    expect(tree.children[1].children.map((c) => c.id)).toEqual(["C", "B1"]);
  });

  it("outdentNode は経路で指定した親から 1 段上げる", () => {
    const tree = N("root", [N("A", [N("A1", [N("X")])]), N("B", [N("X")])]);
    expect(canOutdentNode("X", tree, "root/A/A1/X")).toBe(true);
    outdentNode("X", tree, "root/A/A1/X");

    expect(tree.children[0].children.map((c) => c.id)).toEqual(["A1", "X"]);
    expect(tree.children[0].children[0].children).toEqual([]);
    expect(tree.children[1].children.map((c) => c.id)).toEqual(["X"]);
  });

  it("経路を渡さなければ従来どおり最初の親で動く", () => {
    const tree = twoParents();
    moveNodeUp("C", tree);
    expect(tree.children[0].children.map((c) => c.id)).toEqual(["C", "A1"]);
  });
});

/**
 * 行に紐づく表示（名前パス・継承期限・パンくず）は、出現ごとに違う。
 * ノード id で引くと、別の親の下の値が混ざる。
 */
describe("行ごとの表示は経路で引く", () => {
  const withDue = (id: string, due: string | undefined, children: TreeData[] = []): TreeData => ({
    id,
    data: { name: id, status: "Open", "start date": undefined, "due date": due, memo: [] },
    children,
  });

  it("名前パスは出現ごとに違う", () => {
    const shared = withDue("C", undefined);
    const tree = withDue("root", undefined, [
      withDue("A", undefined, [shared]),
      withDue("B", undefined, [shared]),
    ]);
    const map = buildNodePathMap(flattenVisibleTree(tree, new Set(), false));

    expect(map.get("root/A/C")).toBe("root / A / C");
    expect(map.get("root/B/C")).toBe("root / B / C");
  });

  it("継承する期限は、その行の祖先から引く", () => {
    const shared = withDue("C", undefined);
    const tree = withDue("root", undefined, [
      withDue("A", "2026-01-01", [shared]),
      withDue("B", "2026-12-31", [shared]),
    ]);
    const map = buildInheritedDueDateMap(flattenVisibleTree(tree, new Set(), false));

    expect(map.get("root/A/C")).toBe("2026-01-01");
    expect(map.get("root/B/C")).toBe("2026-12-31");
  });

  it("パンくずは、その行の祖先列になる", () => {
    const shared = withDue("C", undefined, [withDue("D", undefined)]);
    const tree = withDue("root", undefined, [
      withDue("A", undefined, [shared]),
      withDue("B", undefined, [shared]),
    ]);
    const rows = flattenVisibleTree(tree, new Set(), false);
    // 行順: root, A, C, D, B, C, D。scrollTop=4 行ぶんが B の C を覆い、先頭は D。
    const trail = buildStickyTrail(rows, 5 * 40, 40);

    expect(trail.map((r) => r.path)).toEqual(["root", "root/B", "root/B/C"]);
  });
});

describe("D&D と一括操作も、掴んだ／見ている辺に効く", () => {
  it("reorderTree は掴んだ辺を外して、落とした行の隣に置く", () => {
    const shared = N("C");
    const tree = N("root", [N("A", [N("A1"), shared]), N("B", [shared, N("B1")])]);

    // B の下の C を掴んで、B1 の後ろへ落とす。A の下の C は動かない。
    reorderTree("C", "B1", tree, "insert_after", {
      targetPath: "root/B/C",
      basePath: "root/B/B1",
    });

    expect(tree.children[0].children.map((c) => c.id)).toEqual(["A1", "C"]);
    expect(tree.children[1].children.map((c) => c.id)).toEqual(["B1", "C"]);
  });

  it("bulkMoveUp は経路で指定した親の中だけを動かす", () => {
    const shared = N("C");
    const tree = N("root", [N("A", [N("A1"), shared]), N("B", [N("B1"), shared])]);

    bulkMoveUp(new Set(["C"]), tree, "root/B");

    expect(tree.children[0].children.map((c) => c.id)).toEqual(["A1", "C"]);
    expect(tree.children[1].children.map((c) => c.id)).toEqual(["C", "B1"]);
  });
});

describe("Shift 選択の範囲も行で決まる", () => {
  it("下の出現を起点にすると、そこからの範囲になる", async () => {
    const { selectOnly, selectRange, selected_ids, selection_anchor_id } =
      await import("../../src/stores/ui");
    const shared = N("C");
    const tree = N("root", [N("A", [shared, N("A2")]), N("B", [shared, N("B2")])]);
    const rows = flattenVisibleTree(tree, new Set(), false);
    // 行順: root, A, C(A の下), A2, B, C(B の下), B2
    const ids = rows.map((r) => r.id);

    // B の下の C を起点に、B2 まで。
    selectOnly("C", "root/B/C");
    expect(get(selection_anchor_id)).toBe("C");
    selectRange("B2", ids, rows, "root/B/B2");
    expect(get(selected_ids)).toEqual(new Set(["C", "B2"]));

    // 起点が A の下の C なら、A2 以降ぜんぶが入る。
    selectOnly("C", "root/A/C");
    selectRange("B2", ids, rows, "root/B/B2");
    expect(get(selected_ids)).toEqual(new Set(["C", "A2", "B", "B2"]));
  });
});

/**
 * アーカイブと復元もノードの属性だが、「辿れるかどうか」は経路で決まる。
 */
describe("アーカイブ判定と復元", () => {
  const A = (id: string, archived: boolean, children: TreeData[] = []): TreeData => {
    const node = N(id, children);
    if (archived) {
      node.archived = true;
      node.archivedAt = "2026-09-04T00:00:00.000Z";
    }
    return node;
  };

  it("片方の親がアーカイブでも、もう片方から生きて辿れるなら生きている", () => {
    const shared = N("C");
    const tree = N("root", [A("A", true, [shared]), A("B", false, [shared])]);

    expect(isNodeEffectivelyArchived("C", tree)).toBe(false);
    expect(isNodeEffectivelyArchived("A", tree)).toBe(true);
  });

  it("すべての親がアーカイブなら、アーカイブされた扱い", () => {
    const shared = N("C");
    const tree = N("root", [A("A", true, [shared]), A("B", true, [shared])]);

    expect(isNodeEffectivelyArchived("C", tree)).toBe(true);
  });

  it("ツリーに無いノードは判定しない", () => {
    expect(isNodeEffectivelyArchived("nope", N("root", []))).toBe(false);
  });

  it("復元は、指定した行の祖先だけを解除する", () => {
    const shared = A("C", true);
    const tree = N("root", [A("A", true, [shared]), A("B", true, [shared])]);

    restoreNode("C", tree, "root/B/C");

    expect(tree.children[0].archived).toBe(true); // A はそのまま
    expect(tree.children[1].archived).toBeUndefined(); // B は解除
    expect(shared.archived).toBeUndefined();
  });
});

describe("選択の集約は重複を返さない", () => {
  it("多親ノードは、複数の経路に現れても 1 回だけ返る", () => {
    const shared = N("C");
    const tree = N("root", [N("A", [shared]), N("B", [shared])]);

    // 重複すると D&D が同じノードを 2 回挿入し、行の経路が衝突して描画が壊れる。
    expect(getTopLevelSelection(tree, new Set(["C"]))).toEqual(["C"]);
  });

  it("選択ノードの子孫は従来どおり畳まれる", () => {
    const tree = N("root", [N("A", [N("A1"), N("A2")]), N("B")]);
    expect(getTopLevelSelection(tree, new Set(["A", "A1", "B"]))).toEqual(["A", "B"]);
  });
});

describe("孤児のかたまりは、てっぺんから 1 回だけ付け直す", () => {
  it("親も孤児なら、子はルート直下に重複して出ない", () => {
    const tasks = {
      root: T("root", "プロジェクト", []),
      X: T("X", "迷子の親", ["消えた親"]),
      Y: T("Y", "迷子の子", ["X"]),
    };
    const rows = flattenVisibleTree(workspaceToProjectData(tasks, "root").data, new Set(), false);

    expect(rows.map((r) => r.path)).toEqual(["root", "root/X", "root/X/Y"]);
  });
});

/**
 * 多親では「直前の兄弟が自分の子孫」が起こりうる。そこへインデントすると
 * 自分が自分の祖先になり、ツリーが循環する（共有オブジェクトなので、
 * メモリ上も本当に輪になる）。作らせない／作られても落ちない、の両方。
 */
describe("循環を作らせない・作られても落ちない", () => {
  const cyclic = () => {
    const shared = N("C");
    // root の子は C と B、B の子も C（＝ C は多親）。B の直前の兄弟が C。
    return N("root", [shared, N("B", [shared])]);
  };

  it("直前の兄弟が自分の子孫なら、インデントできない", () => {
    const tree = cyclic();
    expect(canIndentNode("B", tree, "root/B")).toBe(false);

    indentNode("B", tree, "root/B");
    expect(tree.children.map((c) => c.id)).toEqual(["C", "B"]);
    expect(tree.children[0].children).toEqual([]);
  });

  it("一括インデントも同じ規則で止まる", () => {
    const tree = cyclic();
    bulkIndent(new Set(["B"]), tree, "root");
    expect(tree.children.map((c) => c.id)).toEqual(["C", "B"]);
  });

  it("それでも循環が入り込んだら、表示と保存は打ち切って落ちない", () => {
    const tree = cyclic();
    // 検証のため、ガードを通さずに直接輪を作る。
    const c = tree.children[0];
    const b = tree.children[1];
    tree.children = [c];
    c.children.push(b);

    const rows = flattenVisibleTree(tree, new Set(), false);
    expect(rows.map((r) => r.path)).toEqual(["root", "root/C", "root/C/B"]);
    expect(buildLineNumberMap(tree).size).toBe(3);

    const back = projectDataToWorkspaceTasks({ headers: [], data: tree }, {});
    expect(back.map((t) => t.id).sort()).toEqual(["B", "C", "root"]);
  });
});

/**
 * 木は DAG の射影なので、循環があると「データにはあるが描かれない辺」が出る。
 * 保存は木を辿って親を導くため、そのままだとファイルから消える。
 */
describe("循環で打ち切られた辺は保存で消えない", () => {
  const cyclicTasks = () =>
    ({
      root: { id: "root", name: "root", status: "Open", parents: [], memos: [], createdAt: "x" },
      X: {
        id: "X",
        name: "X",
        status: "Open",
        parents: [{ id: "root" }, { id: "Y" }],
        memos: [],
        createdAt: "x",
      },
      Y: {
        id: "Y",
        name: "Y",
        status: "Open",
        parents: [{ id: "X" }],
        memos: [],
        createdAt: "x",
      },
    }) as never;

  it("往復しても Y → X の辺が残る", () => {
    const tasks = cyclicTasks();
    const project = workspaceToProjectData(tasks, "root");
    // 表示は打ち切られる（root → X → Y まで）。
    expect(flattenVisibleTree(project.data, new Set(), false).map((r) => r.path)).toEqual([
      "root",
      "root/X",
      "root/X/Y",
    ]);

    const back = projectDataToWorkspaceTasks(project, tasks);
    const x = back.find((t) => t.id === "X")!;
    expect(x.parents.map((p) => p.id).sort()).toEqual(["Y", "root"]);
  });

  it("何度往復しても消えない", () => {
    let rec = cyclicTasks() as Record<string, never>;
    for (let i = 0; i < 3; i++) {
      const back = projectDataToWorkspaceTasks(workspaceToProjectData(rec, "root"), rec);
      const next: Record<string, never> = {};
      for (const t of back) next[t.id] = t as never;
      rec = next;
    }
    expect((rec.X as { parents: { id: string }[] }).parents.map((p) => p.id).sort()).toEqual([
      "Y",
      "root",
    ]);
  });
});

describe("インデント可否は、循環になる場合も見る", () => {
  it("直前の兄弟が自分の子孫なら、行の canIndent が false", () => {
    const shared = N("C");
    const tree = N("root", [shared, N("B", [shared])]);
    const rows = flattenVisibleTree(tree, new Set(), false);

    const b = rows.find((r) => r.path === "root/B")!;
    expect(b.canIndent).toBe(false);
  });

  it("ふつうの兄弟なら true のまま", () => {
    const tree = N("root", [N("A"), N("B")]);
    const rows = flattenVisibleTree(tree, new Set(), false);
    expect(rows.find((r) => r.path === "root/B")!.canIndent).toBe(true);
  });
});

describe("復元は、解除が最小になる経路を選ぶ", () => {
  it("生きた親から辿れるなら、アーカイブされた別の親は解除しない", () => {
    const shared = N("C");
    shared.archived = true;
    const live = N("B", [shared]);
    const archivedParent = N("A", [shared]);
    archivedParent.archived = true;
    const tree = N("root", [archivedParent, live]);

    bulkRestoreNodes(tree, new Set(["C"]));

    expect(shared.archived).toBeUndefined();
    // A は畳まれたまま（C は B から生きて辿れるので解除は要らない）。
    expect(tree.children[0].archived).toBe(true);
  });
});

describe("辺は集合：すでに親であるノードの下へ動かしても二重にならない", () => {
  it("addNode（append）は既存の子を足さない", () => {
    const shared = N("C");
    const tree = N("root", [N("A", [shared]), N("B", [shared])]);
    const b = tree.children[1];

    addNode(shared, "B", tree, "append", "root/B");
    expect(b.children.map((c) => c.id)).toEqual(["C"]);
  });

  it("bulkAddNodes も同じ", () => {
    const shared = N("C");
    const tree = N("root", [N("A", [shared]), N("B", [shared, N("B2")])]);
    const b = tree.children[1];

    bulkAddNodes([shared, N("D")], "B", tree, "append", "root/B");
    expect(b.children.map((c) => c.id)).toEqual(["C", "B2", "D"]);
  });
});
