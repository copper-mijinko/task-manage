import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_DEBUG_PORT,
  configureAgentDebugging,
  parseAgentDebugPort,
} from "../../electron/agent-debug.js";

function createElectronApp({ isPackaged = false } = {}) {
  return {
    isPackaged,
    commandLine: {
      appendSwitch: vi.fn(),
    },
  };
}

describe("agent UI debugging", () => {
  it("does nothing unless agent mode is explicitly enabled", () => {
    const app = createElectronApp();

    expect(configureAgentDebugging(app, { VITE_DEV: "true" })).toBeNull();
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it("binds CDP to loopback with the default port in development", () => {
    const app = createElectronApp();

    expect(
      configureAgentDebugging(app, {
        TASK_MANAGE_AGENT_UI: "true",
        VITE_DEV: "true",
      })
    ).toEqual({ host: "127.0.0.1", port: DEFAULT_AGENT_DEBUG_PORT });
    expect(app.commandLine.appendSwitch).toHaveBeenNthCalledWith(
      1,
      "remote-debugging-address",
      "127.0.0.1"
    );
    expect(app.commandLine.appendSwitch).toHaveBeenNthCalledWith(
      2,
      "remote-debugging-port",
      String(DEFAULT_AGENT_DEBUG_PORT)
    );
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
      "disable-background-timer-throttling"
    );
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-renderer-backgrounding");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
      "disable-backgrounding-occluded-windows"
    );
  });

  it("accepts a valid custom port", () => {
    expect(parseAgentDebugPort("9333")).toBe(9333);
  });

  it.each(["", "abc", "9222.5", "1023", "65536"])("rejects invalid port %j", (port) => {
    expect(() => parseAgentDebugPort(port)).toThrow(/between 1024 and 65535/);
  });

  it.each([
    [{ TASK_MANAGE_AGENT_UI: "true" }, /Vite development server/],
    [{ TASK_MANAGE_AGENT_UI: "true", VITE_DEV: "true", PLAYWRIGHT_TEST: "true" }, /automated E2E/],
  ])("rejects unsafe environments", (env, expectedError) => {
    expect(() => configureAgentDebugging(createElectronApp(), env)).toThrow(expectedError);
  });

  it("rejects packaged builds", () => {
    expect(() =>
      configureAgentDebugging(createElectronApp({ isPackaged: true }), {
        TASK_MANAGE_AGENT_UI: "true",
        VITE_DEV: "true",
      })
    ).toThrow(/packaged build/);
  });
});
