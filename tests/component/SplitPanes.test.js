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

describe("SplitPanes", () => {
  const OriginalResizeObserver = globalThis.ResizeObserver;

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
});
