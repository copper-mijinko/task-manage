import { writable, get, type Writable } from "svelte/store";
import type { WorkspaceInfo, WorkspaceProjectListItem, WorkspaceTask } from "../types/workspace";
import * as platform from "../lib/platform";

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
  selectDirectory: () => Promise<string | null>;
  addWorkspace: (path: string, label: string) => void;
  removeWorkspace: (path: string) => void;
  setActive: (path: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  setActiveProject: (projectDir: string) => void;
  createProject: (
    name: string,
    id: string
  ) => Promise<{ success: boolean; projectDir?: string; error?: string }>;
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

  return {
    subscribe,
    set,
    update,

    init() {
      (async () => {
        const { workspaces, activeWorkspace } = await platform.wsGetWorkspaces();
        const projects = activeWorkspace ? await loadProjects(activeWorkspace) : [];
        set({
          workspaces: workspaces ?? [],
          activeWorkspacePath: activeWorkspace,
          activeProjectDir: null,
          projects,
        });
      })();
    },

    selectDirectory(): Promise<string | null> {
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

    setActiveProject(projectDir: string) {
      update((s) => ({ ...s, activeProjectDir: projectDir }));
    },

    async createProject(name: string, id: string) {
      const { activeWorkspacePath } = get({ subscribe } as WorkspaceStore);
      if (!activeWorkspacePath) {
        return { success: false, error: "No active workspace" };
      }

      const result = await platform.wsCreateProject(activeWorkspacePath, name, id);
      if (!result?.success || !result.projectDir) {
        return { success: false, error: result?.error ?? "Failed to create workspace project" };
      }

      const projects = await loadProjects(activeWorkspacePath);
      update((s) => ({
        ...s,
        projects,
        activeProjectDir: result.projectDir ?? s.activeProjectDir,
      }));
      return { success: true, projectDir: result.projectDir };
    },
  };
}

export const workspace_store = createWorkspaceStore();
