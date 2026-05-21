import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspace_store } from "../../src/features/workspace/stores/workspace";
import type { ElectronAPI } from "../../src/types/app";

const emptyState = {
  workspaces: [],
  activeWorkspacePath: null,
  activeProjectDir: null,
  projects: [],
};

const testWindow = window as unknown as { electronAPI?: Partial<ElectronAPI> };

describe("workspace_store", () => {
  afterEach(() => {
    workspace_store.set(emptyState);
    delete testWindow.electronAPI;
  });

  it("syncProjectListItem updates a workspace project summary from memory", () => {
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: "C:/workspace/alpha",
      projects: [
        {
          name: "Alpha",
          rootId: "root-alpha",
          dirName: "alpha",
          projectDir: "C:/workspace/alpha",
          order: 1,
        },
        {
          name: "Beta",
          rootId: "root-beta",
          dirName: "beta",
          projectDir: "C:/workspace/beta",
          order: 2,
        },
      ],
    });

    workspace_store.syncProjectListItem("C:/workspace/alpha", {
      rootId: "root-alpha",
      name: "Renamed Alpha",
      order: 1,
    });

    expect(get(workspace_store).projects.map((project) => project.name)).toEqual([
      "Renamed Alpha",
      "Beta",
    ]);
  });

  it("keeps memory order when order persistence fails", async () => {
    const wsSetProjectOrder = vi.fn().mockResolvedValue({ success: false, error: "disk" });
    const wsListProjects = vi.fn().mockResolvedValue([]);
    testWindow.electronAPI = { wsSetProjectOrder, wsListProjects };
    const alpha = {
      name: "Alpha",
      rootId: "root-alpha",
      dirName: "alpha",
      projectDir: "C:/workspace/alpha",
      order: 0,
    };
    const beta = {
      name: "Beta",
      rootId: "root-beta",
      dirName: "beta",
      projectDir: "C:/workspace/beta",
      order: 1,
    };
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: "C:/workspace/alpha",
      projects: [alpha, beta],
    });

    const result = await workspace_store.setProjectOrder([beta, alpha]);

    expect(result.success).toBe(false);
    expect(wsListProjects).not.toHaveBeenCalled();
    expect(get(workspace_store).projects.map((project) => project.name)).toEqual(["Beta", "Alpha"]);
    expect(get(workspace_store).projects.map((project) => project.order)).toEqual([0, 1]);
  });

  it("creates a project by appending the known in-memory summary without rereading the list", async () => {
    const wsCreateProject = vi.fn().mockResolvedValue({
      success: true,
      dirName: "gamma",
      projectDir: "C:/workspace/gamma",
    });
    const wsListProjects = vi.fn().mockResolvedValue([]);
    testWindow.electronAPI = { wsCreateProject, wsListProjects };
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: null,
      projects: [
        {
          name: "Alpha",
          rootId: "root-alpha",
          dirName: "alpha",
          projectDir: "C:/workspace/alpha",
          order: 0,
        },
      ],
    });

    const result = await workspace_store.createProject("Gamma", "root-gamma");

    expect(result.success).toBe(true);
    expect(wsCreateProject).toHaveBeenCalledWith("C:/workspace", "Gamma", "root-gamma", 1);
    expect(wsListProjects).not.toHaveBeenCalled();
    expect(get(workspace_store).projects.map((project) => project.name)).toEqual([
      "Alpha",
      "Gamma",
    ]);
  });

  it("opens the active workspace through the platform API", async () => {
    const wsOpenWorkspace = vi.fn().mockResolvedValue({ success: true });
    testWindow.electronAPI = { wsOpenWorkspace };
    workspace_store.set({
      workspaces: [{ path: "C:/workspace", label: "Workspace" }],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: null,
      projects: [],
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

  it("opens a task folder through the active workspace project", async () => {
    const wsOpenTaskFolder = vi.fn().mockResolvedValue({ success: true });
    testWindow.electronAPI = { wsOpenTaskFolder };
    workspace_store.set({
      workspaces: [{ path: "C:/workspace", label: "Workspace" }],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: "C:/workspace/project",
      projects: [],
    });

    const result = await workspace_store.openTaskFolder("task-1");

    expect(result.success).toBe(true);
    expect(wsOpenTaskFolder).toHaveBeenCalledWith("C:/workspace/project", "task-1");
  });

  it("does not open a task folder when no workspace project is active", async () => {
    const wsOpenTaskFolder = vi.fn().mockResolvedValue({ success: true });
    testWindow.electronAPI = { wsOpenTaskFolder };
    workspace_store.set(emptyState);

    const result = await workspace_store.openTaskFolder("task-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("No active workspace project");
    expect(wsOpenTaskFolder).not.toHaveBeenCalled();
  });
});
