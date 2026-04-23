import { render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("../../src/components/Header.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("../../src/components/ProjectPage.svelte", async () => {
  const mod = await import("../mocks/TreeTableStub.svelte");
  return { default: mod.default };
});
vi.mock("../../src/components/InfoPage.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("../../src/components/Modal.svelte", async () => {
  const mod = await import("../mocks/DialogStub.svelte");
  return { default: mod.default };
});
vi.mock("../../src/components/Button.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("../../src/components/PageSearchBox.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("../../src/components/TaskDetailWindow.svelte", async () => {
  const mod = await import("../mocks/TaskDetailStub.svelte");
  return { default: mod.default };
});

import App from "../../src/App.svelte";
import { saveStatus } from "../../src/stores.ts";
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

describe("App - save status indicator", () => {
  afterEach(() => {
    saveStatus.set("idle");
    delete window.electronAPI;
  });

  test("インジケーターは idle 状態では表示されない", async () => {
    await renderApp();
    // init 後も idle のまま → インジケーターなし
    expect(screen.queryByTestId("save-status-indicator")).toBeNull();
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
    expect(screen.queryByTestId("save-status-indicator")).toBeNull();
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
    expect(screen.queryByTestId("save-status-indicator")).toBeNull();
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
