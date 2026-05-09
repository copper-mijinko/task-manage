import { get, writable, type Writable } from "svelte/store";
import { getNode, type TreeData } from "../common/tree_control";
import { workspaceToProjectData } from "../common/workspace_tree";
import type { PendingTaskDetailSelection, SelectedType } from "../types/app";
import { clearHistory, tree_data } from "./tree";
import { workspace_store, workspace_tasks_cache } from "./workspace";
import * as platform from "../lib/platform";

const currentHash = typeof window !== "undefined" ? window.location.hash : "";
const currentSearch =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
const isTaskDetailWindow = currentHash === "#task-detail-window";
const detailProjectId = currentSearch.get("projectId") || undefined;
const detailTaskId = currentSearch.get("taskId") || undefined;

export let pendingTaskDetailSelection: PendingTaskDetailSelection | undefined =
  isTaskDetailWindow && detailProjectId && detailTaskId
    ? { projectId: detailProjectId, taskId: detailTaskId }
    : undefined;

export function clearPendingTaskDetailSelection() {
  pendingTaskDetailSelection = undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export interface SelectedIdStore extends Writable<string | undefined> {
  init: () => void;
}

export interface ClosedNodeIdsStore extends Writable<Set<string>> {
  init: () => void;
  add: (nodeId: string) => void;
  delete: (nodeId: string) => void;
  cleanupNodeMetadata: (nodeId: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

function collectNodeAndDescendantIds(node: TreeData | undefined): string[] {
  if (!node) return [];

  const ids = [node.id];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      ids.push(...collectNodeAndDescendantIds(child));
    }
  }

  return ids;
}

function createSelectedID(initialValue: string | undefined): SelectedIdStore {
  const { subscribe, set, update } = writable<string | undefined>(initialValue);

  return {
    subscribe,
    set,
    update,
    init: () => {
      let loadVersion = 0;
      let loadQueued = false;

      function queueLoadSelectedData() {
        if (loadQueued) return;
        loadQueued = true;
        Promise.resolve().then(() => {
          loadQueued = false;
          const current = get({ subscribe } as SelectedIdStore);
          const currentSelectedType = get(selected_type);
          if (!current) return;

          tree_data.flushPendingPersist();
          table_selected_id.set(undefined);
          const version = ++loadVersion;
          if (currentSelectedType === "Projects") {
            loadProjectsData(current, version);
          } else if (currentSelectedType === "WorkspaceProject") {
            loadWorkspaceData(current, version);
          }
        });
      }

      function loadProjectsData(current: string, version: number) {
        clearHistory();
        platform.getTreeData(current).then((result) => {
          if (version !== loadVersion) return;
          tree_data.setFromSource(result);

          if (
            pendingTaskDetailSelection?.projectId === current &&
            pendingTaskDetailSelection.taskId
          ) {
            if (result?.data && getNode(pendingTaskDetailSelection.taskId, result.data)) {
              table_selected_id.set(pendingTaskDetailSelection.taskId);
            } else {
              clearPendingTaskDetailSelection();
              table_selected_id.set(undefined);
            }
          } else {
            table_selected_id.set(undefined);
          }
        });
      }

      function loadWorkspaceData(current: string, version: number) {
        clearHistory();
        const { activeProjectDir } = get(workspace_store);
        if (!activeProjectDir) return;
        platform.wsReadProject(activeProjectDir).then((result) => {
          if (version !== loadVersion) return;
          if (!result) return;
          workspace_tasks_cache.set(result.tasks);
          const converted = workspaceToProjectData(result.tasks, current);
          tree_data.setFromSource(converted);
          table_selected_id.set(undefined);
        });
      }

      subscribe(() => {
        queueLoadSelectedData();
      });

      selected_type.subscribe(() => {
        queueLoadSelectedData();
      });
    },
  };
}

function createClosedNodeIds(initialValue: Set<string>): ClosedNodeIdsStore {
  const projectExpandedStates = new Map<string, Set<string>>();
  const { subscribe, set, update } = writable<Set<string>>(initialValue || new Set());

  const loadState = async (projectId: string) => {
    if (!projectId) return undefined;

    try {
      const metaKey = `closed_nodes_${projectId}`;
      const result = await platform.getMetaData(metaKey);

      const newState = isStringArray(result) ? new Set(result) : new Set<string>();
      projectExpandedStates.set(projectId, newState);
      set(newState);
      return newState;
    } catch {
      return new Set<string>();
    }
  };

  const saveState = (projectId: string, state: Set<string>) => {
    if (!projectId) return;

    try {
      const metaKey = `closed_nodes_${projectId}`;
      const idsArray = Array.from(state);
      platform.setMetaData(metaKey, idsArray);
    } catch {
      // ignore save error
    }
  };

  return {
    subscribe,
    set,
    update,
    add: (nodeId: string) => {
      const projectId = get(selected_id);
      if (!projectId) return;

      update((currentState) => {
        const newState = new Set(currentState);
        newState.add(nodeId);
        projectExpandedStates.set(projectId, newState);
        saveState(projectId, newState);
        return newState;
      });
    },
    delete: (nodeId: string) => {
      const projectId = get(selected_id);
      if (!projectId) return;

      update((currentState) => {
        const newState = new Set(currentState);
        newState.delete(nodeId);
        projectExpandedStates.set(projectId, newState);
        saveState(projectId, newState);
        return newState;
      });
    },
    init: () => {
      selected_id.subscribe(async (projectId) => {
        if (projectId) {
          if (projectExpandedStates.has(projectId)) {
            set(projectExpandedStates.get(projectId) as Set<string>);
          } else {
            await loadState(projectId);
          }
        }
      });
    },
    expandAll: () => {
      const projectId = get(selected_id);
      if (!projectId) return;
      const newState = new Set<string>();
      projectExpandedStates.set(projectId, newState);
      saveState(projectId, newState);
      set(newState);
    },
    collapseAll: () => {
      const projectId = get(selected_id);
      if (!projectId) return;
      const currentTreeData = get(tree_data);
      if (!currentTreeData?.data) return;
      const allIds = collectNodeAndDescendantIds(currentTreeData.data);
      const newState = new Set<string>(allIds);
      projectExpandedStates.set(projectId, newState);
      saveState(projectId, newState);
      set(newState);
    },
    cleanupNodeMetadata: (nodeId: string) => {
      const projectId = get(selected_id);
      const currentTreeData = get(tree_data);
      if (!projectId || !currentTreeData) return;

      const node = getNode(nodeId, currentTreeData.data);
      if (!node) return;

      const nodeIds = collectNodeAndDescendantIds(node);

      update((currentState) => {
        const newState = new Set(currentState);
        nodeIds.forEach((id) => {
          newState.delete(id);
        });

        projectExpandedStates.set(projectId, newState);

        const metaKey = `closed_nodes_${projectId}`;
        const idsArray = Array.from(newState);
        platform.setMetaData(metaKey, idsArray);

        return newState;
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let selected_type: Writable<SelectedType> = writable<SelectedType>(undefined);
// eslint-disable-next-line prefer-const
export let table_selected_id: Writable<string | undefined> = writable<string | undefined>(
  undefined
);
// eslint-disable-next-line prefer-const
export let closed_node_ids: ClosedNodeIdsStore = createClosedNodeIds(new Set<string>());
// eslint-disable-next-line prefer-const
export let selected_id: SelectedIdStore = createSelectedID(undefined);

export function setTaskDetailWindowTarget(projectId: string, taskId: string) {
  if (!projectId || !taskId) {
    pendingTaskDetailSelection = undefined;
    return;
  }

  pendingTaskDetailSelection = { projectId, taskId };
  selected_type.set("Projects");
  selected_id.set(projectId);
}

export const showPageSearch = writable(false);

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export const saveStatus = writable<SaveStatus>("idle");

export const copied_task = writable<TreeData | null>(null);
