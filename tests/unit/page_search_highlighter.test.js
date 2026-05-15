import { get } from "svelte/store";

import {
  setQuery,
  next,
  prev,
  rescan,
  pageSearchMatchCount,
  pageSearchCurrentIndex,
} from "@features/search/utils/page_search_highlighter";

// CSS.highlights is a Map<string, Highlight>. jsdom doesn't ship the Custom
// Highlight API yet, so we provide a Map-based shim plus a trivial Highlight
// constructor that just remembers its ranges. That's enough to assert that
// our highlighter applies / clears the named highlights correctly.
class HighlightMock {
  constructor(...ranges) {
    this.ranges = ranges;
  }
}

const highlightsStore = new Map();

let originalGetBCR;

beforeAll(() => {
  // The highlighter feature-detects via `window.Highlight` and
  // `window.CSS.highlights`. jsdom doesn't ship the Custom Highlight API, so
  // we attach shims directly to the same `window` object the module reads.
  window.Highlight = HighlightMock;
  if (!window.CSS) window.CSS = {};
  Object.defineProperty(window.CSS, "highlights", {
    configurable: true,
    value: highlightsStore,
  });

  // jsdom returns a zero-size rect for every element by default, which our
  // visibility filter rejects. Replace getBoundingClientRect with a stub
  // that respects `display: none` / `visibility: hidden` via computed style
  // but reports a non-zero size for everything else.
  originalGetBCR = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const cs = window.getComputedStyle(this);
    if (cs.display === "none" || cs.visibility === "hidden") {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    }
    return { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0 };
  };
});

afterAll(() => {
  if (originalGetBCR) Element.prototype.getBoundingClientRect = originalGetBCR;
});

beforeEach(() => {
  document.body.innerHTML = "";
  highlightsStore.clear();
});

function flushDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

describe("page_search_highlighter", () => {
  test("scans visible text and registers a 'page-search' highlight", async () => {
    document.body.innerHTML = `<div>hello world</div><div>hello again</div>`;

    setQuery("hello");
    await flushDebounce();

    expect(highlightsStore.get("page-search")).toBeDefined();
    expect(highlightsStore.get("page-search").ranges.length).toBe(2);
    expect(get(pageSearchMatchCount)).toBe(2);
    expect(get(pageSearchCurrentIndex)).toBe(0);
  });

  test("clearing the query removes the highlight", async () => {
    document.body.innerHTML = `<div>hello</div>`;
    setQuery("hello");
    await flushDebounce();
    expect(highlightsStore.get("page-search")).toBeDefined();

    setQuery("");
    await flushDebounce();

    expect(highlightsStore.has("page-search")).toBe(false);
    expect(get(pageSearchMatchCount)).toBe(0);
    expect(get(pageSearchCurrentIndex)).toBe(-1);
  });

  test("skips text inside elements marked data-page-search-skip", async () => {
    document.body.innerHTML = `
      <div>hello visible</div>
      <header data-page-search-skip><span>hello hidden</span></header>
    `;

    setQuery("hello");
    await flushDebounce();

    expect(get(pageSearchMatchCount)).toBe(1);
  });

  test("skips text inside <input>, <textarea>, and <select>", async () => {
    document.body.innerHTML = `
      <p>hello visible</p>
      <input value="hello inside input" />
      <textarea>hello inside textarea</textarea>
      <select><option>hello inside option</option></select>
    `;

    setQuery("hello");
    await flushDebounce();

    // Note: option text DOES live in a text node, but it's inside <select>,
    // which is in our SKIP selector.
    expect(get(pageSearchMatchCount)).toBe(1);
  });

  test("next() and prev() cycle currentIndex with wrap-around", async () => {
    document.body.innerHTML = `<div>aa</div><div>aa</div><div>aa</div>`;
    setQuery("aa");
    await flushDebounce();

    expect(get(pageSearchCurrentIndex)).toBe(0);
    next();
    expect(get(pageSearchCurrentIndex)).toBe(1);
    next();
    expect(get(pageSearchCurrentIndex)).toBe(2);
    next();
    expect(get(pageSearchCurrentIndex)).toBe(0); // wrap

    prev();
    expect(get(pageSearchCurrentIndex)).toBe(2); // wrap backwards
  });

  test("rescan() picks up DOM additions while the query is active", async () => {
    document.body.innerHTML = `<div>hello</div>`;
    setQuery("hello");
    await flushDebounce();
    expect(get(pageSearchMatchCount)).toBe(1);

    // New content appears (e.g. a memo loads). The Header / App calls
    // rescan() — verify it picks it up.
    const newNode = document.createElement("div");
    newNode.textContent = "hello again";
    document.body.appendChild(newNode);
    rescan();

    expect(get(pageSearchMatchCount)).toBe(2);
  });

  test("registers a separate 'page-search-current' highlight for the active match", async () => {
    document.body.innerHTML = `<div>cc</div><div>cc</div>`;
    setQuery("cc");
    await flushDebounce();

    expect(highlightsStore.get("page-search-current")).toBeDefined();
    expect(highlightsStore.get("page-search-current").ranges.length).toBe(1);
  });

  test("ignores zero-size (collapsed) elements", async () => {
    document.body.innerHTML = `
      <div>visible hello</div>
      <div style="display:none">hidden hello</div>
    `;

    setQuery("hello");
    await flushDebounce();

    expect(get(pageSearchMatchCount)).toBe(1);
  });
});
