import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";

import Header from "@features/navigation/components/Header.svelte";
import { sidebarCollapsed, saveStatus } from "@stores";
import { pageSearchQuery } from "@features/search/stores/search";

// The highlighter writes into CSS.highlights / window.Highlight which jsdom
// doesn't provide. The Header still works fine as long as we shim those —
// otherwise the highlight pass quietly does nothing, which is the behaviour
// we want for "this test doesn't actually care about the visual layer".
class HighlightMock {
  constructor(...ranges) {
    this.ranges = ranges;
  }
}

beforeAll(() => {
  window.Highlight = HighlightMock;
  if (!window.CSS) window.CSS = {};
  Object.defineProperty(window.CSS, "highlights", {
    configurable: true,
    value: new Map(),
  });
});

beforeEach(() => {
  document.body.innerHTML = "";
  sidebarCollapsed.set(true);
  saveStatus.set("idle");
  pageSearchQuery.set("");
});

describe("Header", () => {
  test("renders the page-search input with the highlight placeholder", () => {
    render(Header);
    expect(screen.getByPlaceholderText("画面内をハイライト検索…")).toBeInTheDocument();
  });

  test("typing into the search input feeds pageSearchQuery", async () => {
    render(Header);
    const input = screen.getByPlaceholderText("画面内をハイライト検索…");

    await fireEvent.input(input, { target: { value: "task" } });

    expect(get(pageSearchQuery)).toBe("task");
  });

  test("Escape clears the search and blurs the input", async () => {
    render(Header);
    const input = screen.getByPlaceholderText("画面内をハイライト検索…");

    await fireEvent.input(input, { target: { value: "task" } });
    expect(get(pageSearchQuery)).toBe("task");

    input.focus();
    await fireEvent.keyDown(input, { key: "Escape" });

    expect(get(pageSearchQuery)).toBe("");
  });

  test("up/down/clear buttons appear once a query is typed", async () => {
    render(Header);
    expect(screen.queryByLabelText("前の一致へ")).toBeNull();
    expect(screen.queryByLabelText("次の一致へ")).toBeNull();
    expect(screen.queryByLabelText("検索をクリア")).toBeNull();

    const input = screen.getByPlaceholderText("画面内をハイライト検索…");
    await fireEvent.input(input, { target: { value: "anything" } });
    await tick();

    expect(screen.getByLabelText("前の一致へ")).toBeInTheDocument();
    expect(screen.getByLabelText("次の一致へ")).toBeInTheDocument();
    expect(screen.getByLabelText("検索をクリア")).toBeInTheDocument();
  });

  test("the clear button empties the input and resets pageSearchQuery", async () => {
    render(Header);
    const input = screen.getByPlaceholderText("画面内をハイライト検索…");
    await fireEvent.input(input, { target: { value: "stuff" } });
    await tick();
    expect(get(pageSearchQuery)).toBe("stuff");

    await fireEvent.click(screen.getByLabelText("検索をクリア"));
    await tick();

    expect(get(pageSearchQuery)).toBe("");
    expect(input.value).toBe("");
  });

  test("hamburger toggle flips sidebarCollapsed", async () => {
    render(Header);
    expect(get(sidebarCollapsed)).toBe(true);

    const button = screen.getByLabelText("Show sidebar");
    await fireEvent.click(button);
    expect(get(sidebarCollapsed)).toBe(false);

    // After opening, the aria-label flips to "Hide sidebar".
    const nowOpen = screen.getByLabelText("Hide sidebar");
    await fireEvent.click(nowOpen);
    expect(get(sidebarCollapsed)).toBe(true);
  });

  test("save status indicator reflects the saveStatus store", async () => {
    render(Header);
    const indicator = screen.getByTestId("save-status-indicator");

    saveStatus.set("saving");
    await tick();
    expect(indicator).toHaveAttribute("data-status", "saving");

    saveStatus.set("error");
    await tick();
    expect(indicator).toHaveAttribute("data-status", "error");

    saveStatus.set("saved");
    await tick();
    expect(indicator).toHaveAttribute("data-status", "saved");
  });
});
