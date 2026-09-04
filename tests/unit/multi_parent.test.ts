import { describe, expect, it } from "vitest";
import {
  projectDataToWorkspaceTasks,
  workspaceToProjectData,
} from "../../src/features/workspace/utils/workspace_tree";
import {
  collectTreePaths,
  flattenVisibleTree,
  parentPathOf,
  pathIncludesNode,
  pathLeafId,
} from "../../src/features/tasks/utils/tree_control";
import type { WorkspaceTask } from "../../src/types/workspace";

/**
 * ツリーは DAG の射影で、多親ノードは 1 箇所にしか描かれない。
 * 木の位置だけから親を作り直すと、描かれなかった辺がファイルから消える。
 * 種別を変えただけ・名前を直しただけの保存でも親が削られていた。
 */

const T = (id: string, name: string, parents: string[], over: Partial<WorkspaceTask> = {}) =>
  ({
    id,
    name,
    status: "Open",
    parents: parents.map((parentId) => ({ id: parentId })),
    memos: [],
    createdAt: "2026-09-03",
    ...over,
  }) as WorkspaceTask;

function multiParentProject() {
  return {
    root: T("root", "プロジェクト", []),
    A: T("A", "設計", ["root"]),
    B: T("B", "運用", ["root"]),
    C: T("C", "共通の知見", ["A", "B"]),
  };
}

describe("多親ノードの往復", () => {
  it("保存されるタスクは 1 ノード 1 件で、親は全出現の和になる", () => {
    const tasks = multiParentProject();
    const back = projectDataToWorkspaceTasks(workspaceToProjectData(tasks, "root"), tasks);

    expect(back.filter((t) => t.id === "C")).toHaveLength(1);
    expect((back.find((t) => t.id === "C")?.parents ?? []).map((p) => p.id).sort()).toEqual([
      "A",
      "B",
    ]);
  });

  it("構造を触らない保存で親が失われない", () => {
    const tasks = multiParentProject();
    const project = workspaceToProjectData(tasks, "root");
    const back = projectDataToWorkspaceTasks(project, tasks);

    expect(back.find((t) => t.id === "C")?.parents.map((p) => p.id)).toEqual(["A", "B"]);
  });

  it("何度往復しても削られない", () => {
    let tasks = multiParentProject();
    for (let i = 0; i < 3; i++) {
      const project = workspaceToProjectData(tasks, "root");
      tasks = Object.fromEntries(
        projectDataToWorkspaceTasks(project, tasks).map((t) => [t.id, t])
      ) as typeof tasks;
    }

    expect(tasks.C.parents.map((p) => p.id)).toEqual(["A", "B"]);
  });

  it("単親ノードは今までどおり木の位置に従う", () => {
    const tasks = multiParentProject();
    const back = projectDataToWorkspaceTasks(workspaceToProjectData(tasks, "root"), tasks);

    expect(back.find((t) => t.id === "A")?.parents.map((p) => p.id)).toEqual(["root"]);
    expect(back.find((t) => t.id === "root")?.parents).toEqual([]);
  });

  // 行はノードではなく「辺」。片方の出現を動かせば、その辺だけが変わる。
  it("片方の出現を動かしても、もう片方の親は残る", () => {
    const tasks = multiParentProject();
    const project = workspaceToProjectData(tasks, "root");

    // C を root 直下へ移した状態を作る（既知の親に無い位置へ動かした）
    const a = project.data.children!.find((c) => c.id === "A")!;
    const c = a.children!.find((n) => n.id === "C")!;
    a.children = a.children!.filter((n) => n.id !== "C");
    project.data.children!.push(c);

    const back = projectDataToWorkspaceTasks(project, tasks);
    expect((back.find((t) => t.id === "C")?.parents ?? []).map((p) => p.id).sort()).toEqual([
      "B",
      "root",
    ]);
  });

  // 行はノードではなく辺。多親ノードは親ごとに 1 行ずつ出る。
  it("多親ノードは親ごとに 1 行ずつ、別々の経路で出る", () => {
    const project = workspaceToProjectData(multiParentProject(), "root");
    const rows = flattenVisibleTree(project.data, new Set(), false);

    const shared = rows.filter((r) => r.id === "C");
    expect(shared).toHaveLength(2);
    expect(shared.map((r) => r.path).sort()).toEqual(["root/A/C", "root/B/C"]);
  });

  // DOM の id 属性は最初の行にだけ付ける（重複 id を作らないため）。
  it("最初の出現だけが primary になる", () => {
    const project = workspaceToProjectData(multiParentProject(), "root");
    const rows = flattenVisibleTree(project.data, new Set(), false);

    const shared = rows.filter((r) => r.id === "C");
    expect(shared.map((r) => r.isPrimaryOccurrence)).toEqual([true, false]);
    expect(
      rows
        .filter((r) => r.isPrimaryOccurrence)
        .map((r) => r.id)
        .sort()
    ).toEqual(["A", "B", "C", "root"]);
  });

  it("経路はルートから一意に決まる", () => {
    const project = workspaceToProjectData(multiParentProject(), "root");
    const rows = flattenVisibleTree(project.data, new Set(), false);

    expect(new Set(rows.map((r) => r.path)).size).toBe(rows.length);
  });
});

