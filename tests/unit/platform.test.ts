import { afterEach, describe, expect, test, vi } from "vitest";
import { wsExecuteGraphCommand } from "../../src/lib/ipc/platform";

describe("platform IPC boundary", () => {
  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  test("sends reactive (Proxy) payloads as clonable plain data and keeps undefined fields", async () => {
    const received: unknown[] = [];
    (window as { electronAPI?: unknown }).electronAPI = {
      wsExecuteGraphCommand: vi.fn(async (_path: string, command: unknown) => {
        // IPC は structured clone する。Proxy のままだとここで失敗する。
        received.push(structuredClone(command));
        return { graph: {} };
      }),
    };
    // Svelte の $state と同じく、プレーンなオブジェクトを包む Proxy。
    const reactive = <T extends object>(value: T): T => new Proxy(value, {});
    const command = reactive({
      type: "update-node",
      nodeId: "n1",
      changes: reactive({ body: reactive({ ops: [reactive({ insert: "x\n" })] }), due: undefined }),
    });
    expect(() => structuredClone(command)).toThrow();

    await wsExecuteGraphCommand("/ws", command as never, "tree", 3);

    expect(received[0]).toEqual({
      type: "update-node",
      nodeId: "n1",
      changes: { body: { ops: [{ insert: "x\n" }] }, due: undefined },
    });
    expect(Object.keys((received[0] as { changes: object }).changes)).toContain("due");
  });
});
