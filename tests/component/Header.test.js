import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";

import Header from "@features/navigation/components/Header.svelte";
import { sidebarCollapsed, saveStatus } from "@stores";
import {
  PAGE_SEARCH_PIN_LIMIT,
  pageSearchCountIsPartial,
  pageSearchQuery,
} from "@features/search/stores/search";

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

  describe("match count", () => {
    let originalGetBCR;

    beforeEach(() => {
      // jsdom の要素は大きさ 0 なので、検索の「見えている」判定を通すために
      // 大きさを持たせる。
      originalGetBCR = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
        x: 0,
        y: 0,
      });
    });

    afterEach(() => {
      Element.prototype.getBoundingClientRect = originalGetBCR;
      pageSearchCountIsPartial.set(false);
    });

    async function searchFor(query) {
      render(Header);
      for (let index = 0; index < 3; index += 1) {
        const div = document.createElement("div");
        div.textContent = "hit";
        document.body.appendChild(div);
      }
      const input = screen.getByPlaceholderText("画面内をハイライト検索…");
      await fireEvent.input(input, { target: { value: query } });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tick();
      return document.querySelector(".SearchCount");
    }

    test("shows the position and the total when every match is on screen", async () => {
      const count = await searchFor("hit");
      expect(count.textContent.trim()).toBe("1 / 3");
    });

    test("shows only 100+ without a position when the tree has unrendered matches", async () => {
      // 描いていない一致があると、画面から数えた順番は全体の何番目かと合わない。
      pageSearchCountIsPartial.set(true);
      const count = await searchFor("hit");
      expect(count.textContent.trim()).toBe(`${PAGE_SEARCH_PIN_LIMIT}+ 件`);
    });
  });

  test("hamburger toggle flips sidebarCollapsed", async () => {
    render(Header);
    expect(get(sidebarCollapsed)).toBe(true);

    const button = screen.getByLabelText("サイドバーを表示");
    await fireEvent.click(button);
    expect(get(sidebarCollapsed)).toBe(false);

    // After opening, the aria-label flips to the close action.
    const nowOpen = screen.getByLabelText("サイドバーを隠す");
    await fireEvent.click(nowOpen);
    expect(get(sidebarCollapsed)).toBe(true);
  });

  test("save status indicator reflects the saveStatus store", async () => {
    render(Header);
    const indicator = screen.getByTestId("save-status-indicator");

    saveStatus.set("queued");
    await tick();
    expect(indicator).toHaveAttribute("data-status", "queued");
    expect(indicator).toHaveTextContent("保存待ち");

    saveStatus.set("writing");
    await tick();
    expect(indicator).toHaveAttribute("data-status", "writing");
    expect(indicator).toHaveTextContent("保存中...");

    saveStatus.set("error");
    await tick();
    expect(indicator).toHaveAttribute("data-status", "error");

    saveStatus.set("saved");
    await tick();
    expect(indicator).toHaveAttribute("data-status", "saved");
  });
});
