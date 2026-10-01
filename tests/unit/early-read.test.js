import { startEarlyWorkspaceRead } from "../../electron/early-read.js";

/**
 * 起動の最初（Electron の ready より前）に、開いているワークスペースを読み始める。
 * 設定が読めない・ワークスペースが無いときは何もしない。失敗は記録するだけで、
 * 投げない（画面からの要求で改めて読んでエラーを出す）。
 */
const meta = (value) => () => JSON.stringify(value);

describe("early workspace read", () => {
  it("starts reading the workspace that is open", async () => {
    const read = vi.fn(async () => undefined);
    const started = startEarlyWorkspaceRead({
      metaPath: "/data/meta.json",
      read,
      readFile: meta({ activeWorkspace: "/work/space", workspaces: [{ path: "/work/space" }] }),
    });
    expect(started).toBe("/work/space");
    await Promise.resolve();
    expect(read).toHaveBeenCalledWith("/work/space");
  });

  it("does nothing when there is no settings file, no open workspace or a broken file", () => {
    const read = vi.fn();
    const unreadable = () => {
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    };
    expect(startEarlyWorkspaceRead({ metaPath: "m", read, readFile: unreadable })).toBeNull();
    expect(startEarlyWorkspaceRead({ metaPath: "m", read, readFile: () => "{broken" })).toBeNull();
    expect(startEarlyWorkspaceRead({ metaPath: "m", read, readFile: meta({}) })).toBeNull();
    expect(
      startEarlyWorkspaceRead({ metaPath: "m", read, readFile: meta({ activeWorkspace: "" }) })
    ).toBeNull();
    expect(
      startEarlyWorkspaceRead({ metaPath: "m", read, readFile: meta({ activeWorkspace: 5 }) })
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("only records a failed read, and a read that throws at once", async () => {
    const errors = [];
    startEarlyWorkspaceRead({
      metaPath: "m",
      read: async () => {
        throw new Error("cannot open");
      },
      onError: (error) => errors.push(error.message),
      readFile: meta({ activeWorkspace: "/gone" }),
    });
    startEarlyWorkspaceRead({
      metaPath: "m",
      read: () => {
        throw new Error("synchronous failure");
      },
      onError: (error) => errors.push(error.message),
      readFile: meta({ activeWorkspace: "/gone" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors.sort()).toEqual(["cannot open", "synchronous failure"]);
  });
});
