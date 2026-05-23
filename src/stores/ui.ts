import { get, writable, type Writable } from "svelte/store";
import { getNode, type TreeData } from "@features/tasks/utils/tree_control";
import { workspaceToProjectData } from "@features/workspace/utils/workspace_tree";
import type { PendingTaskDetailSelection, SaveStatus, SelectedType } from "@app-types/app";
import { clearHistory, tree_data } from "@features/tasks/stores/tree";
import { workspace_store, workspace_tasks_cache } from "@features/workspace/stores/workspace";
import * as platform from "@lib/ipc/platform";

const currentHash = typeof window !== "undefined" ? window.location.hash : "";
const currentSearch =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
const isTaskDetailWindow = currentHash === "#task-detail-window";
const detailProjectId = currentSearch.get("projectId") || undefined;
const detailTaskId = currentSearch.get("taskId") || undefined;
const detailSelectedType =
  currentSearch.get("selectedType") === "WorkspaceProject" ? "WorkspaceProject" : "Projects";
const detailProjectDir = currentSearch.get("projectDir") || undefined;

export let pendingTaskDetailSelection: PendingTaskDetailSelection | undefined =
  isTaskDetailWindow && detailProjectId && detailTaskId
    ? {
        projectId: detailProjectId,
        taskId: detailTaskId,
        selectedType: detailSelectedType,
        projectDir: detailProjectDir,
      }
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

