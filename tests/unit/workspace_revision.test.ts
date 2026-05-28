import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";

function makeElectronAPI(overrides = {}) {
  return {
    getProjectIDs: vi.fn().mockResolvedValue([]),
    setTreeData: vi.fn().mockResolvedValue(undefined),
    wsWriteProject: vi.fn().mockResolvedValue({ success: true, queued: true }),
    wsWriteProjectPatch: vi.fn().mockResolvedValue({ success: true, queued: true }),
    wsBroadcastProjectSnapshot: vi.fn(),
    onTreeDataUpdated: vi.fn(),
    onWorkspaceSaveStatus: vi.fn(),
    onWorkspaceProjectUpdated: vi.fn(),
    ...overrides,
  };
}

function quillContent(text: string) {
  return { ops: [{ insert: `${text}\n` }] };
}

function createWorkspaceTasks(content: unknown) {
  return {
    "root-id": {
      id: "root-id",
      name: "Workspace Project",
      status: "Open" as const,
      parents: [],
      memos: [],
      createdAt: "2026-05-20",
      order: 0,
    },
    "task-a": {
      id: "task-a",
      name: "Task A",
      status: "Open" as const,
      parents: ["root-id"],
      memos: [
        {
          id: "memo-1",
          title: "memo",
          content,
          tags: [],
          format: "quill" as const,
          order: 0,
        },
      ],
      createdAt: "2026-05-20",
      order: 0,
    },
  };
}

function createWorkspaceProjectData(content: unknown) {
  return {
    headers: [{ name: "name", default_ratio: 10 }],
    data: {
      id: "root-id",
      data: { name: "Workspace Project", status: "Open", memo: [] },
      children: [
        {
          id: "task-a",
          data: {
            name: "Task A",
            status: "Open",
            memo: [
              {
                id: "memo-1",
                title: "memo",
                content,
                tags: [],
                format: "quill",
              },
            ],
          },
          children: [],
        },
      ],
    },
  };
}

describe("workspace revision handling", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI(),
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI(),
    });
  });

  test("ignores stale local-write events so slow saves cannot rewind local edits", async () => {
    vi.useFakeTimers();
    const workspaceProjectUpdatedCallbacks: Array<(event: unknown) => void> = [];
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI({
        onWorkspaceProjectUpdated: vi.fn((callback) => {
          workspaceProjectUpdatedCallbacks.push(callback);
        }),
      }),
    });

    const { tree_data } = await import("@features/tasks/stores/tree");
    const { selected_id, selected_type } = await import("@stores/ui");
    const { workspace_store, workspace_tasks_cache } =
      await import("@features/workspace/stores/workspace");

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
    workspace_tasks_cache.set(createWorkspaceTasks(quillContent("")));
    tree_data.init();

    tree_data.setFromSource(createWorkspaceProjectData(quillContent("")));
    tree_data.set(createWorkspaceProjectData(quillContent("A")));
    tree_data.set(createWorkspaceProjectData(quillContent("AB")));

    expect(workspaceProjectUpdatedCallbacks).toHaveLength(1);
    workspaceProjectUpdatedCallbacks[0]({
      projectDir: "C:/workspace/project",
      tasks: createWorkspaceTasks(quillContent("A")),
      reason: "local-write",
      revision: 1,
    });

    const current = get(tree_data);
    expect(current?.data.children[0].data.memo[0].content).toEqual(quillContent("AB"));
  });
});
