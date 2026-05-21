import { writable, get, type Writable } from "svelte/store";
import type { WorkspaceInfo, WorkspaceProjectListItem, WorkspaceTask } from "@app-types/workspace";
import * as platform from "@lib/ipc/platform";

/** Last loaded workspace tasks, keyed by task id. Used during save to preserve metadata. */
export const workspace_tasks_cache = writable<Record<string, WorkspaceTask>>({});

export interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspacePath: string | null;
  activeProjectDir: string | null;
  projects: WorkspaceProjectListItem[];
}

export interface WorkspaceStore extends Writable<WorkspaceState> {
  init: () => void;
  selectDirectory: () => Promise<platform.WsSelectDirectoryResult>;
  addWorkspace: (path: string, label: string) => void;
  removeWorkspace: (path: string) => void;
  setActive: (path: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  setProjectOrder: (
    projects: WorkspaceProjectListItem[]
  ) => Promise<{ success: boolean; error?: string }>;
  syncProjectListItem: (
    projectDir: string,
    summary: { rootId?: string; name?: string; order?: number }
  ) => void;
  setActiveProject: (projectDir: string) => void;
  openActiveWorkspace: () => Promise<{ success: boolean; error?: string }>;
  openTaskFolder: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  createProject: (
    name: string,
    id: string
  ) => Promise<{ success: boolean; projectDir?: string; error?: string }>;
  deleteProject: (projectDir: string) => Promise<{ success: boolean; error?: string }>;
}

function createWorkspaceStore(): WorkspaceStore {
  const { subscribe, set, update } = writable<WorkspaceState>({
    workspaces: [],
    activeWorkspacePath: null,
    activeProjectDir: null,
    projects: [],
  });

  function persist(workspaces: WorkspaceInfo[], activeWorkspacePath: string | null) {
    platform.wsSetWorkspaces({
      workspaces,
      activeWorkspace: activeWorkspacePath ?? undefined,
    });
  }

  async function loadProjects(workspacePath: string): Promise<WorkspaceProjectListItem[]> {
    try {
      return await platform.wsListProjects(workspacePath);
    } catch {
      return [];
    }
  }

  function nextProjectOrder(projects: WorkspaceProjectListItem[]) {
    const ordered = projects
      .map((project) => project.order)
      .filter((order): order is number => typeof order === "number" && Number.isFinite(order));
    return ordered.length > 0 ? Math.max(...ordered) + 1 : projects.length;
  }

  function withSequentialProjectOrder(projects: WorkspaceProjectListItem[]) {
    return projects.map((project, index) => ({ ...project, order: index }));
  }

  return {
    subscribe,
    set,
    update,

    init() {
      (async () => {
        const { workspaces, activeWorkspace } = await platform.wsGetWorkspaces();
        const projects = activeWorkspace ? await loadProjects(activeWorkspace) : [];
        const current = get({ subscribe } as WorkspaceStore);
        set({
          workspaces: workspaces ?? [],
          activeWorkspacePath: activeWorkspace,
          activeProjectDir: current.activeProjectDir,
          projects,
        });
      })();
    },

    selectDirectory(): Promise<platform.WsSelectDirectoryResult> {
      return platform.wsSelectDirectory();
    },

    addWorkspace(path: string, label: string) {
      update((state) => {
        const exists = state.workspaces.some((w) => w.path === path);
        const workspaces = exists
          ? state.workspaces.map((w) => (w.path === path ? { path, label } : w))
          : [...state.workspaces, { path, label }];
        persist(workspaces, state.activeWorkspacePath);
        return { ...state, workspaces };
      });
    },

    removeWorkspace(path: string) {
      update((state) => {
        const workspaces = state.workspaces.filter((w) => w.path !== path);
        const activeWorkspacePath =
          state.activeWorkspacePath === path
            ? (workspaces[0]?.path ?? null)
            : state.activeWorkspacePath;
        persist(workspaces, activeWorkspacePath);
        return { ...state, workspaces, activeWorkspacePath };
      });
    },

    async setActive(path: string) {
      const projects = await loadProjects(path);
      update((state) => {
        persist(state.workspaces, path);
        return { ...state, activeWorkspacePath: path, projects };
      });
    },

    async refreshProjects() {
      const { activeWorkspacePath } = get({ subscribe } as WorkspaceStore);
      if (!activeWorkspacePath) return;
      const projects = await loadProjects(activeWorkspacePath);
      update((s) => ({ ...s, projects }));
    },

    async setProjectOrder(projects: WorkspaceProjectListItem[]) {
      const { activeWorkspacePath } = get({ subscribe } as WorkspaceStore);
      if (!activeWorkspacePath) {
        return { success: false, error: "No active workspace" };
      }

      const orderedProjects = withSequentialProjectOrder(projects);
      update((s) => ({ ...s, projects: orderedProjects }));
      let result: { success: boolean; projects?: WorkspaceProjectListItem[]; error?: string };
      try {
        result = await platform.wsSetProjectOrder(activeWorkspacePath, orderedProjects);
      } catch {
        return { success: false, error: "Failed to save project order" };
      }
      if (!result?.success) {
        return { success: false, error: result?.error ?? "Failed to save project order" };
      }

      return { success: true };
    },

    syncProjectListItem(projectDir, summary) {
      update((state) => ({
        ...state,
        projects: state.projects.map((project) => {
          const matchesProject =
            project.projectDir === projectDir ||
            (Boolean(summary.rootId) && project.rootId === summary.rootId);
          if (!matchesProject) return project;
          return {
            ...project,
            rootId: summary.rootId ?? project.rootId,
            name: summary.name ?? project.name,
            order: summary.order ?? project.order,
          };
        }),
      }));
    },

    setActiveProject(projectDir: string) {
      update((s) => ({ ...s, activeProjectDir: projectDir }));
    },

    async openActiveWorkspace() {
      const { activeWorkspacePath } = get({ subscribe } as WorkspaceStore);
      if (!activeWorkspacePath) {
        return { success: false, error: "No active workspace" };
      }
      return platform.wsOpenWorkspace(activeWorkspacePath);
    },

    async openTaskFolder(taskId: string) {
      const { activeProjectDir } = get({ subscribe } as WorkspaceStore);
      if (!activeProjectDir) {
        return { success: false, error: "No active workspace project" };
      }
      return platform.wsOpenTaskFolder(activeProjectDir, taskId);
    },

    async createProject(name: string, id: string) {
      const { activeWorkspacePath, projects } = get({ subscribe } as WorkspaceStore);
      if (!activeWorkspacePath) {
        return { success: false, error: "No active workspace" };
      }

      const order = nextProjectOrder(projects);
      const result = await platform.wsCreateProject(activeWorkspacePath, name, id, order);
      if (!result?.success || !result.projectDir) {
        return { success: false, error: result?.error ?? "Failed to create workspace project" };
      }

      const project: WorkspaceProjectListItem = {
        name,
        rootId: id,
        dirName: result.dirName ?? result.projectDir.split(/[/\\]/).pop() ?? name,
        projectDir: result.projectDir,
        order,
      };
      update((s) => ({
        ...s,
        projects: [...s.projects.filter((item) => item.projectDir !== project.projectDir), project],
        activeProjectDir: result.projectDir ?? s.activeProjectDir,
      }));
      return { success: true, projectDir: result.projectDir };
    },

    async deleteProject(projectDir: string) {
      const result = await platform.wsDeleteProject(projectDir);
      if (!result?.success) {
        return { success: false, error: result?.error ?? "Failed to delete workspace project" };
      }
      const { activeProjectDir } = get({
        subscribe,
      } as WorkspaceStore);
      update((s) => ({
        ...s,
        projects: s.projects.filter((project) => project.projectDir !== projectDir),
        activeProjectDir: activeProjectDir === projectDir ? null : activeProjectDir,
      }));
      return { success: true };
    },
  };
}

export const workspace_store = createWorkspaceStore();
