import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

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

  test("snap-collapses the left pane to mini size when released below the threshold", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);
    // Harness root is 400 wide, split 50/50 → both panes start at ~200px.
    // min-width is 128px, the fixed snap threshold is 80px, MINI_PANE_SIZE is 64px.
    // Drag the resizer hard left to clientX=10 (well below threshold).
    drag(resizer, 200, 10);
    await tick();

    // Pane snaps to MINI_PANE_SIZE (64px) instead of collapsing to 0.
    expect(panes[0].classList.contains("PaneMini")).toBe(true);
    expect(panes[0].style.width).toBe("64px");
    // Inline min-width override ensures the pane can sit below its CSS min.
    expect(panes[0].style.minWidth).toBe("0px");
    // Placeholder Card div is injected.
    expect(panes[0].querySelector(".PaneMiniPlaceholder")).not.toBeNull();
  });

  test("clamps to min-width when released between snap-threshold and min", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);
    // Drag to 100px — above the 80px snap threshold but below the 128px min.
    // Should clamp UP to the configured 128px min-width and NOT enter mini state.
    drag(resizer, 200, 100);
    await tick();

    expect(panes[0].classList.contains("PaneMini")).toBe(false);
    expect(parseFloat(panes[0].style.width)).toBeGreaterThanOrEqual(127);
  });

  test("re-expands a mini pane when the resizer is dragged back", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);

    // First collapse to mini.
    drag(resizer, 200, 10);
    await tick();
    expect(panes[0].classList.contains("PaneMini")).toBe(true);

    // Drag back well past the snap threshold (pane is now 64px wide).
    drag(resizer, 0, 200);
    await tick();

    expect(panes[0].classList.contains("PaneMini")).toBe(false);
    // The temporary zero minimum is removed and the pane's declared minimum
    // is restored rather than being lost across collapse/expand cycles.
    expect(panes[0].style.minWidth).toBe("128px");
    // Placeholder has been removed from the DOM.
    expect(panes[0].querySelector(".PaneMiniPlaceholder")).toBeNull();
  });

  test("snap-collapses the right pane to mini size when released below the threshold", async () => {
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);
    // Drag the resizer hard right to clientX=390 (right pane shrinks to ~10px).
    drag(resizer, 200, 390);
    await tick();

    expect(panes[1].classList.contains("PaneMini")).toBe(true);
    expect(panes[1].style.width).toBe("64px");
    expect(panes[1].style.minWidth).toBe("0px");
    expect(panes[1].querySelector(":scope > .PaneMiniPlaceholder")).not.toBeNull();
  });

  test("snap-collapses the right pane even when dragged far beyond the viewport edge", async () => {
    // Repro for: dragging the resizer well past the container edge (off-screen)
    // must still snap the right pane to MINI_PANE_SIZE, not leave it at 0.
    const { container } = render(SplitPanesHarness);
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);
    // Container is 400px wide. Drag to clientX=5000 (way off-screen).
    drag(resizer, 200, 5000);
    await tick();

    expect(panes[1].classList.contains("PaneMini")).toBe(true);
    expect(panes[1].style.width).toBe("64px");
    expect(panes[0].style.width).toBe("336px");
  });

  test("keeps the tree pane open and collapses the detail pane to the draggable edge", async () => {
    const { container } = render(SplitPanesHarness, {
      props: {
        defaultRatio: [3, 2],
        collapsePriority: "end",
        collapseSize: 0,
        separatorLabel: "ツリーと詳細の幅を変更",
        paneMinWidth: "10rem",
      },
    });
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);

    expect(resizer).toHaveAttribute("role", "separator");
    expect(resizer).toHaveAttribute("aria-label", "ツリーと詳細の幅を変更");

    // Moving left cannot collapse the priority tree pane; it stops at its
    // declared minimum and leaves the detail pane available.
    drag(resizer, 240, 10);
    await tick();
    expect(panes[0]).not.toHaveClass("PaneCollapsed");
    expect(parseFloat(panes[0].style.width)).toBeGreaterThanOrEqual(160);

    // Moving right collapses only the detail pane to the edge. The separator
    // remains in the DOM and can be dragged left to restore the detail pane.
    drag(resizer, 128, 5000);
    await tick();
    expect(panes[1]).toHaveClass("PaneCollapsed");
    expect(panes[1].style.width).toBe("0px");
    expect(panes[1].querySelector(":scope > .PaneMiniPlaceholder")).toBeNull();
    expect(resizer).toBeInTheDocument();

    drag(resizer, 395, 250);
    await tick();
    expect(panes[1]).not.toHaveClass("PaneCollapsed");
    expect(parseFloat(panes[1].style.width)).toBeGreaterThanOrEqual(160);
  });

  test("keeps the edge separator usable when the detail pane is collapsed externally", async () => {
    const { container } = render(SplitPanesHarness, {
      props: {
        defaultRatio: [3, 2],
        collapsePriority: "end",
        collapseSize: 0,
        collapsedPane: "end",
        separatorLabel: "ツリーと詳細の幅を変更",
      },
    });
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);
    expect(panes[1]).toHaveClass("PaneCollapsed");
    expect(resizer).toHaveAttribute("aria-valuenow", "100");
    expect(resizer).toHaveAttribute(
      "aria-valuetext",
      "詳細欄をたたんでいます。左へドラッグすると表示できます"
    );

    await fireEvent.keyDown(resizer, { key: "Enter" });
    await tick();
    expect(panes[1]).not.toHaveClass("PaneCollapsed");
    expect(parseFloat(panes[1].style.width)).toBeGreaterThanOrEqual(128);
  });

  test("supports arrow resizing and Home/End collapse from the keyboard", async () => {
    const { container } = render(SplitPanesHarness, {
      props: {
        collapsePriority: "end",
        collapseSize: 0,
        paneMinWidth: "10rem",
      },
    });
    await tick();

    const resizer = container.querySelector(".Resizer");
    const panes = getPanes(container);
    await fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(parseFloat(panes[0].style.width)).toBeGreaterThan(200);

    await fireEvent.keyDown(resizer, { key: "End" });
    expect(panes[1]).toHaveClass("PaneCollapsed");

    await fireEvent.keyDown(resizer, { key: "Home" });
    expect(panes[0]).not.toHaveClass("PaneCollapsed");
    expect(parseFloat(panes[0].style.width)).toBeGreaterThanOrEqual(160);
  });

  test("restores and updates a persisted pane ratio", async () => {
    const getMetaData = vi.fn().mockResolvedValue({ ratio: [0.7, 0.3], collapsedPane: null });
    const setMetaData = vi.fn();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { getMetaData, setMetaData },
    });

    const { container } = render(SplitPanesHarness, {
      props: { persistenceKey: "layout.test" },
    });
    await tick();
    await Promise.resolve();
    await tick();

    const panes = getPanes(container);
    expect(getMetaData).toHaveBeenCalledWith("layout.test");
    expect(parseFloat(panes[0].style.width)).toBeCloseTo(280, 0);

    const resizer = container.querySelector(".Resizer");
    await fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    const persistedLayout = setMetaData.mock.calls.at(-1)?.[1];
    expect(setMetaData).toHaveBeenLastCalledWith("layout.test", persistedLayout);
    expect(persistedLayout).toEqual(
      expect.objectContaining({
        ratio: [expect.closeTo(0.65, 2), expect.closeTo(0.35, 2)],
        collapsedPane: null,
      })
    );

    delete window.electronAPI;
  });

  test("does not create a stray placeholder when nested SplitPanes are present", async () => {
    // Verify the :scope > selector fix: a placeholder appended to an inner
    // pane must not be visible to the outer pane's applyPaneSize.
    const { container } = render(SplitPanesHarness);
    await tick();

    const panes = getPanes(container);
    // Simulate a nested SplitPanes inside the right pane that has its own
    // mini placeholder (e.g., user collapsed the top pane of an inner
    // vertical split before collapsing the outer left pane).
    const nestedRoot = document.createElement("div");
    nestedRoot.classList.add("SplitPaneRoot");
    const nestedPane = document.createElement("div");
    nestedPane.classList.add("Pane", "PaneMini");
    const nestedPlaceholder = document.createElement("div");
    nestedPlaceholder.classList.add("PaneMiniPlaceholder");
    nestedPane.appendChild(nestedPlaceholder);
    nestedRoot.appendChild(nestedPane);
    panes[1].appendChild(nestedRoot);

    // Now collapse the LEFT outer pane. The fix should NOT touch the
    // nested placeholder inside the right pane.
    const resizer = container.querySelector(".Resizer");
    drag(resizer, 200, 10);
    await tick();

    // Left pane got its own placeholder.
    expect(panes[0].querySelector(":scope > .PaneMiniPlaceholder")).not.toBeNull();
    // Nested placeholder inside right pane is untouched.
    expect(nestedPlaceholder.isConnected).toBe(true);
    expect(nestedPane.contains(nestedPlaceholder)).toBe(true);
  });
});
