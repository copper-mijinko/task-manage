import { describe, expect, it, vi } from "vitest";
import {
  assertSupportedNodeVersion,
  findRendererTarget,
  parseVerifyOptions,
  probeAgentUi,
} from "../../scripts/agent-ui-runtime.mjs";

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
    const expected = { id: "renderer", type: "page", url: "http://localhost:5173/" };
    expect(
      findRendererTarget([
        { id: "devtools", type: "page", url: "devtools://devtools/" },
        { id: "wrong-port", type: "page", url: "http://localhost:5174/" },
        expected,
      ])
    ).toBe(expected);
  });

  it("checks both CDP and the Vite renderer", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "renderer",
            title: "task-manage",
            type: "page",
            url: "http://localhost:5173/",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(
      probeAgentUi({ endpoint: "http://127.0.0.1:9222", fetchImpl })
    ).resolves.toMatchObject({
      endpoint: "http://127.0.0.1:9222",
      renderer: { id: "renderer", url: "http://localhost:5173/" },
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9222/json/list",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://localhost:5173/",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
