import { render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { waitFor } from "@testing-library/svelte";
import { vi } from "vitest";

vi.mock("@features/navigation/components/Header.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@pages/MainPage.svelte", async () => {
  const mod = await import("../mocks/TreeTableStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/workspace/components/WorkspaceTreeGridPage.svelte", async () => {
  const mod = await import("../mocks/NodeWorkspaceStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/search/components/PageSearchBox.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});

import App from "../../src/App.svelte";

import { selected_id, selected_type, workspace_store } from "@stores";

function makeElectronAPI() {
  return {
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
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
    });
    delete window.electronAPI;
  });

  test("routes a workspace project selection to the unified node workspace", async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId("node-workspace-stub")).toBeInTheDocument();
      expect(screen.queryByTestId("tree-table-stub")).toBeNull();
    });
  });
});
