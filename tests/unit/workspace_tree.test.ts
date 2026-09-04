import { describe, expect, it } from "vitest";
import {
  projectDataToWorkspaceTasks,
  workspaceToProjectData,
} from "../../src/features/workspace/utils/workspace_tree";

describe("workspace tree conversion", () => {
  it("preserves root order while assigning child sibling order", () => {
    const tasks = projectDataToWorkspaceTasks(
      {
        headers: [],
        data: {
          id: "root-id",
          data: {
            name: "Project",
            status: "Open",
            "start date": undefined,
            "due date": undefined,
            memo: [],
          },
          children: [
            {
              id: "child-a",
              data: {
                name: "Child A",
                status: "Open",
                "start date": undefined,
                "due date": undefined,
                memo: [],
              },
              children: [],
            },
            {
              id: "child-b",
              data: {
                name: "Child B",
                status: "Open",
                "start date": undefined,
                "due date": undefined,
                memo: [],
              },
              children: [],
            },
          ],
        },
      },
      {
        "root-id": {
          id: "root-id",
          name: "Project",
          status: "Open",
          parents: [],
          memos: [],
          createdAt: "2026-05-20",
          order: 7,
        },
      }
    );

    expect(tasks.find((task) => task.id === "root-id")?.order).toBe(7);
    expect(tasks.find((task) => task.id === "child-a")?.order).toBe(0);
    expect(tasks.find((task) => task.id === "child-b")?.order).toBe(1);
  });

  it("preserves existing memo content when a workspace memo body is not loaded", () => {
    const tasks = projectDataToWorkspaceTasks(
      {
        headers: [],
        data: {
          id: "root-id",
          data: {
            name: "Project",
            status: "Open",
            "start date": undefined,
            "due date": undefined,
            memo: [
              {
                id: "memo-1",
                title: "Notes",
                content: "",
                tags: ["keep"],
                format: "markdown",
                bodyLoaded: false,
              },
            ],
          },
          children: [],
        },
      },
      {
        "root-id": {
          id: "root-id",
          name: "Project",
          status: "Open",
          parents: [],
          memos: [
            {
              id: "memo-1",
              title: "Notes",
              content: "Existing body",
              tags: ["keep"],
              format: "markdown",
            },
          ],
          createdAt: "2026-05-20",
        },
      }
    );

    expect(tasks[0].memos[0].content).toBe("Existing body");
    expect(tasks[0].memos[0].bodyLoaded).toBe(false);
  });

  it("round-trips task attachments through workspace tree conversion", () => {
    const attachment = {
      id: "./attachments/spec.pdf",
      name: "spec.pdf",
      relativePath: "./attachments/spec.pdf",
      size: 1024,
      modifiedAt: "2026-05-25T00:00:00.000Z",
    };

    const projectData = workspaceToProjectData(
      {
        "root-id": {
          id: "root-id",
          name: "Project",
          status: "Open",
          parents: [],
          memos: [],
          attachments: [attachment],
          createdAt: "2026-05-20",
        },
      },
      "root-id"
    );

    expect(projectData.data.data.attachments).toEqual([attachment]);

    const tasks = projectDataToWorkspaceTasks(projectData, {
      "root-id": {
        id: "root-id",
        name: "Project",
        status: "Open",
        parents: [],
        memos: [],
        attachments: [attachment],
        createdAt: "2026-05-20",
      },
    });

    expect(tasks[0].attachments).toEqual([attachment]);
  });

  it("uses the workspace root task when the requested root id is stale", () => {
    const projectData = workspaceToProjectData(
      {
        "actual-root": {
          id: "actual-root",
          name: "Actual Project",
          status: "Open",
          parents: [],
          memos: [],
          createdAt: "2026-05-20",
        },
        "task-1": {
          id: "task-1",
          name: "Task One",
          status: "Open",
          parents: ["actual-root"],
          memos: [],
          createdAt: "2026-05-21",
        },
      },
      "stale-root"
    );

    expect(projectData.data.id).toBe("actual-root");
    expect(projectData.data.data.name).toBe("Actual Project");
    expect(projectData.data.children.map((child) => child.id)).toEqual(["task-1"]);
  });

  it("emits a task listed under two parents once per parent", () => {
    // parents は複数持てるため、同じ task が 2 つの親の children に現れうる。
    // ツリーは keyed each で描画されるので、同じ id を 2 箇所へ出すと
    // each_key_duplicate で描画が落ちて画面が「読み込み中...」のまま止まる。
    const projectData = workspaceToProjectData(
      {
        root: {
          id: "root",
          name: "Project",
          status: "Open",
          parents: [],
          memos: [],
          createdAt: "2026-01-01",
          order: 0,
        },
        parent: {
          id: "parent",
          name: "Parent",
          status: "Open",
          parents: ["root"],
          memos: [],
          createdAt: "2026-01-01",
          order: 0,
        },
        shared: {
          id: "shared",
          name: "Shared",
          status: "Open",
          parents: ["root", "parent"],
          memos: [],
          createdAt: "2026-01-01",
          order: 1,
        },
      },
      "root"
    );

    const ids: string[] = [];
    const walk = (node: { id: string; children: { id: string }[] }) => {
      ids.push(node.id);
      for (const child of node.children) walk(child as never);
    };
    walk(projectData.data as never);

    // 木は DAG の射影。多親ノードは親ごとに現れるのが正しい。
    // （以前はグローバルな visited で 1 回に潰していて、辺が保存からも消えていた）
    expect(ids.filter((id) => id === "shared")).toHaveLength(2);
  });

  it("stops at a cycle instead of recursing forever", () => {
    const projectData = workspaceToProjectData(
      {
        root: {
          id: "root",
          name: "P",
          status: "Open",
          parents: [],
          memos: [],
          createdAt: "2026-01-01",
        },
        a: {
          id: "a",
          name: "A",
          status: "Open",
          parents: ["root", "b"],
          memos: [],
          createdAt: "2026-01-01",
        },
        b: {
          id: "b",
          name: "B",
          status: "Open",
          parents: ["a"],
          memos: [],
          createdAt: "2026-01-01",
        },
      } as never,
      "root"
    );

    const ids: string[] = [];
    const walk = (node: { id: string; children: { id: string }[] }) => {
      ids.push(node.id);
      for (const child of node.children) walk(child as never);
    };
    walk(projectData.data as never);

    // root → a → b → (a は祖先なので打ち切り)
    expect(ids).toEqual(["root", "a", "b"]);
  });

  it("round-trips task tags between the tree and workspace tasks", () => {
    const projectData = workspaceToProjectData(
      {
        root: {
          id: "root",
          name: "Project",
          status: "Open",
          parents: [],
          memos: [],
          tags: ["Frontend", "frontend", "  design "],
          createdAt: "2026-01-01",
          order: 0,
        },
      },
      "root"
    );

    expect(projectData.data.data.tags).toEqual(["frontend", "design"]);

    const [task] = projectDataToWorkspaceTasks(projectData, {});
    expect(task.tags).toEqual(["frontend", "design"]);
  });
});
