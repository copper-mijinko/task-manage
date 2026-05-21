import { describe, expect, test } from "vitest";
import { WorkspaceWriteQueue } from "../../electron/workspace-write-queue.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function nextTick() {
  await Promise.resolve();
}

describe("WorkspaceWriteQueue", () => {
  test("keeps only the latest pending snapshot for the same project", async () => {
    const firstWrite = deferred();
    const writes = [];
    const queue = new WorkspaceWriteQueue({
      writeProject: async (projectDir, tasks) => {
        writes.push({ projectDir, tasks });
        if (writes.length === 1) {
          await firstWrite.promise;
        }
        return { tasks: new Map(), taskDirs: new Map() };
      },
    });

    queue.enqueue("project-a", [{ id: "first" }]);
    await nextTick();
    queue.enqueue("project-a", [{ id: "second" }]);
    queue.enqueue("project-a", [{ id: "third" }]);

    expect(queue.pendingSize("project-a")).toBe(1);

    firstWrite.resolve();
    await queue.flush();

    expect(writes.map((write) => write.tasks[0].id)).toEqual(["first", "third"]);
  });

  test("applies a bounded pending-project guard", async () => {
    const firstWrite = deferred();
    const queue = new WorkspaceWriteQueue({
      maxPendingProjects: 1,
      writeProject: async () => {
        await firstWrite.promise;
        return { tasks: new Map(), taskDirs: new Map() };
      },
    });

    queue.enqueue("project-a", [{ id: "first" }]);
    await nextTick();
    queue.enqueue("project-b", [{ id: "second" }]);

    expect(() => queue.enqueue("project-c", [{ id: "third" }])).toThrow(/queue is full/);

    firstWrite.resolve();
    await queue.flush();
  });

  test("emits save status transitions and reports write errors", async () => {
    const statuses = [];
    const errors = [];
    const queue = new WorkspaceWriteQueue({
      writeProject: async () => {
        throw new Error("disk failed");
      },
      onStatus: (event) => statuses.push(event.status),
      onError: (event) => errors.push(event.error.message),
    });

    queue.enqueue("project-a", [{ id: "first" }]);
    await queue.flush();

    expect(statuses).toEqual(["queued", "writing", "error"]);
    expect(errors).toEqual(["disk failed"]);
  });

  test("exposes getActiveOptions for queued and active jobs", async () => {
    const firstWrite = deferred();
    const queue = new WorkspaceWriteQueue({
      writeProject: async () => {
        await firstWrite.promise;
        return { tasks: new Map(), taskDirs: new Map() };
      },
    });

    queue.enqueue("project-a", [{ id: "first" }], { forceLocal: true });
    await nextTick();
    // Now project-a is active.
    expect(queue.getActiveOptions("project-a")).toEqual({ forceLocal: true });

    queue.enqueue("project-b", [{ id: "second" }]);
    expect(queue.getActiveOptions("project-b")).toEqual({ forceLocal: false });
    expect(queue.getActiveOptions("nonexistent")).toBeNull();

    firstWrite.resolve();
    await queue.flush();
  });

  test("forceLocal retries on write error with backoff and eventually succeeds", async () => {
    const statuses = [];
    let attempt = 0;
    const queue = new WorkspaceWriteQueue({
      retryBaseDelayMs: 1,
      maxRetryAttempts: 5,
      writeProject: async () => {
        attempt += 1;
        if (attempt < 3) {
          throw new Error("transient");
        }
        return { tasks: new Map(), taskDirs: new Map() };
      },
      onStatus: (event) => statuses.push(event.status),
    });

    queue.enqueue("project-a", [{ id: "first" }], { forceLocal: true });
    await queue.flush();

    expect(attempt).toBe(3);
    expect(statuses).toEqual(["queued", "writing", "retrying", "retrying", "saved"]);
  });

  test("forceLocal surfaces error after exhausting retries", async () => {
    const statuses = [];
    const errors = [];
    const queue = new WorkspaceWriteQueue({
      retryBaseDelayMs: 1,
      maxRetryAttempts: 3,
      writeProject: async () => {
        throw new Error("permanent");
      },
      onStatus: (event) => statuses.push(event.status),
      onError: (event) => errors.push(event),
    });

    queue.enqueue("project-a", [{ id: "first" }], { forceLocal: true });
    await queue.flush();

    expect(statuses).toEqual(["queued", "writing", "retrying", "retrying", "error"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].attempts).toBe(3);
  });

  test("non-forceLocal write does not retry on error", async () => {
    const statuses = [];
    let attempt = 0;
    const queue = new WorkspaceWriteQueue({
      retryBaseDelayMs: 1,
      writeProject: async () => {
        attempt += 1;
        throw new Error("disk failed");
      },
      onStatus: (event) => statuses.push(event.status),
    });

    queue.enqueue("project-a", [{ id: "first" }]);
    await queue.flush();

    expect(attempt).toBe(1);
    expect(statuses).toEqual(["queued", "writing", "error"]);
  });

  test("forceLocal yields to a fresher snapshot rather than retrying", async () => {
    let attempt = 0;
    const calls = [];
    const queue = new WorkspaceWriteQueue({
      retryBaseDelayMs: 50,
      writeProject: async (projectDir, tasks) => {
        calls.push(tasks);
        attempt += 1;
        if (attempt === 1) {
          // First attempt fails; a fresher snapshot will be enqueued before
          // we retry, so the queue should adopt the new snapshot rather than
          // retry the old one.
          queue.enqueue(projectDir, [{ id: "newer" }], { forceLocal: true });
          throw new Error("transient");
        }
        return { tasks: new Map(), taskDirs: new Map() };
      },
    });

    queue.enqueue("project-a", [{ id: "older" }], { forceLocal: true });
    await queue.flush();

    expect(attempt).toBe(2);
    expect(calls.map((tasks) => tasks[0].id)).toEqual(["older", "newer"]);
  });
});
