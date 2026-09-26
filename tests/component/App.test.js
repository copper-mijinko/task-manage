import { render, screen, fireEvent } from "@testing-library/svelte";
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
vi.mock("@features/search/components/PageSearchBox.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});

import App from "../../src/App.svelte";
import { saveStatus, selected_id, selected_type, sidebarCollapsed } from "@stores";
import { showWorkspaceSetup } from "@stores/ui";
import { get } from "svelte/store";

function makeElectronAPI(overrides = {}) {
  return {
    onThemeChanged: vi.fn(),
    onSaveError: vi.fn(),
    getMetaData: vi.fn().mockResolvedValue(null),
    setMetaData: vi.fn(),
    getCurrentTheme: vi.fn().mockResolvedValue("dark"),
    ...overrides,
  };
}

async function renderApp(electronAPI = makeElectronAPI()) {
  Object.defineProperty(window, "electronAPI", { configurable: true, value: electronAPI });
  render(App);
  // onMount の非同期チェーン（getCurrentTheme promise 含む）が完了するまで待つ
  await tick();
  await tick();
}

describe("App - empty workspace guidance", () => {
  afterEach(() => {
    selected_type.set(undefined);
    selected_id.set(undefined);
    sidebarCollapsed.set(true);
    showWorkspaceSetup.set(false);
    delete window.electronAPI;
  });

  test("opens workspace setup from the empty state", async () => {
    selected_type.set(undefined);
    selected_id.set(undefined);
    sidebarCollapsed.set(true);
    showWorkspaceSetup.set(false);
    await renderApp();

    expect(
      screen.getByRole("heading", { name: "ワークスペースを追加して始めましょう" })
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "ワークスペースを設定" }));

    expect(get(sidebarCollapsed)).toBe(false);
    expect(get(showWorkspaceSetup)).toBe(true);
  });
});

describe("App - save error banner", () => {
  afterEach(() => {
    saveStatus.set("idle");
    delete window.electronAPI;
  });

  test("shows the save error from the main process and marks the status as failed", async () => {
    let reportSaveError;
    await renderApp(
      makeElectronAPI({
        onSaveError: vi.fn((callback) => {
          reportSaveError = callback;
        }),
      })
    );

    reportSaveError("ファイル保存に失敗しました");
    await tick();

    expect(screen.getByRole("alert")).toHaveTextContent("ファイル保存に失敗しました");
    expect(get(saveStatus)).toBe("error");
  });

  test("closing the banner resets the status to idle", async () => {
    let reportSaveError;
    await renderApp(
      makeElectronAPI({
        onSaveError: vi.fn((callback) => {
          reportSaveError = callback;
        }),
      })
    );

    reportSaveError("保存失敗");
    await tick();
    await fireEvent.click(screen.getByRole("alert").querySelector("button"));
    await tick();

    expect(get(saveStatus)).toBe("idle");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
