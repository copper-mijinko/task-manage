import { get } from "svelte/store";
import { vi } from "vitest";
import { saveStatus, selected_id, selected_type } from "@stores/ui";
import { tree_data } from "@features/tasks/stores/tree";
import { workspace_store, workspace_tasks_cache } from "@features/workspace/stores/workspace";

function makeElectronAPI(overrides = {}) {
  return {
    getInitialTreeData: vi.fn().mockResolvedValue(undefined),
    getProjectIDs: vi.fn().mockResolvedValue([]),
    getMetaData: vi.fn().mockResolvedValue(null),
    setMetaData: vi.fn(),
    setTreeData: vi.fn().mockResolvedValue(undefined),
    wsWriteProject: vi.fn().mockResolvedValue({ success: true, queued: true }),
    wsWriteProjectPatch: vi.fn().mockResolvedValue({ success: true, queued: true }),
    wsBroadcastProjectSnapshot: vi.fn(),
    onTreeDataUpdated: vi.fn(),
    onProjectDeleted: vi.fn(),
    onWorkspaceSaveStatus: vi.fn(),
    onWorkspaceProjectUpdated: vi.fn(),
    ...overrides,
  };
}

function createProjectData(id = "project-1") {
  return {
    headers: [{ name: "name", default_ratio: 10 }],
    data: {
      id,
      data: { name: "Sample Project", status: "Open", "due date": undefined, memo: [] },
      children: [],
    },
  };
}

function createWorkspaceProjectData() {
  return {
    headers: [{ name: "name", default_ratio: 10 }],
    data: {
      id: "root-id",
      data: { name: "Workspace Project", status: "Open", "due date": undefined, memo: [] },
      children: [
        {
          id: "task-a",
          data: { name: "Task A", status: "Open", "due date": undefined, memo: [] },
          children: [],
        },
        {
          id: "task-b",
          data: { name: "Task B", status: "Open", "due date": undefined, memo: [] },
          children: [],
        },
      ],
    },
  };
}

describe("saveStatus store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI(),
    });
    selected_type.set("Projects");
    selected_id.set("project-1");
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
    workspace_tasks_cache.set({});
    saveStatus.set("idle");
    tree_data.init();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI(),
    });
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
    workspace_tasks_cache.set({});
  });

  test("initial value is idle", () => {
    expect(get(saveStatus)).toBe("idle");
  });

  test("setting tree_data changes status to writing", () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("writing");
  });

  test("setting tree_data to undefined changes status to idle", () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("writing");

    tree_data.set(undefined);
    expect(get(saveStatus)).toBe("idle");
  });

  test("successful setTreeData changes status to saved", async () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("writing");

    await vi.runAllTimersAsync();

    expect(get(saveStatus)).toBe("saved");
    expect(window.electronAPI.setTreeData).toHaveBeenCalled();
  });

  test("persists edits made immediately after source data is loaded", async () => {
    tree_data.setFromSource(createProjectData());

    const edited = createProjectData();
    edited.data.data.name = "Edited Project";
    tree_data.set(edited);

    await vi.runAllTimersAsync();

    expect(window.electronAPI.setTreeData).toHaveBeenCalledWith(edited);
  });

  test("failed setTreeData changes status to error", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI({
        setTreeData: vi.fn().mockRejectedValue(new Error("disk full")),
      }),
    });

    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("writing");

    await vi.runAllTimersAsync();

    expect(get(saveStatus)).toBe("error");
  });

  test("workspace project saves only dirty tasks through a patch", async () => {
    const wsWriteProject = vi.fn().mockResolvedValue({ success: true, queued: true });
    const wsWriteProjectPatch = vi.fn().mockResolvedValue({ success: true, queued: true });
    const wsBroadcastProjectSnapshot = vi.fn();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI({ wsWriteProject, wsWriteProjectPatch, wsBroadcastProjectSnapshot }),
    });
    selected_type.set("WorkspaceProject");
    selected_id.set("root-id");
    workspace_store.set({
      workspaces: [{ path: "C:/workspace", label: "Workspace" }],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: "C:/workspace/project",
      projects: [
        {
          name: "Workspace Project",
          rootId: "root-id",
          dirName: "project",
          projectDir: "C:/workspace/project",
          order: 0,
        },
      ],
    });
    workspace_tasks_cache.set({
      "root-id": {
        id: "root-id",
        name: "Workspace Project",
        status: "Open",
        parents: [],
        memos: [],
        createdAt: "2026-05-20",
        order: 0,
      },
      "task-a": {
        id: "task-a",
        name: "Task A",
        status: "Open",
        parents: ["root-id"],
        memos: [],
        createdAt: "2026-05-20",
        order: 0,
      },
      "task-b": {
        id: "task-b",
        name: "Task B",
        status: "Open",
        parents: ["root-id"],
        memos: [],
        createdAt: "2026-05-20",
        order: 1,
      },
    });

    const source = createWorkspaceProjectData();
    tree_data.setFromSource(source);
    const edited = JSON.parse(JSON.stringify(source));
    edited.data.children[0].data.name = "Task A edited";
    tree_data.set(edited);

    // The optimistic broadcast carries the FULL snapshot (all tasks), not just
    // the dirty task — even unchanged siblings (root-id, task-b) are present.
    // This locks in that the broadcast does not diff/reduce to a patch.
    expect(wsBroadcastProjectSnapshot).toHaveBeenCalledWith(
      "C:/workspace/project",
      expect.objectContaining({
        "root-id": expect.objectContaining({ id: "root-id" }),
        "task-a": expect.objectContaining({
          id: "task-a",
          name: "Task A edited",
        }),
        "task-b": expect.objectContaining({ id: "task-b" }),
      }),
      expect.objectContaining({ revision: expect.any(Number) })
    );

    await vi.runAllTimersAsync();

    expect(wsWriteProject).not.toHaveBeenCalled();
    expect(wsWriteProjectPatch).toHaveBeenCalled();
    const latestPatchCall = wsWriteProjectPatch.mock.calls.at(-1);
    expect(latestPatchCall[0]).toBe("C:/workspace/project");
    expect(latestPatchCall[1]).toEqual({
      tasks: [
        expect.objectContaining({
          id: "task-a",
          name: "Task A edited",
        }),
      ],
      deletedTaskIds: [],
    });
  });

  test("saveStatus can be set to error directly", () => {
    saveStatus.set("error");
    expect(get(saveStatus)).toBe("error");
  });

  test("saveStatus can be reset to idle directly", () => {
    saveStatus.set("saved");
    saveStatus.set("idle");
    expect(get(saveStatus)).toBe("idle");
  });

  test("writing to error to idle transitions are allowed", async () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("writing");

    saveStatus.set("error");
    expect(get(saveStatus)).toBe("error");

    saveStatus.set("idle");
    expect(get(saveStatus)).toBe("idle");
  });
});
