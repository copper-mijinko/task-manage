import { throttle } from "lodash";
import { derived, get, writable, type Readable, type Writable } from "svelte/store";

import { uuidV4 } from "@lib/utils/uuid";
import * as platform from "@lib/ipc/platform";
import { workspace_store } from "@features/workspace/stores/workspace";
import { saveStatus } from "@stores/ui";
import { isPreferMemoryActive } from "@features/workspace/stores/policy";
import type { WorkspaceTask } from "@app-types/workspace";

/**
 * Sentinel `selected_id` value used when the Inbox view is active. InboxPanel
 * reads inbox_store directly, so the actual root id doesn't need to flow
 * through the cross-cutting selection state — using a stable sentinel avoids
 * races where the user opens Inbox before the disk read has finished.
 */
export const INBOX_SELECTED_ID = "__inbox__";

export interface InboxState {
  /** Absolute path of the active workspace. `null` while no workspace is loaded. */
  workspacePath: string | null;
  /** Absolute path of the inbox directory (`<workspace>/_inbox`). */
  projectDir: string | null;
  /** Stable id of the inbox root task (the `_project.md` marker). */
  rootId: string | null;
  /** Flat list of inbox items, sorted by `order` then `createdAt`. */
  items: WorkspaceTask[];
  /** Whether the inbox is currently being loaded (initial fetch / workspace switch). */
  loading: boolean;
  /** Last load error, if any. */
  error: string | null;
}

const EMPTY_STATE: InboxState = {
  workspacePath: null,
  projectDir: null,
  rootId: null,
  items: [],
  loading: false,
  error: null,
};

