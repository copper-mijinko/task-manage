import { writable, get, type Writable } from "svelte/store";
import type { WorkspaceInfo } from "@app-types/workspace";
import * as platform from "@lib/ipc/platform";

/**
 * 登録済みワークスペースと、いま開いているワークスペース。
 *
 * ワークスペースの中身（ノードと親子関係）は `workspace_graph_store` が持つ。
 */
export interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspacePath: string | null;
}

export interface WorkspaceStore extends Writable<WorkspaceState> {
  init: () => Promise<void>;
  selectDirectory: () => Promise<platform.WsSelectDirectoryResult>;
  addWorkspace: (path: string, label: string) => void;
  removeWorkspace: (path: string) => void;
  setActive: (path: string) => Promise<void>;
  openActiveWorkspace: () => Promise<{ success: boolean; error?: string }>;
}

function createWorkspaceStore(): WorkspaceStore {
  const { subscribe, set, update } = writable<WorkspaceState>({
    workspaces: [],
    activeWorkspacePath: null,
  });

  function persist(workspaces: WorkspaceInfo[], activeWorkspacePath: string | null) {
    platform.wsSetWorkspaces({
      workspaces,
      activeWorkspace: activeWorkspacePath ?? undefined,
    });
  }

  return {
    subscribe,
    set,
    update,

    async init() {
      const { workspaces, activeWorkspace } = await platform.wsGetWorkspaces();
      set({ workspaces: workspaces ?? [], activeWorkspacePath: activeWorkspace });
    },

    selectDirectory() {
      return platform.wsSelectDirectory();
    },

    addWorkspace(path, label) {
      update((state) => {
        const exists = state.workspaces.some((w) => w.path === path);
        const workspaces = exists
          ? state.workspaces.map((w) => (w.path === path ? { path, label } : w))
          : [...state.workspaces, { path, label }];
        persist(workspaces, state.activeWorkspacePath);
        return { ...state, workspaces };
      });
    },

    removeWorkspace(path) {
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

    async setActive(path) {
      update((state) => {
        persist(state.workspaces, path);
        return { ...state, activeWorkspacePath: path };
      });
    },

    async openActiveWorkspace() {
      const { activeWorkspacePath } = get({ subscribe } as WorkspaceStore);
      if (!activeWorkspacePath) return { success: false, error: "No active workspace" };
      return platform.wsOpenWorkspace(activeWorkspacePath);
    },
  };
}

export const workspace_store = createWorkspaceStore();
