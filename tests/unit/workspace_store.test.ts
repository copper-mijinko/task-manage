import { afterEach, describe, expect, it, vi } from "vitest";
import { workspace_store } from "../../src/features/workspace/stores/workspace";
import type { ElectronAPI } from "../../src/types/app";

const emptyState = {
  workspaces: [],
  activeWorkspacePath: null,
};

const testWindow = window as unknown as { electronAPI?: Partial<ElectronAPI> };

describe("workspace_store", () => {
  afterEach(() => {
    workspace_store.set(emptyState);
    delete testWindow.electronAPI;
  });

  it("opens the active workspace through the platform API", async () => {
    const wsOpenWorkspace = vi.fn().mockResolvedValue({ success: true });
    testWindow.electronAPI = { wsOpenWorkspace };
    workspace_store.set({
      workspaces: [{ path: "C:/workspace", label: "Workspace" }],
      activeWorkspacePath: "C:/workspace",
    });

    const result = await workspace_store.openActiveWorkspace();

    expect(result.success).toBe(true);
    expect(wsOpenWorkspace).toHaveBeenCalledWith("C:/workspace");
  });

  it("does not open a workspace when none is active", async () => {
    const wsOpenWorkspace = vi.fn().mockResolvedValue({ success: true });
    testWindow.electronAPI = { wsOpenWorkspace };
    workspace_store.set(emptyState);

    const result = await workspace_store.openActiveWorkspace();

    expect(result.success).toBe(false);
    expect(result.error).toBe("No active workspace");
    expect(wsOpenWorkspace).not.toHaveBeenCalled();
  });
});