function sortItems(items: WorkspaceTask[]): WorkspaceTask[] {
  return [...items].sort((a, b) => {
    const aOrder = typeof a.order === "number" ? a.order : Number.POSITIVE_INFINITY;
    const bOrder = typeof b.order === "number" ? b.order : Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
}

function tasksRecordToItems(tasks: Record<string, WorkspaceTask>, rootId: string): WorkspaceTask[] {
  const items: WorkspaceTask[] = [];
  for (const task of Object.values(tasks)) {
    if (task.id === rootId) continue;
    if (task.parents.length === 1 && task.parents[0] === rootId) {
      items.push(task);
    }
  }
  return sortItems(items);
}

export interface InboxStore extends Readable<InboxState> {
  /** Wire up workspace-change listeners. Idempotent. */
  init: () => void;
  /** Force a fresh read from disk. */
  reload: () => Promise<void>;
  /**
   * Append a new item to the inbox. Works regardless of which view is currently
   * shown, so the Quick Capture entry can be triggered from anywhere.
   */
  addItem: (
    partial: Partial<WorkspaceTask> & { name: string }
  ) => Promise<{ success: boolean; task?: WorkspaceTask; error?: string }>;
  /** Update fields of a single inbox item. */
  updateItem: (
    taskId: string,
    patch: Partial<WorkspaceTask>
  ) => Promise<{ success: boolean; error?: string }>;
  /** Delete one or more items from the inbox. */
  deleteItems: (taskIds: string[]) => Promise<{ success: boolean; error?: string }>;
  /** Reorder items. The provided ids must be a permutation of the current items. */
  reorder: (orderedIds: string[]) => Promise<{ success: boolean; error?: string }>;
  /** Move items to a workspace project. Pass `targetParentId` to nest under a specific node. */
  sendToProject: (args: {
    targetProjectDir: string;
    targetRootId: string;
    /** Parent task id within the project. Omit / pass undefined to use the project root. */
    targetParentId?: string;
    taskIds: string[];
  }) => Promise<{
    success: boolean;
    moved?: string[];
    errors?: { taskId: string; error: string }[];
    error?: string;
  }>;
}

function createInboxStore(): InboxStore {
  const internal: Writable<InboxState> = writable<InboxState>({ ...EMPTY_STATE });
  let initialized = false;
  let lastWorkspacePath: string | null = null;

  function setState(updater: (current: InboxState) => InboxState) {
    internal.update(updater);
  }

  function setError(message: string) {
    setState((current) => ({ ...current, loading: false, error: message }));
  }

  async function ensureLocation(): Promise<{
    workspacePath: string;
    projectDir: string;
    rootId: string;
  } | null> {
    const ws = get(workspace_store);
    if (!ws.activeWorkspacePath) {
      setState((current) => ({ ...EMPTY_STATE, workspacePath: null, error: current.error }));
      return null;
    }
    const result = await platform.wsEnsureInbox(ws.activeWorkspacePath);
    if (!result.success || !result.projectDir || !result.rootId) {
      setError(result.error || "Failed to ensure inbox");
      return null;
    }
    return {
      workspacePath: ws.activeWorkspacePath,
      projectDir: result.projectDir,
      rootId: result.rootId,
    };
  }

  async function reloadFromDisk() {
    const ws = get(workspace_store);
    if (!ws.activeWorkspacePath) {
      setState(() => ({ ...EMPTY_STATE }));
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    const result = await platform.wsReadInbox(ws.activeWorkspacePath);
    if (!result.success || !result.projectDir || !result.rootId || !result.tasks) {
      setError(result.error || "Failed to read inbox");
      return;
    }
    const items = tasksRecordToItems(result.tasks, result.rootId);
    setState(() => ({
      workspacePath: ws.activeWorkspacePath,
      projectDir: result.projectDir!,
      rootId: result.rootId!,
      items,
      loading: false,
      error: null,
    }));
  }

  // Bulk persistence is throttled so rapid edits in the inbox view collapse
  // into a single workspace write (latest-wins).
  const persistThrottled = throttle(
    async () => {
      const state = get(internal);
      if (!state.projectDir || !state.rootId) return;
      const rootTask: WorkspaceTask = {
        id: state.rootId,
        name: "Inbox",
        status: "Open",
        parents: [],
        memos: [],
        createdAt: new Date().toISOString().slice(0, 10),
      };
      const tasks: WorkspaceTask[] = [
        rootTask,
        ...state.items.map((item, index) => ({
          ...item,
          parents: [state.rootId!],
          order: index,
        })),
      ];
      try {
        const forceLocal = isPreferMemoryActive();
        const result = await platform.wsWriteProject(
          state.projectDir,
          tasks,
          forceLocal ? { forceLocal: true } : undefined
        );
        if (!result?.success) {
          saveStatus.set("error");
        }
      } catch {
        saveStatus.set("error");
      }
    },
    600,
    { leading: false, trailing: true }
  );

  function scheduleWrite() {
    saveStatus.set("queued");
    persistThrottled();
  }

  return {
    subscribe: internal.subscribe,
    init: () => {
      if (initialized) return;
      initialized = true;

      // React to workspace switches: re-read when activeWorkspacePath changes.
      workspace_store.subscribe((state) => {
        const next = state.activeWorkspacePath || null;
        if (next === lastWorkspacePath) return;
        lastWorkspacePath = next;
        if (next) {
          reloadFromDisk();
        } else {
          setState(() => ({ ...EMPTY_STATE }));
        }
      });

      // External updates (Quick Capture from another window, file watcher,
      // moves into / out of the inbox project).
      platform.onWorkspaceProjectUpdated((event) => {
        const current = get(internal);
        if (!current.projectDir || event.projectDir !== current.projectDir) return;
        if (!current.rootId) return;
        const items = tasksRecordToItems(event.tasks, current.rootId);
        setState((prev) => ({ ...prev, items, loading: false, error: null }));
      });
    },
    reload: reloadFromDisk,
    addItem: async (partial) => {
      const location = await ensureLocation();
      if (!location) {
        return { success: false, error: "No active workspace" };
      }
      const id = partial.id || uuidV4();
      const item = { ...partial, id };
      const result = await platform.wsAddInboxItem(location.workspacePath, item);
      if (!result.success || !result.task) {
        return { success: false, error: result.error || "Failed to add inbox item" };
      }

      // Optimistically merge so views update before the watcher echo arrives.
      setState((current) => {
        if (!current.rootId || !current.projectDir) {
          return {
            workspacePath: location.workspacePath,
            projectDir: location.projectDir,
            rootId: location.rootId,
            items: [result.task!],
            loading: false,
            error: null,
          };
        }
        // Avoid duplicates if the watcher event lands first.
        const filtered = current.items.filter((existing) => existing.id !== result.task!.id);
        return {
          ...current,
          items: sortItems([...filtered, result.task!]),
        };
      });
      return { success: true, task: result.task };
    },
    updateItem: async (taskId, patch) => {
      const current = get(internal);
      if (!current.rootId) {
        return { success: false, error: "Inbox not ready" };
      }
      const index = current.items.findIndex((item) => item.id === taskId);
      if (index === -1) {
        return { success: false, error: "Item not found" };
      }
      const next = current.items.slice();
      next[index] = {
        ...next[index],
        ...patch,
        parents: [current.rootId],
      };
      setState((state) => ({ ...state, items: sortItems(next) }));
      scheduleWrite();
      return { success: true };
    },
    deleteItems: async (taskIds) => {
      if (taskIds.length === 0) return { success: true };
      const current = get(internal);
      if (!current.rootId) {
        return { success: false, error: "Inbox not ready" };
      }
      const idSet = new Set(taskIds);
      const next = current.items.filter((item) => !idSet.has(item.id));
      if (next.length === current.items.length) {
        return { success: true };
      }
      setState((state) => ({ ...state, items: next }));
      scheduleWrite();
      return { success: true };
    },
    reorder: async (orderedIds) => {
      const current = get(internal);
      if (!current.rootId) {
        return { success: false, error: "Inbox not ready" };
      }
      const byId = new Map(current.items.map((item) => [item.id, item]));
      const next: WorkspaceTask[] = [];
      for (const id of orderedIds) {
        const item = byId.get(id);
        if (item) {
          next.push(item);
          byId.delete(id);
        }
      }
      // Append items that weren't included (defensive).
      for (const item of byId.values()) next.push(item);
      setState((state) => ({
        ...state,
        items: next.map((item, index) => ({ ...item, order: index })),
      }));
      scheduleWrite();
      return { success: true };
    },
    sendToProject: async ({ targetProjectDir, targetRootId, targetParentId, taskIds }) => {
      const current = get(internal);
      if (!current.workspacePath) {
        return { success: false, error: "No active workspace" };
      }
      if (taskIds.length === 0) {
        return { success: false, error: "No items selected" };
      }
      const result = await platform.wsSendInboxItems({
        workspacePath: current.workspacePath,
        targetProjectDir,
        targetRootId,
        targetParentId,
        taskIds,
      });
      if (result.success && Array.isArray(result.moved) && result.moved.length > 0) {
        const movedSet = new Set(result.moved);
        setState((state) => ({
          ...state,
          items: state.items.filter((item) => !movedSet.has(item.id)),
        }));
      }
      return result;
    },
  };
}

export const inbox_store = createInboxStore();

/** Derived view: just the count of pending inbox items (used by the sidebar badge). */
export const inbox_count: Readable<number> = derived(inbox_store, ($state) => $state.items.length);
