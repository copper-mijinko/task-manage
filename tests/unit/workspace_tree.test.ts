import { describe, expect, it } from "vitest";
import { projectDataToWorkspaceTasks } from "../../src/features/workspace/utils/workspace_tree";

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
});
