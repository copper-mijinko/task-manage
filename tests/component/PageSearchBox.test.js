import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";
import PageSearchBox from "../../src/components/PageSearchBox.svelte";

function installElectronApiMock(overrides = {}) {
  const listeners = {};
  const api = {
    findInPage: vi.fn().mockResolvedValue(undefined),
    findInPageNext: vi.fn(),
    findInPagePrevious: vi.fn(),
    stopFindInPage: vi.fn(),
    onSearchResultUpdated: vi.fn((callback) => {
      listeners.searchResultUpdated = callback;
    }),
    ...overrides,
  };

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: api,
  });

  return { api, listeners };
}

describe("PageSearchBox", () => {
  test("runs a search with trimmed text", async () => {
    const { api } = installElectronApiMock();

    render(PageSearchBox, { props: { show: true } });

    const input = screen.getByPlaceholderText("search...");
    await fireEvent.input(input, { target: { value: "  release  " } });
    await fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(api.findInPage).toHaveBeenCalledWith("release", {});
  });

  test("does not run a search for empty text", async () => {
    const { api } = installElectronApiMock();

    render(PageSearchBox, { props: { show: true } });

    await fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(api.findInPage).not.toHaveBeenCalled();
  });

  test("uses Enter and Shift+Enter to move through matches", async () => {
    const { api } = installElectronApiMock();

    render(PageSearchBox, { props: { show: true } });

    const input = screen.getByPlaceholderText("search...");
    await fireEvent.input(input, { target: { value: "task" } });

    await fireEvent.keyDown(input, { key: "Enter" });
    expect(api.findInPage).toHaveBeenCalledWith("task", {});
    expect(api.findInPageNext).toHaveBeenCalledWith("task");

    await fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(api.findInPagePrevious).toHaveBeenCalledWith("task");
  });

  test("updates the result counter from main-process events", async () => {
    const { listeners } = installElectronApiMock();

    render(PageSearchBox, { props: { show: true } });

    const input = screen.getByPlaceholderText("search...");
    input.value = "task";
    await fireEvent.input(input);

    listeners.searchResultUpdated({ matches: 4, activeMatchOrdinal: 2 });
    await tick();

    expect(screen.getByText((content) => content.replace(/\s+/g, " ").trim() === "2 / 4")).toBeInTheDocument();
  });

  test("closes on Escape and notifies the renderer to clear highlights", async () => {
    const { api } = installElectronApiMock();
    const handleClose = vi.fn();

    const { component } = render(PageSearchBox, { props: { show: true } });
    component.$on("close", handleClose);

    const input = screen.getByPlaceholderText("search...");
    await fireEvent.keyDown(input, { key: "Escape" });

    expect(api.stopFindInPage).toHaveBeenCalled();
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  test("clears the current search state from the clear button", async () => {
    const { api, listeners } = installElectronApiMock();

    render(PageSearchBox, { props: { show: true } });

    const input = screen.getByPlaceholderText("search...");
    await fireEvent.input(input, { target: { value: "task" } });

    listeners.searchResultUpdated({ matches: 3, activeMatchOrdinal: 2 });
    await tick();

    const buttons = screen.getAllByRole("button");
    const clearButton = buttons[3];
    await fireEvent.click(clearButton);
    await tick();

    expect(api.stopFindInPage).toHaveBeenCalled();
    expect(input).toHaveValue("");
    expect(screen.getByText((content) => content.replace(/\s+/g, " ").trim() === "0 / 0")).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  test("resets the search state when the component is hidden", async () => {
    const { api, listeners } = installElectronApiMock();

    const { component } = render(PageSearchBox, { props: { show: true } });

    const input = screen.getByPlaceholderText("search...");
    await fireEvent.input(input, { target: { value: "task" } });

    listeners.searchResultUpdated({ matches: 5, activeMatchOrdinal: 4 });
    await tick();

    component.$set({ show: false });
    await tick();

    expect(api.stopFindInPage).toHaveBeenCalled();
    expect(input).toHaveValue("");
    expect(screen.getByText((content) => content.replace(/\s+/g, " ").trim() === "0 / 0")).toBeInTheDocument();
  });
});
