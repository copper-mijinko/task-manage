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
import { selected_id, selected_type } from "@stores";

function makeElectronAPI() {
  return {
    getInitialTreeData: vi.fn().mockResolvedValue(undefined),
    getProjectIDs: vi.fn().mockResolvedValue([]),
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
});
