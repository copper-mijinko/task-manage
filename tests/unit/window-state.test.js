import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DEFAULT_STATE,
  loadWindowState,
  sanitizeWindowState,
  serializeWindowState,
  trackWindowState,
  writeWindowStateFile,
} from "../../electron/window-state.js";

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } });

describe("sanitizeWindowState", () => {
  const displays = [display(0, 0, 1920, 1040)];

  it("falls back to the defaults when nothing is saved", () => {
    const state = sanitizeWindowState(null, displays);
    expect(state.width).toBe(DEFAULT_STATE.width);
    expect(state.height).toBe(DEFAULT_STATE.height);
    expect(state.x).toBeUndefined();
    expect(state.isMaximized).toBe(false);
  });

  it("clamps a saved size to the minimum and to the work area", () => {
    expect(sanitizeWindowState({ width: 200, height: 100 }, displays)).toMatchObject({
      width: DEFAULT_STATE.minWidth,
      height: DEFAULT_STATE.minHeight,
    });
    expect(sanitizeWindowState({ width: 5000, height: 5000 }, displays)).toMatchObject({
      width: 1920,
      height: 1040,
    });
  });

  it("keeps a position that overlaps a display", () => {
    expect(sanitizeWindowState({ width: 900, height: 700, x: 120, y: 60 }, displays)).toMatchObject(
      {
        x: 120,
        y: 60,
      }
    );
  });

  it("drops a position left over from a disconnected display", () => {
    const state = sanitizeWindowState({ width: 900, height: 700, x: 3000, y: 200 }, displays);
    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
    expect(state.width).toBe(900);
  });

  it("restores the maximized flag", () => {
    expect(sanitizeWindowState({ isMaximized: true }, displays).isMaximized).toBe(true);
  });
});

describe("serializeWindowState", () => {
  it("rounds bounds and records the maximized flag", () => {
    expect(serializeWindowState({ x: 10.4, y: 20.6, width: 800.2, height: 600.8 }, true)).toEqual({
      x: 10,
      y: 21,
      width: 800,
      height: 601,
      isMaximized: true,
    });
  });

  it("skips fields that are not finite numbers", () => {
    expect(serializeWindowState({ x: NaN, width: 800 }, false)).toEqual({
      width: 800,
      isMaximized: false,
    });
  });
});

describe("loadWindowState", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "win-state-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips through the state file", () => {
    const file = path.join(tmpDir, "window-state.json");
    writeWindowStateFile(file, { width: 1100, height: 900, x: 40, y: 30, isMaximized: false });

    expect(loadWindowState(file, [display(0, 0, 1920, 1040)])).toMatchObject({
      width: 1100,
      height: 900,
      x: 40,
      y: 30,
      minWidth: DEFAULT_STATE.minWidth,
    });
  });

  it("uses the defaults when the file is missing or corrupt", () => {
    const missing = path.join(tmpDir, "nope.json");
    expect(loadWindowState(missing, []).width).toBe(DEFAULT_STATE.width);

    const corrupt = path.join(tmpDir, "corrupt.json");
    fs.writeFileSync(corrupt, "{not json");
    expect(loadWindowState(corrupt, []).height).toBe(DEFAULT_STATE.height);
  });
});

describe("trackWindowState", () => {
  function fakeWindow(bounds) {
    const listeners = new Map();
    return {
      bounds,
      maximized: false,
      fullScreen: false,
      on(event, handler) {
        listeners.set(event, handler);
      },
      emit(event) {
        listeners.get(event)?.();
      },
      isDestroyed: () => false,
      isMaximized() {
        return this.maximized;
      },
      isFullScreen() {
        return this.fullScreen;
      },
      isMinimized: () => false,
      getNormalBounds() {
        return this.bounds;
      },
      getBounds() {
        return this.bounds;
      },
    };
  }

  it("debounces writes while resizing and flushes on close", () => {
    vi.useFakeTimers();
    const win = fakeWindow({ x: 0, y: 0, width: 1000, height: 800 });
    const write = vi.fn();
    trackWindowState(win, "/tmp/state.json", { debounceMs: 100, write });

    win.emit("resize");
    win.emit("resize");
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(write).toHaveBeenCalledTimes(1);

    win.bounds = { x: 5, y: 5, width: 1200, height: 900 };
    win.emit("close");
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][1]).toMatchObject({ width: 1200, height: 900, isMaximized: false });
    vi.useRealTimers();
  });

  it("keeps the pre-maximize size so restoring does not inherit the full screen", () => {
    vi.useFakeTimers();
    const win = fakeWindow({ x: 20, y: 20, width: 1000, height: 800 });
    const write = vi.fn();
    trackWindowState(win, "/tmp/state.json", { debounceMs: 10, write });

    win.maximized = true;
    win.bounds = { x: 0, y: 0, width: 1920, height: 1040 };
    win.emit("maximize");
    vi.advanceTimersByTime(10);

    expect(write.mock.calls[0][1]).toMatchObject({
      width: 1000,
      height: 800,
      isMaximized: true,
    });
    vi.useRealTimers();
  });
});
