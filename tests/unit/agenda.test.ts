import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agenda_store,
  bucketForDueDate,
  buildAgendaItemsForProject,
  daysBetweenIsoDates,
  sortAgendaItems,
  todayIsoDate,
  type AgendaItem,
} from "../../src/features/agenda/stores/agenda";
import { workspace_store } from "../../src/features/workspace/stores/workspace";
import { tree_data } from "../../src/features/tasks/stores/tree";
import type { ElectronAPI } from "../../src/types/app";
import type { WorkspaceTask } from "../../src/types/workspace";

const project = { name: "Proj", projectDir: "/ws/proj", rootId: "root" };

function task(overrides: Partial<WorkspaceTask> & { id: string }): WorkspaceTask {
  return {
    name: overrides.id,
    status: "Open",
    parents: [{ id: "root" }],
    memos: [],
    createdAt: "2026-01-01",
    ...overrides,
  } as WorkspaceTask;
}

const root = task({ id: "root", name: "Proj", parents: [] });

describe("date helpers", () => {
  it("formats today in local time, not UTC", () => {
    // ローカル 23:30 の日付が UTC 変換で翌日にずれないこと。
    expect(todayIsoDate(new Date(2026, 8, 3, 23, 30))).toBe("2026-09-03");
  });

  it("counts whole days between ISO dates", () => {
    expect(daysBetweenIsoDates("2026-09-03", "2026-09-10")).toBe(7);
    expect(daysBetweenIsoDates("2026-09-03", "2026-09-01")).toBe(-2);
  });

  it("buckets due dates around today", () => {
    const today = "2026-09-03";
    expect(bucketForDueDate("2026-09-01", today)).toBe("overdue");
    expect(bucketForDueDate("2026-09-03", today)).toBe("today");
    expect(bucketForDueDate("2026-09-10", today)).toBe("soon");
    expect(bucketForDueDate("2026-09-11", today)).toBe("later");
    expect(bucketForDueDate(undefined, today)).toBe("someday");
  });
});

describe("buildAgendaItemsForProject", () => {
  const today = "2026-09-03";

  it("skips the project root, completed and cancelled tasks", () => {
    const tasks = {
      root,
      a: task({ id: "a", name: "A", dueDate: "2026-09-03" }),
      done: task({ id: "done", name: "Done", status: "Completed", dueDate: "2026-09-03" }),
      dropped: task({ id: "dropped", name: "Dropped", status: "Canceled" }),
    };

    const items = buildAgendaItemsForProject(tasks, project, today);
    expect(items.map((item) => item.name)).toEqual(["A"]);
    expect(items[0].bucket).toBe("today");
    expect(items[0].projectName).toBe("Proj");
  });

  it("drops archived tasks and their descendants", () => {
    const tasks = {
      root,
      archived: task({ id: "archived", name: "Archived", archived: true }),
      child: task({ id: "child", name: "Child", parents: [{ id: "archived" }] }),
      grandchild: task({ id: "grandchild", name: "Grandchild", parents: [{ id: "child" }] }),
      live: task({ id: "live", name: "Live" }),
    };

    expect(buildAgendaItemsForProject(tasks, project, today).map((item) => item.name)).toEqual([
      "Live",
    ]);
  });

  it("shows the parent task name as context but not the project root", () => {
    const tasks = {
      root,
      parent: task({ id: "parent", name: "Parent" }),
      child: task({ id: "child", name: "Child", parents: [{ id: "parent" }] }),
    };

    const items = buildAgendaItemsForProject(tasks, project, today);
    expect(items.find((item) => item.name === "Child")?.parentPath).toBe("Parent");
    expect(items.find((item) => item.name === "Parent")?.parentPath).toBe("");
  });

  it("carries task tags through", () => {
    const tasks = { root, a: task({ id: "a", name: "A", tags: ["Frontend", "frontend"] }) };
    expect(buildAgendaItemsForProject(tasks, project, today)[0].tags).toEqual(["frontend"]);
  });
});

describe("sortAgendaItems", () => {
  it("orders by due date and puts undated tasks last", () => {
    const today = "2026-09-03";
    const items = buildAgendaItemsForProject(
      {
        root,
        late: task({ id: "late", name: "Late", dueDate: "2026-09-20" }),
        none: task({ id: "none", name: "None" }),
        soon: task({ id: "soon", name: "Soon", dueDate: "2026-09-04" }),
      },
      project,
      today
    );

    expect(sortAgendaItems(items).map((item) => item.name)).toEqual(["Soon", "Late", "None"]);
  });
});

