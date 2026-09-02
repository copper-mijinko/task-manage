import { describe, expect, it, vi } from "vitest";
import {
  assertSupportedNodeVersion,
  findRendererTarget,
  parseVerifyOptions,
  probeAgentUi,
  waitForAgentUi,
} from "../../scripts/agent-ui-runtime.mjs";

const endpoint = "http://127.0.0.1:9222";
const rendererTarget = {
  id: "renderer",
  title: "task-manage",
  type: "page",
  url: "http://localhost:5173/",
  webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/renderer",
};
const readyRuntime = {
  bridgeType: "object",
  href: "http://localhost:5173/",
  preloadMethods: {
    getProjectIDs: true,
    windowGetState: true,
    wsGetWorkspaces: true,
  },
  readyState: "complete",
  title: "task-manage",
  userAgent: "Mozilla/5.0 Electron/38.0.0",
};

function okJson(value) {
  return { ok: true, json: async () => value };
}

function successfulFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce(okJson({ Browser: "Chrome/140 Electron/38" }))
    .mockResolvedValueOnce(okJson([rendererTarget]));
}

describe("agent UI runtime verification", () => {
  it("parses wait and JSON options", () => {
    expect(parseVerifyOptions(["--wait=30000", "--json"])).toEqual({
      help: false,
      json: true,
      waitMs: 30_000,
    });
  });

  it.each(["-1", "abc", "120001"])("rejects invalid wait value %j", (value) => {
    expect(() => parseVerifyOptions([`--wait=${value}`])).toThrow(/--wait/);
  });

  it("accepts the repository Node.js range", () => {
    expect(() => assertSupportedNodeVersion("22.12.0")).not.toThrow();
    expect(() => assertSupportedNodeVersion("22.20.0")).not.toThrow();
    expect(() => assertSupportedNodeVersion("23.0.0")).toThrow(/22\.12/);
  });

  it("selects only the expected Electron renderer target", () => {
    expect(
      findRendererTarget([
        { id: "devtools", type: "page", url: "devtools://devtools/" },
        { id: "wrong-port", type: "page", url: "http://localhost:5174/" },
        {
          id: "detail",
          type: "page",
          url: "http://localhost:5173/detail.html?taskId=task",
        },
        rendererTarget,
      ])
    ).toBe(rendererTarget);
  });

  it("confirms Vite, CDP, Electron identity, and the preload bridge", async () => {
    const fetchImpl = successfulFetch();
    const inspectRendererImpl = vi.fn().mockResolvedValue(readyRuntime);

    await expect(probeAgentUi({ endpoint, fetchImpl, inspectRendererImpl })).resolves.toMatchObject(
      {
        endpoint,
        renderer: { id: "renderer", url: "http://localhost:5173/" },
        checks: {
          vite: { ready: true },
          cdp: { ready: true },
          electron: { ready: true },
          preload: { ready: true },
        },
      }
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://localhost:5173/",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${endpoint}/json/version`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      `${endpoint}/json/list`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(inspectRendererImpl).toHaveBeenCalledWith(rendererTarget);
  });

  it("distinguishes a missing Vite process", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect failed"));
    await expect(probeAgentUi({ endpoint, fetchImpl })).rejects.toMatchObject({
      code: "VITE_UNAVAILABLE",
      stage: "vite",
    });
  });

  it("distinguishes an unavailable CDP endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("connect failed"));
    await expect(probeAgentUi({ endpoint, fetchImpl })).rejects.toMatchObject({
      code: "CDP_UNAVAILABLE",
      stage: "cdp",
    });
  });

  it("distinguishes CDP without a task-manage renderer", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(okJson({ Browser: "Chrome/140" }))
      .mockResolvedValueOnce(okJson([]));
    await expect(probeAgentUi({ endpoint, fetchImpl })).rejects.toMatchObject({
      code: "RENDERER_NOT_FOUND",
      stage: "renderer",
    });
  });

  it("rejects a normal browser renderer", async () => {
    const inspectRendererImpl = vi.fn().mockResolvedValue({
      ...readyRuntime,
      userAgent: "Mozilla/5.0 Chrome/140.0.0.0",
    });
    await expect(
      probeAgentUi({ endpoint, fetchImpl: successfulFetch(), inspectRendererImpl })
    ).rejects.toMatchObject({ code: "NOT_ELECTRON", stage: "electron" });
  });

  it("rejects an Electron renderer without the task-manage preload bridge", async () => {
    const inspectRendererImpl = vi.fn().mockResolvedValue({
      ...readyRuntime,
      bridgeType: "undefined",
      preloadMethods: {},
    });
    await expect(
      probeAgentUi({ endpoint, fetchImpl: successfulFetch(), inspectRendererImpl })
    ).rejects.toMatchObject({
      code: "PRELOAD_MISSING",
      details: {
        missingMethods: ["getProjectIDs", "windowGetState", "wsGetWorkspaces"],
      },
      stage: "preload",
    });
  });

  it("marks a failed wait as timed out while preserving the root diagnostic", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect failed"));
    await expect(
      waitForAgentUi({ endpoint, fetchImpl, retryIntervalMs: 1, waitMs: 2 })
    ).rejects.toMatchObject({
      code: "VITE_UNAVAILABLE",
      details: { waitMs: 2 },
      timedOut: true,
    });
  });
});