/**
 * 折り畳みは行（＝辺）ごと。同じノードでも、片方の親の下で畳んだとき、
 * もう片方の親の下は開いたままでなければならない。
 */
describe("経路ごとの折り畳み", () => {
  function childOf(parent: string) {
    return `root/${parent}/C`;
  }

  it("片方の親の下で畳んでも、もう片方の下では開いたまま", () => {
    const tasks = multiParentProject();
    tasks.C.memos = [];
    // C に子を付けて、開閉の差が行数に出るようにする。
    const withChild = { ...tasks, D: T("D", "詳細", ["C"]) };
    const project = workspaceToProjectData(withChild, "root");

    const rows = flattenVisibleTree(project.data, new Set([childOf("A")]), false);
    const cRows = rows.filter((r) => r.id === "C");
    expect(cRows.map((r) => [r.path, r.expanded])).toEqual([
      [childOf("A"), false],
      [childOf("B"), true],
    ]);
    // D は開いている方の経路にだけ現れる。
    expect(rows.filter((r) => r.id === "D").map((r) => r.path)).toEqual([`${childOf("B")}/D`]);
  });

  it("ノード id で畳んでも効かない（経路でしか畳めない）", () => {
    const project = workspaceToProjectData(multiParentProject(), "root");
    const rows = flattenVisibleTree(project.data, new Set(["C"]), false);
    expect(rows.every((r) => r.expanded)).toBe(true);
  });

  it("collectTreePaths は全行ぶんの経路を返す（すべて折りたたむ用）", () => {
    const project = workspaceToProjectData(multiParentProject(), "root");
    const paths = collectTreePaths(project.data);
    const rows = flattenVisibleTree(project.data, new Set(), false);

    expect(new Set(paths)).toEqual(new Set(rows.map((r) => r.path)));
    // 多親ノードは経路の数だけ入る。
    expect(paths.filter((p) => pathLeafId(p) === "C")).toHaveLength(2);
  });

  it("経路のヘルパは終端と親側を返し、通過ノードを判定できる", () => {
    expect(pathLeafId("root/A/C")).toBe("C");
    expect(pathLeafId("root")).toBe("root");
    expect(parentPathOf("root/A/C")).toBe("root/A");
    expect(parentPathOf("root")).toBe("");
    expect(pathIncludesNode("root/A/C", "A")).toBe(true);
    expect(pathIncludesNode("root/A/C", "B")).toBe(false);
  });
});

/**
 * `parents` / `order` / `archived` はノードの属性であって辺の属性ではない。
 * 出現ごとに別オブジェクトだと、片方の出現に子を足しても他方に出ず、
 * 保存して読み直すまで画面が食い違う。
 */