describe("agenda_store.setStatus", () => {
  const testWindow = window as unknown as { electronAPI?: Partial<ElectronAPI> };

  const item: AgendaItem = {
    taskId: "task-a",
    name: "A",
    status: "Open",
    dueDate: "2026-09-10",
    tags: [],
    projectName: "Proj",
    projectDir: "/ws/proj",
    projectRootId: "root",
    parentPath: "",
    bucket: "soon",
    daysLeft: 7,
  };

  const workspaceTask: WorkspaceTask = {
    id: "task-a",
    name: "A",
    status: "Open",
    parents: ["root"],
    memos: [],
    createdAt: "2026-01-01",
  };

  afterEach(() => {
    delete testWindow.electronAPI;
    agenda_store.reset();
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
  });

  it("writes the new status as a patch and drops the item from the list", async () => {
    const wsWriteProjectPatch = vi.fn().mockResolvedValue({ success: true });
    testWindow.electronAPI = {
      wsReadProject: vi.fn().mockResolvedValue({ tasks: { "task-a": workspaceTask } }),
      wsWriteProjectPatch,
    } as Partial<ElectronAPI>;
    agenda_store.set({ items: [item], loading: false, failedProjects: [], loadedAt: 0 });

    const result = await agenda_store.setStatus(item, "Completed");

    expect(result?.previousStatus).toBe("Open");
    expect(get(agenda_store).items).toEqual([]);
    expect(wsWriteProjectPatch).toHaveBeenCalledWith(
      "/ws/proj",
      { tasks: [{ ...workspaceTask, status: "Completed" }], deletedTaskIds: [] },
      undefined
    );
  });

  it("keeps the item listed when the write fails", async () => {
    testWindow.electronAPI = {
      wsReadProject: vi.fn().mockResolvedValue({ tasks: { "task-a": workspaceTask } }),
      wsWriteProjectPatch: vi.fn().mockResolvedValue({ success: false, error: "nope" }),
    } as Partial<ElectronAPI>;
    agenda_store.set({ items: [item], loading: false, failedProjects: [], loadedAt: 0 });

    expect(await agenda_store.setStatus(item, "Completed")).toBeNull();
    expect(get(agenda_store).items).toHaveLength(1);
  });

  it("also syncs the in-memory tree when the same project is loaded", async () => {
    testWindow.electronAPI = {
      wsReadProject: vi.fn().mockResolvedValue({ tasks: { "task-a": workspaceTask } }),
      wsWriteProjectPatch: vi.fn().mockResolvedValue({ success: true }),
    } as Partial<ElectronAPI>;
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "/ws",
      activeProjectDir: "/ws/proj",
      projects: [],
    });
    tree_data.set({
      headers: [],
      data: {
        id: "root",
        data: {
          name: "Proj",
          status: "Open",
          "start date": undefined,
          "due date": undefined,
          memo: [],
        },
        children: [
          {
            id: "task-a",
            data: {
              name: "A",
              status: "Open",
              "start date": undefined,
              "due date": undefined,
              memo: [],
            },
            children: [],
          },
        ],
      },
    });
    agenda_store.set({ items: [item], loading: false, failedProjects: [], loadedAt: 0 });

    await agenda_store.setStatus(item, "Completed");

    expect(get(tree_data)?.data.children[0].data.status).toBe("Completed");
  });

  it("restoreStatus puts the item back with its previous status", async () => {
    testWindow.electronAPI = {
      wsReadProject: vi
        .fn()
        .mockResolvedValue({ tasks: { "task-a": { ...workspaceTask, status: "Completed" } } }),
      wsWriteProjectPatch: vi.fn().mockResolvedValue({ success: true }),
    } as Partial<ElectronAPI>;
    agenda_store.set({ items: [], loading: false, failedProjects: [], loadedAt: 0 });

    expect(await agenda_store.restoreStatus(item, "Open")).toBe(true);
    expect(get(agenda_store).items.map((entry) => entry.name)).toEqual(["A"]);
    expect(get(agenda_store).items[0].status).toBe("Open");
  });
});
