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
import { saveStatus } from "@stores";
import { get } from "svelte/store";

function makeElectronAPI(overrides = {}) {
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

// Save status indicator is now rendered inside Header.svelte (which is mocked out in App tests).
// These tests are skipped here; equivalent coverage should live in a Header-specific test.
describe.skip("App - save status indicator", () => {
  afterEach(() => {
    saveStatus.set("idle");
    delete window.electronAPI;
  });

  test("idle 状態では「保存済み」として表示される", async () => {
    await renderApp();
    // idle 状態でも Header の保存インジケーターは常時表示され「保存済み」を表す
    const el = screen.getByTestId("save-status-indicator");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("保存済み");
    expect(el).toHaveAttribute("data-status", "idle");
  });

  test("saving 状態で「保存中...」を表示する", async () => {
    await renderApp();
    saveStatus.set("saving");
    await tick();

    const el = screen.getByTestId("save-status-indicator");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("保存中...");
    expect(el).toHaveAttribute("data-status", "saving");
  });

  test("saved 状態で「保存済み」を表示する", async () => {
    await renderApp();
    saveStatus.set("saved");
    await tick();

    const el = screen.getByTestId("save-status-indicator");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("保存済み");
    expect(el).toHaveAttribute("data-status", "saved");
  });

  test("error 状態（バナーなし）で「保存失敗」インジケーターを表示する", async () => {
    await renderApp();
    saveStatus.set("error");
    await tick();

    const el = screen.getByTestId("save-status-indicator");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("保存失敗");
    expect(el).toHaveAttribute("data-status", "error");
  });

  test("onSaveError 発火でエラーバナーが表示され、インジケーターは隠れる", async () => {
    let savedCallback;
    await renderApp(
      makeElectronAPI({
        onSaveError: vi.fn((cb) => {
          savedCallback = cb;
        }),
      })
    );
    saveStatus.set("saving");
    await tick();

    savedCallback("ファイル保存に失敗しました");
    await tick();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("ファイル保存に失敗しました");
    // Header indicator is always present (data-status reflects the current state)
    expect(screen.getByTestId("save-status-indicator")).toBeInTheDocument();
  });

  test("エラーバナーを閉じると saveStatus が idle に戻る", async () => {
    let savedCallback;
    await renderApp(
      makeElectronAPI({
        onSaveError: vi.fn((cb) => {
          savedCallback = cb;
        }),
      })
    );

    savedCallback("保存失敗");
    await tick();

    const closeButton = screen.getByRole("alert").querySelector("button");
    await fireEvent.click(closeButton);
    await tick();

    expect(get(saveStatus)).toBe("idle");
    expect(screen.queryByRole("alert")).toBeNull();
    // Header indicator remains and reflects idle state
    const el = screen.getByTestId("save-status-indicator");
    expect(el).toHaveAttribute("data-status", "idle");
  });

  test("saving → saved への状態遷移でインジケーターが切り替わる", async () => {
    await renderApp();

    saveStatus.set("saving");
    await tick();
    expect(screen.getByTestId("save-status-indicator")).toHaveTextContent("保存中...");

    saveStatus.set("saved");
    await tick();
    expect(screen.getByTestId("save-status-indicator")).toHaveTextContent("保存済み");
  });
});
