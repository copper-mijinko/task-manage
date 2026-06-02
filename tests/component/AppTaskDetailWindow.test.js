import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@features/navigation/components/Header.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/navigation/components/MenuList.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@pages/MainPage.svelte", async () => {
  const mod = await import("../mocks/TreeTableStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/search/components/PageSearchBox.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/inbox/components/InboxPanel.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/inbox/components/QuickCapture.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/tasks/components/TaskDetail.svelte", async () => {
  const mod = await import("../mocks/TaskDetailStub.svelte");
  return { default: mod.default };
});

const taskDetailUrl =
  "/?projectId=stale-root&taskId=task-1&taskName=Opened%20Task&selectedType=WorkspaceProject&projectDir=C%3A%2Fworkspace%2Falpha#task-detail-window";

function makeElectronAPI(overrides = {}) {
  return {
    getProjectIDs: vi.fn().mockResolvedValue([]),
    getMetaData: vi.fn().mockResolvedValue(null),
    setMetaData: vi.fn(),
    getCurrentTheme: vi.fn().mockResolvedValue("dark"),
    onThemeChanged: vi.fn(),
    onTreeDataUpdated: vi.fn(),
    onProjectDeleted: vi.fn(),
    onSaveError: vi.fn(),
    onWorkspaceSaveStatus: vi.fn(),
    onWorkspaceProjectUpdated: vi.fn(),
    onWorkspaceConflict: vi.fn(),
    onWorkspaceNotice: vi.fn(),
    onWorkspaceFlushStart: vi.fn(),
    onWorkspaceFlushComplete: vi.fn(),
    wsGetWorkspaces: vi.fn().mockResolvedValue({ workspaces: [], activeWorkspace: null }),
    wsListProjects: vi.fn().mockResolvedValue([]),
    wsReadProject: vi.fn().mockResolvedValue({
      tasks: {
        "actual-root": {
          id: "actual-root",
          name: "Actual Project",
          status: "Open",
          parents: [],
          memos: [],
          createdAt: "2026-01-01",
        },
        "task-1": {
          id: "task-1",
          name: "Opened Task",
          status: "Open",
          parents: ["actual-root"],
          memos: [],
          createdAt: "2026-01-01",
        },
      },
    }),
    ...overrides,
  };
}

async function importAppAtTaskDetailUrl(api = makeElectronAPI()) {
  cleanup();
  window.history.pushState({}, "", taskDetailUrl);
  Object.defineProperty(window, "electronAPI", { configurable: true, value: api });

  const [{ default: App }, stores] = await Promise.all([
    import("../../src/App.svelte"),
    import("@stores"),
  ]);
  return { App, stores, api };
}

describe("App - task detail window", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete window.electronAPI;
    window.history.pushState({}, "", "/");
  });

  test("opens a workspace task detail window from the real workspace root", async () => {
    const { App, stores, api } = await importAppAtTaskDetailUrl();

    render(App);

    let taskDetail;
    await waitFor(() => {
      taskDetail = screen.getByTestId("task-detail-stub");
      expect(taskDetail).toBeInTheDocument();
    });

    expect(screen.queryByText("Task not found.")).not.toBeInTheDocument();
    expect(taskDetail).toHaveAttribute("data-title-override", "Actual Project / Opened Task");
    expect(taskDetail).toHaveAttribute("data-show-open-window-action", "false");
    expect(api.wsReadProject).toHaveBeenCalledTimes(1);
    expect(api.wsReadProject).toHaveBeenCalledWith("C:/workspace/alpha");
    expect(get(stores.selected_id)).toBe("actual-root");
    expect(get(stores.table_selected_id)).toBe("task-1");
    expect(get(stores.tree_data).data.id).toBe("actual-root");
  }, 20000);
});
