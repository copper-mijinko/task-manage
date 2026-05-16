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
});
