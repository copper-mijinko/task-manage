import { render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("@features/navigation/components/Header.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@pages/MainPage.svelte", async () => {
  const mod = await import("../mocks/TreeTableStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/navigation/components/InfoPage.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@lib/primitives/Modal.svelte", async () => {
  const mod = await import("../mocks/DialogStub.svelte");
  return { default: mod.default };
});
vi.mock("@lib/primitives/Button.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/search/components/PageSearchBox.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@pages/TaskDetailPage.svelte", async () => {
  const mod = await import("../mocks/TaskDetailStub.svelte");
  return { default: mod.default };
});

import App from "../../src/App.svelte";
import { get } from "svelte/store";
import { projectLoading, selected_id, selected_type, tree_data, workspace_store } from "@stores";

function makeElectronAPI() {
  return {
    getInitialTreeData: vi.fn().mockResolvedValue(undefined),
    getProjectIDs: vi.fn().mockResolvedValue([]),
    wsReadProject: vi.fn().mockResolvedValue(undefined),
    onProjectDeleted: vi.fn(),
    onTreeDataUpdated: vi.fn(),
    onThemeChanged: vi.fn(),
    onSaveError: vi.fn(),
    getMetaData: vi.fn().mockResolvedValue(null),
    setMetaData: vi.fn(),
    getCurrentTheme: vi.fn().mockResolvedValue("dark"),
  };
}

describe("App - workspace project rendering", () => {
  afterEach(() => {
    selected_type.set(undefined);
    selected_id.set(undefined);
    projectLoading.set(false);
    tree_data.resetForLoad();
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
    delete window.electronAPI;
  });

  test("renders the project page for a workspace project selection", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI(),
    });

    render(App);
    await tick();
    await tick();

    selected_type.set("WorkspaceProject");
    selected_id.set("workspace-project-1");
    await tick();

    expect(screen.getByTestId("tree-table-stub")).toBeInTheDocument();
  });

  test("resets the project page while a workspace project switch is loading", async () => {
    let resolveReadProject;
    const readProject = new Promise((resolve) => {
      resolveReadProject = resolve;
    });
    const api = {
      ...makeElectronAPI(),
      wsReadProject: vi.fn().mockReturnValue(readProject),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });

    render(App);
    await tick();
    await tick();

    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: "C:/workspace/beta",
      projects: [
        {
          name: "Beta",
          rootId: "root-beta",
          dirName: "beta",
          projectDir: "C:/workspace/beta",
          order: 0,
        },
      ],
    });
    selected_type.set("WorkspaceProject");
    selected_id.set("root-beta");
    await tick();
    await tick();

    expect(get(projectLoading)).toBe(true);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("tree-table-stub")).toBeNull();

    resolveReadProject({
      tasks: {
        "root-beta": {
          id: "root-beta",
          name: "Beta",
          status: "Open",
          parents: [],
          memos: [],
          createdAt: "2026-01-01",
        },
      },
    });
    await readProject;
    await tick();
    await tick();

    expect(get(projectLoading)).toBe(false);
    expect(screen.getByTestId("tree-table-stub")).toBeInTheDocument();
    expect(get(tree_data).data.data.name).toBe("Beta");
    expect(api.wsReadProject).toHaveBeenCalledWith("C:/workspace/beta");
  });
});