describe("多親ノードの出現はオブジェクトを共有する", () => {
  it("同じノードの 2 つの出現は同一オブジェクト", () => {
    const project = workspaceToProjectData(multiParentProject(), "root");
    const a = project.data.children.find((c) => c.id === "A")!;
    const b = project.data.children.find((c) => c.id === "B")!;

    expect(a.children[0].id).toBe("C");
    expect(a.children[0]).toBe(b.children[0]);
  });

  it("片方の出現に子を足すと、もう片方の出現にも出る", () => {
    const project = workspaceToProjectData(multiParentProject(), "root");
    const a = project.data.children.find((c) => c.id === "A")!;
    a.children[0].children.push({
      id: "D",
      data: {
        name: "詳細",
        status: "Open",
        "start date": undefined,
        "due date": undefined,
        memo: [],
      },
      children: [],
    });

    const rows = flattenVisibleTree(project.data, new Set(), false);
    expect(
      rows
        .filter((r) => r.id === "D")
        .map((r) => r.path)
        .sort()
    ).toEqual(["root/A/C/D", "root/B/C/D"]);
  });

  it("循環を打ち切った部分木は共有しない（経路に依存するため）", () => {
    // root → X → Y → X（打ち切り）。X の出現は経路ごとに形が違う。
    const cyclic = {
      root: T("root", "プロジェクト", []),
      X: T("X", "X", ["root", "Y"]),
      Y: T("Y", "Y", ["X"]),
    };
    const project = workspaceToProjectData(cyclic, "root");
    const rows = flattenVisibleTree(project.data, new Set(), false);

    expect(rows.map((r) => r.path)).toEqual(["root", "root/X", "root/X/Y"]);
  });
});

/**
 * 並び順は「辺」の属性。改修前はタスク直下に order が 1 つしか無かったので、
 * 片方の親の下で並べ替えると、もう片方の下でも動いてしまっていた。
 */
describe("親ごとの並び順", () => {
  it("同じノードが、親ごとに違う位置を持てる", () => {
    // A の下: C, A2 / B の下: B1, C
    const tasks = {
      root: T("root", "root", []),
      A: T("A", "A", ["root"], { order: 0 }),
      B: T("B", "B", ["root"], { order: 1 }),
      C: T("C", "C", [], {
        parents: [
          { id: "A", order: 0 },
          { id: "B", order: 1 },
        ],
      }),
      A2: T("A2", "A2", [], { parents: [{ id: "A", order: 1 }] }),
      B1: T("B1", "B1", [], { parents: [{ id: "B", order: 0 }] }),
    } as Record<string, WorkspaceTask>;

    const rows = flattenVisibleTree(workspaceToProjectData(tasks, "root").data, new Set(), false);
    expect(rows.map((r) => r.path)).toEqual([
      "root",
      "root/A",
      "root/A/C",
      "root/A/A2",
      "root/B",
      "root/B/B1",
      "root/B/C",
    ]);
  });

  it("往復しても、親ごとの並び順が保たれる", () => {
    const tasks = {
      root: T("root", "root", []),
      A: T("A", "A", ["root"], { order: 0 }),
      B: T("B", "B", ["root"], { order: 1 }),
      C: T("C", "C", [], {
        parents: [
          { id: "A", order: 0 },
          { id: "B", order: 1 },
        ],
      }),
      A2: T("A2", "A2", [], { parents: [{ id: "A", order: 1 }] }),
      B1: T("B1", "B1", [], { parents: [{ id: "B", order: 0 }] }),
    } as Record<string, WorkspaceTask>;

    const project = workspaceToProjectData(tasks, "root");
    const back = projectDataToWorkspaceTasks(project, tasks);
    const rec: Record<string, WorkspaceTask> = {};
    for (const t of back) rec[t.id] = t;

    expect(rec.C.parents).toEqual([
      { id: "A", order: 0 },
      { id: "B", order: 1 },
    ]);
    const rows = flattenVisibleTree(workspaceToProjectData(rec, "root").data, new Set(), false);
    expect(rows.map((r) => r.path)).toEqual([
      "root",
      "root/A",
      "root/A/C",
      "root/A/A2",
      "root/B",
      "root/B/B1",
      "root/B/C",
    ]);
  });

  it("並び順が同じ・未指定でも、環境によらず同じ並びになる", () => {
    const tasks = {
      root: T("root", "root", []),
      z: T("z", "z", ["root"]),
      a: T("a", "a", ["root"]),
      m: T("m", "m", ["root"]),
    } as Record<string, WorkspaceTask>;
    const rows = flattenVisibleTree(workspaceToProjectData(tasks, "root").data, new Set(), false);
    // order が付いていない兄弟は id 昇順。読み取り順に依存しない。
    expect(rows.map((r) => r.id)).toEqual(["root", "a", "m", "z"]);
  });
});
