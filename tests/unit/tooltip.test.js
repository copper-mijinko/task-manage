import { tooltip } from "@lib/actions";

/**
 * Tests for the tooltip Svelte action's behaviour. We simulate the action's
 * lifecycle by hand (mount, update, destroy) and dispatch the same events
 * the action listens to. We also stub getBoundingClientRect and scrollWidth
 * so the action's "is the text actually truncated" heuristic considers the
 * tooltip visible.
 */

let originalGetBCR;

beforeAll(() => {
  originalGetBCR = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return {
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      width: 100,
      height: 20,
      x: 0,
      y: 0,
    };
  };
});

afterAll(() => {
  if (originalGetBCR) Element.prototype.getBoundingClientRect = originalGetBCR;
});

beforeEach(() => {
  document.body.innerHTML = "";
});

function newAnchor() {
  const el = document.createElement("button");
  el.textContent = "anchor";
  document.body.appendChild(el);
  return el;
}

function fireMouseEnter(el) {
  el.dispatchEvent(
    new MouseEvent("mouseenter", { bubbles: true, clientX: 0, clientY: 0 })
  );
}

function fireMouseLeave(el) {
  el.dispatchEvent(
    new MouseEvent("mouseleave", { bubbles: true, clientX: 0, clientY: 0 })
  );
}

function visibleTooltip() {
  return document.querySelector(".__tooltip-element");
}

describe("tooltip action", () => {
  test("shows the tooltip on mouseenter with the provided content (force=true)", () => {
    const el = newAnchor();
    const action = tooltip(el, { content: "hello", force: true });

    fireMouseEnter(el);

    const tip = visibleTooltip();
    expect(tip).toBeInTheDocument();
    expect(tip.textContent).toBe("hello");

    action.destroy();
  });

  test("hides the tooltip on mouseleave", () => {
    const el = newAnchor();
    const action = tooltip(el, { content: "hello", force: true });

    fireMouseEnter(el);
    expect(visibleTooltip()).toBeInTheDocument();

    fireMouseLeave(el);
    expect(visibleTooltip()).toBeNull();

    action.destroy();
  });

  test("update() reflects new content into a currently visible tooltip", () => {
    // Regression: the sidebar toggle button reuses the same IconButton with
    // changing tooltipContent ("Show sidebar" ⇄ "Hide sidebar"). Before the
    // update lifecycle, the visible tooltip text was frozen at mount time.
    const el = newAnchor();
    const action = tooltip(el, { content: "Show sidebar", force: true });

    fireMouseEnter(el);
    expect(visibleTooltip().textContent).toBe("Show sidebar");

    action.update({ content: "Hide sidebar", force: true });

    expect(visibleTooltip().textContent).toBe("Hide sidebar");
    action.destroy();
  });

  test("update() with disable=true removes the visible tooltip", () => {
    const el = newAnchor();
    const action = tooltip(el, { content: "hello", force: true });

    fireMouseEnter(el);
    expect(visibleTooltip()).toBeInTheDocument();

    action.update({ content: "hello", force: true, disable: true });

    expect(visibleTooltip()).toBeNull();
    action.destroy();
  });

  test("destroy() removes the tooltip if it was visible", () => {
    const el = newAnchor();
    const action = tooltip(el, { content: "hello", force: true });

    fireMouseEnter(el);
    expect(visibleTooltip()).toBeInTheDocument();

    action.destroy();

    expect(visibleTooltip()).toBeNull();
  });

  test("ghost cleanup: tooltips for detached anchors get swept", () => {
    const el = newAnchor();
    const action = tooltip(el, { content: "hello", force: true });

    fireMouseEnter(el);
    expect(visibleTooltip()).toBeInTheDocument();

    // Anchor is removed from the DOM WITHOUT a mouseleave (e.g. row was
    // virtualised away). The next document-level event should sweep the
    // ghost away.
    el.remove();
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(visibleTooltip()).toBeNull();
    action.destroy();
  });
});
