import "@testing-library/jest-dom/vitest";

// jsdom has no layout engine. Real popover geometry is verified in Electron.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!globalThis.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(globalThis.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value() {},
  });
}

if (!globalThis.Element.prototype.animate) {
  Object.defineProperty(globalThis.Element.prototype, "animate", {
    configurable: true,
    value() {
      return {
        cancel() {},
        commitStyles() {},
        finished: Promise.resolve(),
        play() {},
      };
    },
  });
}
