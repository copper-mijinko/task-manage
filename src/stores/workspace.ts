import { writable, get, type Writable } from "svelte/store";
import type { WorkspaceInfo, WorkspaceProjectListItem } from "../types/workspace";

export interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspacePath: string | null;
  projects: WorkspaceProjectListItem[];
}

export interface WorkspaceStore extends Writable<WorkspaceState> {
  init: () => void;
  selectDirectory: () => Promise<string | null>;
  addWorkspace: (path: string, label: string) => void;
  removeWorkspace: (path: string) => void;
  setActive: (path: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
}

function createWorkspaceStore(): WorkspaceStore {
  const { subscribe, set, update } = writable<WorkspaceState>({
    workspaces: [],
    activeWorkspacePath: null,
    projects: [],
  });

  function persist(workspaces: WorkspaceInfo[], activeWorkspacePath: string | null) {
    window.electronAPI?.wsSetWorkspaces?.({
      workspaces,
      activeWorkspace: activeWorkspacePath ?? undefined,
    });
  }

  async function loadProjects(workspacePath: string): Promise<WorkspaceProjectListItem[]> {
    try {
      return (await window.electronAPI?.wsListProjects?.(workspacePath)) ?? [];
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
        if (!window.electronAPI?.wsGetWorkspaces) return;
        const { workspaces, activeWorkspace } = await window.electronAPI.wsGetWorkspaces();
        const projects = activeWorkspace ? await loadProjects(activeWorkspace) : [];
        set({
          workspaces: workspaces ?? [],
          activeWorkspacePath: activeWorkspace,
          projects,
        });
      })();
    },

    selectDirectory(): Promise<string | null> {
      return window.electronAPI?.wsSelectDirectory?.() ?? Promise.resolve(null);
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
  };
}

export const workspace_store = createWorkspaceStore();
