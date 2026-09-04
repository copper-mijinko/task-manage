import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
// @ts-expect-error -- main プロセス側は JS のまま
import {
  createProject,
  readProject,
  writeTask,
  parseFrontmatter,
} from "../../electron/workspace.js";
import { filterTree, sortTree, NO_STATUS } from "../../src/features/tasks/utils/tree_control";
import type { ProjectData, TreeData } from "../../src/features/tasks/utils/tree_control";
import {
  workspaceToProjectData,
  projectDataToWorkspaceTasks,
} from "../../src/features/workspace/utils/workspace_tree";
import type { WorkspaceTask } from "../../src/types/workspace";

/**
 * ステータス「無し」は既定値ではなく**状態のひとつ**である。
 *
 * メモがノードになると、「期限とステータスで追跡するノード」と「ただ書いて
 * あるノード」が同じ空間に並ぶ。後者に既定のステータスを与えると、ノート 1 つ
 * 1 つが「未着手のタスク」として積み上がり、ステータス列も絞り込みも意味を
 * 失う。だから「無し」を潰さないことが要件になる。
 *
 * 潰れる箇所は決まっていて、どれも `|| "Open"` のようなフォールバックである。
 * ここではその往復（ファイル ⇄ ワークスペース ⇄ ツリー）を固定する。
 */

function node(id: string, status: string, children: TreeData[] = []): TreeData {
  return {
    id,
    data: {
      name: id,
      status: status as TreeData["data"]["status"],
      "start date": undefined,
      "due date": undefined,
      memo: [],
    },
    children,
  };
}

describe("ステータス無し: ツリー ⇄ ワークスペースの往復", () => {
  it("status を持たないタスクは、ツリーでも「無し」のまま（Open にしない）", () => {
    const tasks: Record<string, WorkspaceTask> = {
      root: { id: "root", name: "P", parents: [], memos: [], createdAt: "2026-09-04" },
      n1: {
        id: "n1",
        name: "ただの記録",
        parents: [{ id: "root", order: 0 }],
        memos: [],
        createdAt: "2026-09-04",
      },
      n2: {
        id: "n2",
        name: "追跡するタスク",
        status: "In Progress",
        parents: [{ id: "root", order: 1 }],
        memos: [],
        createdAt: "2026-09-04",
      },
    };

    const tree = workspaceToProjectData(tasks, "root");
    const [statusless, tracked] = tree.data.children;

    expect(statusless.data.status).toBe(NO_STATUS);
    expect(tracked.data.status).toBe("In Progress");
  });

  it("「無し」のノードを書き戻しても Open にならない", () => {
    const project: ProjectData = {
      headers: [],
      data: node("root", NO_STATUS, [node("n1", NO_STATUS), node("n2", "Pending")]),
    };

    const tasks = projectDataToWorkspaceTasks(project, {});
    const byId = Object.fromEntries(tasks.map((task) => [task.id, task]));

    expect(byId.n1.status).toBeUndefined();
    expect(byId.n2.status).toBe("Pending");
  });

  it("ワークスペース → ツリー → ワークスペース で「無し」が保たれる", () => {
    const tasks: Record<string, WorkspaceTask> = {
      root: { id: "root", name: "P", parents: [], memos: [], createdAt: "2026-09-04" },
      n1: {
        id: "n1",
        name: "記録",
        parents: [{ id: "root", order: 0 }],
        memos: [],
        createdAt: "2026-09-04",
      },
    };

    const roundTripped = projectDataToWorkspaceTasks(workspaceToProjectData(tasks, "root"), tasks);

    expect(roundTripped.find((task) => task.id === "n1")?.status).toBeUndefined();
  });
});

describe("ステータス無し: ファイル形式", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-nostatus-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ステータス無しのタスクは `status:` キーごと書かない", () => {
    const { projectDir } = createProject(tmpDir, "P", "root-id");
    writeTask(
      projectDir,
      {
        id: "n1",
        name: "記録",
        parents: [{ id: "root-id", order: 0 }],
        memos: [],
        createdAt: "2026-09-04",
      },
      new Map()
    );

    const taskFile = fs
      .readdirSync(projectDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectDir, entry.name, "_index.md"))
      .find((file) => fs.existsSync(file))!;
    const raw = fs.readFileSync(taskFile, "utf8");

    // 空文字を書くと、次に読んだとき「値がある」と「無い」を区別できなくなる。
    expect(raw).not.toMatch(/^status:/m);
    expect(parseFrontmatter(raw).data.status).toBeUndefined();
  });

  it("`status:` の無いファイルは「無し」として読む（Open で埋めない）", () => {
    const { projectDir } = createProject(tmpDir, "P", "root-id");
    writeTask(
      projectDir,
      {
        id: "n1",
        name: "記録",
        parents: [{ id: "root-id", order: 0 }],
        memos: [],
        createdAt: "2026-09-04",
      },
      new Map()
    );

    const { tasks } = readProject(projectDir);

    expect(tasks.get("n1").status).toBeUndefined();
  });

  it("既存タスクの status はそのまま読める（後方互換）", () => {
    const { projectDir } = createProject(tmpDir, "P", "root-id");
    writeTask(
      projectDir,
      {
        id: "n1",
        name: "タスク",
        status: "Completed",
        parents: [{ id: "root-id", order: 0 }],
        memos: [],
        createdAt: "2026-09-04",
      },
      new Map()
    );

    expect(readProject(projectDir).tasks.get("n1").status).toBe("Completed");
  });
});

describe("ステータス無し: 絞り込みと並べ替え", () => {
  const tree = (): TreeData =>
    node("root", "Open", [node("a", NO_STATUS), node("b", "Pending"), node("c", "Open")]);

  it("「なし」で絞り込むと、ステータスを持たない行だけが残る", () => {
    const filtered = filterTree(tree(), { status: [NO_STATUS] });

    expect(filtered!.children.map((child) => child.id)).toEqual(["a"]);
  });

  it("「なし」の絞り込みが全行に当たってしまわない", () => {
    // 部分一致で見ていると、あらゆる文字列が "" を含むので全行が残る。
    const filtered = filterTree(tree(), { status: [NO_STATUS] });

    expect(filtered!.children).toHaveLength(1);
  });

  it("状態を選んだときに、ステータス無しの行が紛れ込まない", () => {
    const filtered = filterTree(tree(), { status: ["Open"] });

    expect(filtered!.children.map((child) => child.id)).toEqual(["c"]);
  });

  it("ステータス順の並べ替えでは、無しを最後に置く", () => {
    const sorted = sortTree(tree(), { column: "status", direction: "asc" }) as TreeData;

    expect(sorted.children.map((child) => child.id)).toEqual(["c", "b", "a"]);
  });
});
