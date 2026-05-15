import { vi } from "vitest";
import { globalDismiss } from "@lib/actions";

describe("globalDismiss", () => {
  let panel;
  let outside;
  let disabled;

  beforeEach(() => {
    document.body.innerHTML = "";
    panel = document.createElement("div");
    panel.id = "panel";
    panel.textContent = "panel content";
    document.body.appendChild(panel);

    outside = document.createElement("button");
    outside.id = "outside";
    outside.textContent = "other button";
    document.body.appendChild(outside);

    disabled = document.createElement("button");
    disabled.id = "disabled-btn";
    disabled.disabled = true;
    disabled.textContent = "disabled button";
    document.body.appendChild(disabled);
  });

  test("calls the callback when pointerdown fires outside the node", () => {
    const cb = vi.fn();
    const action = globalDismiss(panel, cb);

    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(cb).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  test("does not call the callback when the click is inside the node", () => {
    const cb = vi.fn();
    const action = globalDismiss(panel, cb);

    panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(cb).not.toHaveBeenCalled();
    action.destroy();
  });

  test("calls the callback for clicks on disabled buttons (pointerdown still fires)", () => {
    // Disabled buttons suppress `click` and (in some browsers) `mousedown` to
    // themselves, but `pointerdown` still bubbles. globalDismiss listens at the
    // capture phase for pointerdown so disabled-button clicks close the menu.
    const cb = vi.fn();
    const action = globalDismiss(panel, cb);

    disabled.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(cb).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  test("Escape key dismisses the panel", () => {
    const cb = vi.fn();
    const action = globalDismiss(panel, cb);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(cb).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  test("other keys do not dismiss", () => {
    const cb = vi.fn();
    const action = globalDismiss(panel, cb);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(cb).not.toHaveBeenCalled();
    action.destroy();
  });

  test("contextmenu outside the node dismisses", () => {
    const cb = vi.fn();
    const action = globalDismiss(panel, cb);

    outside.dispatchEvent(new Event("contextmenu", { bubbles: true }));

    expect(cb).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  test("update() swaps the callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const action = globalDismiss(panel, first);

    action.update(second);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  test("destroy() removes the listeners", () => {
    const cb = vi.fn();
    const action = globalDismiss(panel, cb);
    action.destroy();

    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(cb).not.toHaveBeenCalled();
  });
});
