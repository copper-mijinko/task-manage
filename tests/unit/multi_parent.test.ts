import { describe, expect, it } from "vitest";
import {
  projectDataToWorkspaceTasks,
  workspaceToProjectData,
} from "../../src/features/workspace/utils/workspace_tree";
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
    parents,
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
  it("構造を触らない保存で親が失われない", () => {
    const tasks = multiParentProject();
    const project = workspaceToProjectData(tasks, "root");
    const back = projectDataToWorkspaceTasks(project, tasks);

    expect(back.find((t) => t.id === "C")?.parents).toEqual(["A", "B"]);
  });

  it("何度往復しても削られない", () => {
    let tasks = multiParentProject();
    for (let i = 0; i < 3; i++) {
      const project = workspaceToProjectData(tasks, "root");
      tasks = Object.fromEntries(
        projectDataToWorkspaceTasks(project, tasks).map((t) => [t.id, t])
      ) as typeof tasks;
    }

    expect(tasks.C.parents).toEqual(["A", "B"]);
  });

  it("単親ノードは今までどおり木の位置に従う", () => {
    const tasks = multiParentProject();
    const back = projectDataToWorkspaceTasks(workspaceToProjectData(tasks, "root"), tasks);

    expect(back.find((t) => t.id === "A")?.parents).toEqual(["root"]);
    expect(back.find((t) => t.id === "root")?.parents).toEqual([]);
  });

  it("木の上で本当に動かしたときは、新しい親を採る", () => {
    const tasks = multiParentProject();
    const project = workspaceToProjectData(tasks, "root");

    // C を root 直下へ移した状態を作る（既知の親に無い位置へ動かした）
    const a = project.data.children!.find((c) => c.id === "A")!;
    const c = a.children!.find((n) => n.id === "C")!;
    a.children = a.children!.filter((n) => n.id !== "C");
    project.data.children!.push(c);

    const back = projectDataToWorkspaceTasks(project, tasks);
    expect(back.find((t) => t.id === "C")?.parents).toEqual(["root"]);
  });
});
