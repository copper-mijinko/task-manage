import { performance } from "perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { probeEventLoop } from "../../tools/event-loop-probe.js";

describe("probeEventLoop", () => {
  it("records blocking work performed after an async boundary", async () => {
    const metrics = { record: vi.fn() };

    const result = await probeEventLoop(
      metrics,
      "tail-block",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const blockUntil = performance.now() + 35;
        while (performance.now() < blockUntil) {
          // Simulate synchronous filesystem or CPU work at the end of an async operation.
        }
        return "done";
      },
      { heartbeatMs: 2 }
    );

    expect(result).toBe("done");
    expect(metrics.record).toHaveBeenCalledOnce();
    expect(metrics.record.mock.calls[0][0]).toBe("eventLoop.tail-block");
    expect(metrics.record.mock.calls[0][1]).toBeGreaterThan(20);
  });

  it("records a sample and preserves an operation error", async () => {
    const metrics = { record: vi.fn() };

    await expect(
      probeEventLoop(
        metrics,
        "failure",
        async () => {
          throw new Error("expected failure");
        },
        { heartbeatMs: 1 }
      )
    ).rejects.toThrow("expected failure");

    expect(metrics.record).toHaveBeenCalledOnce();
    expect(metrics.record.mock.calls[0][0]).toBe("eventLoop.failure");
  });
});
