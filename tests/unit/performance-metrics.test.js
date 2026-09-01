import { describe, expect, it, vi } from "vitest";
import { PerformanceMetrics } from "../../electron/performance-metrics.js";

describe("PerformanceMetrics", () => {
  it("reports p50, p95, and max without retaining unbounded samples", () => {
    const metrics = new PerformanceMetrics({ enabled: true, maxSamples: 4 });
    for (const value of [1, 2, 3, 4, 100]) {
      metrics.record("workspace.readProject", value);
    }

    expect(metrics.summary()).toEqual({
      "workspace.readProject": {
        count: 4,
        p50Ms: 3,
        p95Ms: 100,
        maxMs: 100,
      },
    });
  });

  it("does not measure or retain data while disabled", async () => {
    const metrics = new PerformanceMetrics({ enabled: false });
    const syncOperation = vi.fn(() => "sync-result");
    const asyncOperation = vi.fn(async () => "async-result");

    expect(metrics.measureSync("sync", syncOperation)).toBe("sync-result");
    await expect(metrics.measureAsync("async", asyncOperation)).resolves.toBe("async-result");
    expect(metrics.summary()).toEqual({});
  });

  it("records failed operations before rethrowing", async () => {
    const metrics = new PerformanceMetrics({ enabled: true });

    expect(() =>
      metrics.measureSync("sync.failure", () => {
        throw new Error("sync failure");
      })
    ).toThrow("sync failure");
    await expect(
      metrics.measureAsync("async.failure", async () => {
        throw new Error("async failure");
      })
    ).rejects.toThrow("async failure");

    expect(metrics.summary()["sync.failure"].count).toBe(1);
    expect(metrics.summary()["async.failure"].count).toBe(1);
  });

  it("reset clears all samples", () => {
    const metrics = new PerformanceMetrics({ enabled: true });
    metrics.record("metric", 5);
    metrics.reset();
    expect(metrics.summary()).toEqual({});
  });
});
