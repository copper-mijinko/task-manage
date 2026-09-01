import { describe, expect, it, vi } from "vitest";
import { createWorkspaceCacheLoader } from "../../electron/workspace-cache.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createWorkspaceCacheLoader", () => {
  it("shares one in-flight load per project", async () => {
    const cache = new Map();
    const pending = deferred();
    const load = vi.fn(() => pending.promise);
    const loader = createWorkspaceCacheLoader({ cache, load });

    const first = loader.ensure("project-a");
    const second = loader.ensure("project-a");
    expect(load).toHaveBeenCalledOnce();

    const loaded = { tasks: new Map([["task-a", { id: "task-a" }]]) };
    pending.resolve(loaded);

    await expect(first).resolves.toBe(loaded);
    await expect(second).resolves.toBe(loaded);
    expect(cache.get("project-a")).toBe(loaded);
  });

  it("keeps a newer cache value written while the load is pending", async () => {
    const cache = new Map();
    const pending = deferred();
    const loader = createWorkspaceCacheLoader({ cache, load: () => pending.promise });

    const result = loader.ensure("project-a");
    const newer = { tasks: new Map([["new", { id: "new" }]]) };
    cache.set("project-a", newer);
    pending.resolve({ tasks: new Map([["old", { id: "old" }]]) });

    await expect(result).resolves.toBe(newer);
    expect(cache.get("project-a")).toBe(newer);
  });

  it("clears a failed in-flight load so the next request can retry", async () => {
    const cache = new Map();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ tasks: new Map() });
    const loader = createWorkspaceCacheLoader({ cache, load });

    await expect(loader.ensure("project-a")).rejects.toThrow("temporary failure");
    await expect(loader.ensure("project-a")).resolves.toEqual({ tasks: new Map() });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
