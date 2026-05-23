import { waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";

import { filtered_data, filter } from "@features/search/stores/search";
import { tree_data } from "@features/tasks/stores/tree";
import { selected_id, selected_type, table_selected_id } from "@stores/ui";
import { workspace_store, workspace_tasks_cache } from "@features/workspace/stores/workspace";

function createProjectData() {
  return {
    headers: [{ name: "name", default_ratio: 10 }],
    data: {
      id: "project-1",
      data: {
        name: "Sample Project",
        status: "Open",
        "due date": undefined,
        memo: [],
      },
      children: [],
    },
  };
}

describe("filter store", () => {
  afterEach(() => {
    filter.set({});
    filtered_data.set(undefined);
    tree_data.set(undefined);
    table_selected_id.set(undefined);
    selected_id.set(undefined);
    selected_type.set(undefined);
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
    workspace_tasks_cache.set({});
    delete window.electronAPI;
  });

  test("updates visible tree data when tree_data changes without filter changes", () => {
    filter.init();
    filtered_data.set(undefined);
    filter.set({});

    tree_data.set(createProjectData());

    expect(get(filtered_data).id).toBe("project-1");
    expect(get(filtered_data).data.name).toBe("Sample Project");
  });

  test("hydrates workspace memo bodies when memo full-text search is enabled", async () => {
    filter.init();
    const projectDir = "C:/workspace/project";
    window.electronAPI = {
      wsReadProjectMemos: vi.fn().mockResolvedValue({
        memosByTaskId: {
          "task-1": [
            {
              id: "memo-1",
              title: "Notes",
              content: "launch checklist",
              tags: [],
              format: "markdown",
              bodyLoaded: true,
            },
          ],
        },
      }),
    };
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: projectDir,
      projects: [],
    });
    workspace_tasks_cache.set({
      "task-1": {
        id: "task-1",
        name: "Task",
        status: "Open",
        parents: ["project-1"],
        memos: [
          {
            id: "memo-1",
            title: "Notes",
            content: "",
            tags: [],
            format: "markdown",
            bodyLoaded: false,
          },
        ],
        createdAt: "2026-05-22",
      },
    });
    selected_type.set("WorkspaceProject");
    selected_id.set("project-1");
    tree_data.set({
      headers: [{ name: "name", default_ratio: 10 }],
      data: {
        id: "project-1",
        data: {
          name: "Workspace Project",
          status: "Open",
          "due date": undefined,
          memo: [],
        },
        children: [
          {
            id: "task-1",
            data: {
              name: "Task",
              status: "Open",
              "due date": undefined,
              memo: [
                {
                  id: "memo-1",
                  title: "Notes",
                  content: "",
                  tags: [],
                  format: "markdown",
                  bodyLoaded: false,
                },
              ],
            },
            children: [],
          },
        ],
      },
    });

    filter.set({ full_text: ["launch"], search_memo: ["1"] });

    await waitFor(() => {
      expect(window.electronAPI.wsReadProjectMemos).toHaveBeenCalledWith(projectDir);
      expect(get(tree_data).data.children[0].data.memo[0].content).toBe("launch checklist");
    });
    await waitFor(() => {
      expect(get(filtered_data).children[0].id).toBe("task-1");
    });
  });
});