export const projectLoading = writable(false);

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
          const version = ++loadVersion;
          if (!current) {
            projectLoading.set(false);
            return;
          }

          tree_data.flushPendingPersist();
          clearSelection();
          copied_tasks.set([]);
          if (currentSelectedType === "Projects") {
            projectLoading.set(true);
            tree_data.resetForLoad();
            loadProjectsData(current, version);
          } else if (currentSelectedType === "WorkspaceProject") {
            projectLoading.set(true);
            tree_data.resetForLoad();
            loadWorkspaceData(current, version);
          } else {
            projectLoading.set(false);
          }
        });
      }

      function finishLoad(version: number) {
        if (version === loadVersion) {
          projectLoading.set(false);
        }
      }

      function loadProjectsData(current: string, version: number) {
        clearHistory();
        platform.getTreeData(current).then(
          (result) => {
            if (version !== loadVersion) return;
            if (!result) {
              tree_data.resetForLoad();
              table_selected_id.set(undefined);
              finishLoad(version);
              return;
            }
            tree_data.setFromSource(result);

            if (
              pendingTaskDetailSelection?.projectId === current &&
              pendingTaskDetailSelection.taskId
            ) {
              if (getNode(pendingTaskDetailSelection.taskId, result.data)) {
                table_selected_id.set(pendingTaskDetailSelection.taskId);
              } else {
                clearPendingTaskDetailSelection();
                table_selected_id.set(undefined);
              }
            } else {
              table_selected_id.set(undefined);
            }
            finishLoad(version);
          },
          () => {
            if (version === loadVersion) {
              tree_data.resetForLoad();
              table_selected_id.set(undefined);
            }
            finishLoad(version);
          }
        );
      }

      function loadWorkspaceData(current: string, version: number) {
        clearHistory();
        const { activeProjectDir } = get(workspace_store);
        if (!activeProjectDir) {
          tree_data.resetForLoad();
          table_selected_id.set(undefined);
          finishLoad(version);
          return;
        }
        platform.wsReadProject(activeProjectDir).then(
          (result) => {
            if (version !== loadVersion) return;
            if (!result) {
              tree_data.resetForLoad();
              table_selected_id.set(undefined);
              finishLoad(version);
              return;
            }
            workspace_tasks_cache.set(result.tasks);
            const converted = workspaceToProjectData(result.tasks, current);
            tree_data.setFromSource(converted);
            if (
              pendingTaskDetailSelection?.selectedType === "WorkspaceProject" &&
              pendingTaskDetailSelection.projectId === current &&
              (!pendingTaskDetailSelection.projectDir ||
                pendingTaskDetailSelection.projectDir === activeProjectDir) &&
              pendingTaskDetailSelection.taskId &&
              getNode(pendingTaskDetailSelection.taskId, converted.data)
            ) {
              table_selected_id.set(pendingTaskDetailSelection.taskId);
            } else {
              table_selected_id.set(undefined);
            }
            finishLoad(version);
          },
          () => {
            if (version === loadVersion) {
              tree_data.resetForLoad();
              table_selected_id.set(undefined);
            }
            finishLoad(version);
          }
        );
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

// Multi-select state for the task tree.
// `selected_ids` holds the live set; `selection_anchor_id` is the pivot used
// for Shift-range expansion. `table_selected_id` continues to act as the
// "primary" / focused row (used by TaskDetail, MemoTab, paste-after target).
export const selected_ids: Writable<Set<string>> = writable<Set<string>>(new Set<string>());
export const selection_anchor_id: Writable<string | undefined> = writable<string | undefined>(
  undefined
);

function mirrorTableSelected(ids: Set<string>, anchor: string | undefined) {
  if (ids.size === 0) {
    table_selected_id.set(undefined);
  } else if (ids.size === 1) {
    const only = ids.values().next().value as string;
    table_selected_id.set(only);
  } else if (anchor !== undefined) {
    table_selected_id.set(anchor);
  }
}

export function clearSelection() {
  selected_ids.set(new Set<string>());
  selection_anchor_id.set(undefined);
  table_selected_id.set(undefined);
}

export function selectOnly(id: string) {
  const next = new Set<string>([id]);
  selected_ids.set(next);
  selection_anchor_id.set(id);
  mirrorTableSelected(next, id);
}

export function toggleSelection(id: string) {
  selected_ids.update((current) => {
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    // Anchor follows the most recent toggle.
    if (next.has(id)) {
      selection_anchor_id.set(id);
    } else {
      // If we removed the previous anchor, pick any remaining as the new anchor.
      const currentAnchor = get(selection_anchor_id);
      if (currentAnchor === id) {
        const first = next.values().next();
        selection_anchor_id.set(first.done ? undefined : (first.value as string));
      }
    }
    mirrorTableSelected(next, get(selection_anchor_id));
    return next;
  });
}

export function selectRange(targetId: string, visibleRowIds: string[]) {
  const anchor = get(selection_anchor_id);
  if (!anchor || !visibleRowIds.includes(anchor) || !visibleRowIds.includes(targetId)) {
    // No valid anchor: fall back to single-select.
    selectOnly(targetId);
    return;
  }
  const a = visibleRowIds.indexOf(anchor);
  const b = visibleRowIds.indexOf(targetId);
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const next = new Set<string>(visibleRowIds.slice(lo, hi + 1));
  selected_ids.set(next);
  // anchor remains unchanged
  mirrorTableSelected(next, anchor);
}

export function selectAll(visibleRowIds: string[]) {
  if (visibleRowIds.length === 0) {
    clearSelection();
    return;
  }
  const next = new Set<string>(visibleRowIds);
  selected_ids.set(next);
  selection_anchor_id.set(visibleRowIds[0]);
  mirrorTableSelected(next, visibleRowIds[0]);
}

// Prune ids that no longer exist (used after tree mutations from other windows / undo).
export function pruneSelection(existingIds: Set<string>) {
  selected_ids.update((current) => {
    if (current.size === 0) return current;
    let removed = false;
    const next = new Set<string>();
    for (const id of current) {
      if (existingIds.has(id)) {
        next.add(id);
      } else {
        removed = true;
      }
    }
    if (!removed) return current;
    const anchor = get(selection_anchor_id);
    if (anchor !== undefined && !existingIds.has(anchor)) {
      const first = next.values().next();
      selection_anchor_id.set(first.done ? undefined : (first.value as string));
    }
    mirrorTableSelected(next, get(selection_anchor_id));
    return next;
  });
}

export function setTaskDetailWindowTarget(
  projectId: string,
  taskId: string,
  options: { selectedType?: "Projects" | "WorkspaceProject"; projectDir?: string | null } = {}
) {
  if (!projectId || !taskId) {
    pendingTaskDetailSelection = undefined;
    return;
  }

  const selectedType = options.selectedType ?? "Projects";
  pendingTaskDetailSelection = {
    projectId,
    taskId,
    selectedType,
    projectDir: options.projectDir ?? null,
  };
  selected_type.set(selectedType);
  selected_id.set(projectId);
}

export const showPageSearch = writable(false);

/**
 * Whether the Inbox Quick Capture overlay is currently shown. Toggled by
 * the header button and the global Ctrl+Shift+I shortcut.
 */
export const showQuickCapture = writable(false);

export const saveStatus = writable<SaveStatus>("idle");

export const copied_task = writable<TreeData | null>(null);

// Multi-selection clipboard. When non-empty, takes precedence over `copied_task`.
// Each entry is a freshly cloned-with-new-ids subtree, ready to paste.
export const copied_tasks = writable<TreeData[]>([]);

/**
 * The left navigation sidebar always starts hidden on launch. Per UX
 * feedback we do NOT persist the open/closed preference across sessions —
 * each window opens with the maximum amount of working space available.
 */
export const sidebarCollapsed = writable<boolean>(true);
