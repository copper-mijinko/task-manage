import { render } from "@testing-library/svelte";
import { tick } from "svelte";

import SplitPanesHarness from "../mocks/SplitPanesHarness.svelte";

class ResizeObserverMock {
  constructor(callback) {
    this.callback = callback;
  }

  observe(target) {
    this.callback([{ contentRect: { width: 400, height: 300 }, target }]);
  }

  disconnect() {}
}

/**
 * Fire a sequence of mouse events for a drag: mousedown on the resizer,
 * mousemove (one or more times) on document, then mouseup.
 *
 * SplitPanes binds mousedown directly on the resizer element and bind
 * mousemove/mouseup on `document` from its mousedown handler, so we replay
 * the same target topology here.
 */
function drag(resizer, fromClientX, toClientX) {
  const mousedown = new MouseEvent("mousedown", {
    bubbles: true,
    clientX: fromClientX,
    clientY: 0,
  });
  resizer.dispatchEvent(mousedown);

  const mousemove = new MouseEvent("mousemove", {
    bubbles: true,
    clientX: toClientX,
    clientY: 0,
  });
  document.dispatchEvent(mousemove);

  const mouseup = new MouseEvent("mouseup", {
    bubbles: true,
    clientX: toClientX,
    clientY: 0,
  });
  document.dispatchEvent(mouseup);
}

function getPanes(container) {
  return container.querySelectorAll(":scope > div > div.SplitPaneRoot > div.Pane");
}

describe("SplitPanes", () => {
  const OriginalResizeObserver = globalThis.ResizeObserver;
  let originalGetBCR;

  beforeAll(() => {
    // jsdom returns a zero-width rect for every element by default, which
    // breaks the resizer math (size = pane.getBoundingClientRect().width).
    // Replace it with a stub that returns whatever the element's inline
    // style.width is — that's what SplitPanes manipulates and reads back.
    originalGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const widthStr = this.style?.width;
      let width = 200;
      if (widthStr && widthStr.endsWith("px")) {
        width = parseFloat(widthStr);
      } else if (this.classList?.contains("SplitPaneRoot") || this.parentElement?.style?.width) {
        // Root container — pick up the harness's outer fixed width (400px).
        width = 400;
      }
      return {
        width,
        height: 300,
        top: 0,
        left: 0,
        right: width,
        bottom: 300,
        x: 0,
        y: 0,
      };
    };
  });

  afterAll(() => {
    if (originalGetBCR) Element.prototype.getBoundingClientRect = originalGetBCR;
  });

  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterEach(() => {
    globalThis.ResizeObserver = OriginalResizeObserver;
  });

  test("lets resizer height follow the split pane root", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");

    expect(resizer).toBeInTheDocument();
    expect(resizer.style.height).toBe("");
  });

  test("snap-collapses the left pane when released below the threshold", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);
    // Harness root is 400 wide, split 50/50 → both panes start at ~200px.
    // The min-width is `4rem` (64px). The snap threshold is 64*0.6 = 38.4px.
    // Drag the resizer hard left to clientX=10 (well below threshold).
    drag(resizer, 200, 10);
    await tick();

    expect(panes[0].classList.contains("PaneCollapsed")).toBe(true);
    expect(panes[0].style.width).toBe("0px");
    // Also explicitly overrides CSS min-width so the body doesn't peek out.
    expect(panes[0].style.minWidth).toBe("0px");
  });

  test("clamps to min-width when released between snap-threshold and min", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);
    // Drag to ~50px — above the 38px snap threshold but below the 64px min.
    // Should clamp UP to the configured 4rem (64px) min-width and NOT collapse.
    drag(resizer, 200, 50);
    await tick();

    expect(panes[0].classList.contains("PaneCollapsed")).toBe(false);
    expect(parseFloat(panes[0].style.width)).toBeGreaterThanOrEqual(63);
  });

  test("re-expands a collapsed pane when the resizer is dragged back", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);

    // First collapse it.
    drag(resizer, 200, 10);
    await tick();
    expect(panes[0].classList.contains("PaneCollapsed")).toBe(true);

    // Now drag back well past the snap threshold.
    drag(resizer, 0, 150);
    await tick();

    expect(panes[0].classList.contains("PaneCollapsed")).toBe(false);
    // The PaneCollapsed inline min-width override has been cleared so the
    // CSS min-width can apply again.
    expect(panes[0].style.minWidth).toBe("");
  });

  test("flags the resizer with HasCollapsedNeighbour while a neighbour is collapsed", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");

    drag(resizer, 200, 10);
    await tick();

    expect(resizer.classList.contains("HasCollapsedNeighbour")).toBe(true);

    // Expanding clears the flag.
    drag(resizer, 0, 150);
    await tick();
    expect(resizer.classList.contains("HasCollapsedNeighbour")).toBe(false);
  });
});
