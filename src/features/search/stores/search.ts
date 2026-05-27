import { debounce } from "lodash";
import { get, writable, type Writable } from "svelte/store";
import {
  filterTree,
  getNode,
  sortTree,
  stripArchivedNodes,
  type ProjectData,
  type TreeData,
} from "@features/tasks/utils/tree_control";
import type { FilterState, SortState } from "@app-types/app";
import { tree_data } from "@features/tasks/stores/tree";
import { selected_id, selected_type, show_archived, table_selected_id } from "@stores/ui";
import { sort_state } from "@features/tasks/stores/sort";
import { workspace_store, workspace_tasks_cache } from "@features/workspace/stores/workspace";
import * as platform from "@lib/ipc/platform";
import type { WorkspaceMemo } from "@app-types/workspace";

export interface FilterStore extends Writable<FilterState> {
  init: () => void;
}

let workspaceMemoHydrationKey = "";

function hasMemoBodySearch(current: FilterState): boolean {
  return (
    (current?.search_memo?.length ?? 0) > 0 &&
    (current?.full_text ?? []).some((keyword) => String(keyword || "").trim())
  );
}

function treeHasUnloadedMemo(node: TreeData | undefined): boolean {
  if (!node) return false;
  if ((node.data.memo ?? []).some((entry) => entry?.bodyLoaded === false)) {
    return true;
  }
  return (node.children ?? []).some(treeHasUnloadedMemo);
}

function mergeProjectMemos(
  node: TreeData,
  memosByTaskId: Record<string, WorkspaceMemo[]>
): { node: TreeData; changed: boolean } {
  let changed = false;
  const ownMemos = memosByTaskId[node.id];
  const data = ownMemos ? { ...node.data, memo: ownMemos } : node.data;
  if (ownMemos) changed = true;

  const children = (node.children ?? []).map((child) => {
    const merged = mergeProjectMemos(child, memosByTaskId);
    if (merged.changed) changed = true;
    return merged.node;
  });

  if (!changed) return { node, changed: false };
  return { node: { ...node, data, children }, changed: true };
}

async function hydrateWorkspaceMemosForSearch(current: FilterState, currentTreeData: ProjectData) {
  if (!hasMemoBodySearch(current)) return;
  if (get(selected_type) !== "WorkspaceProject") return;
  if (!treeHasUnloadedMemo(currentTreeData.data)) return;

  const { activeProjectDir } = get(workspace_store);
  const projectId = get(selected_id);
  if (!activeProjectDir || !projectId) return;

  const key = `${activeProjectDir}:${projectId}`;
  if (workspaceMemoHydrationKey === key) return;
  workspaceMemoHydrationKey = key;

  try {
    const result = await platform.wsReadProjectMemos(activeProjectDir);
    if (!result?.memosByTaskId || get(selected_type) !== "WorkspaceProject") return;
    if (
      get(workspace_store).activeProjectDir !== activeProjectDir ||
      get(selected_id) !== projectId
    ) {
      return;
    }

    const latestTreeData = get(tree_data);
    if (!latestTreeData?.data) return;
    const merged = mergeProjectMemos(latestTreeData.data, result.memosByTaskId);
    if (!merged.changed) return;

    tree_data.setFromSource({ ...latestTreeData, data: merged.node });
    workspace_tasks_cache.update((cache) => {
      let changed = false;
      const next = { ...cache };
      for (const [taskId, memos] of Object.entries(result.memosByTaskId)) {
        if (!next[taskId]) continue;
        changed = true;
        next[taskId] = { ...next[taskId], memos };
      }
      return changed ? next : cache;
    });
  } finally {
    if (workspaceMemoHydrationKey === key) {
      workspaceMemoHydrationKey = "";
    }
  }
}

function createFilter(initialValue: FilterState): FilterStore {
  const { subscribe, set, update } = writable<FilterState>(initialValue);

  /**
   * show_archived が OFF のとき、ツリーから archived ノードを切り落として
   * から後段に渡す。これによってフィルター・件数・ページ内検索・タグ集計の
   * すべてが「画面に見えているもの」に一致する。
   */
  const archivedAdjustedTree = (data: ProjectData | undefined): ProjectData | undefined => {
    if (!data?.data) return data;
    if (get(show_archived)) return data;
    return { ...data, data: stripArchivedNodes(data.data) };
  };

  const syncFilteredData = (
    current: FilterState,
    currentTreeData: ProjectData | undefined,
    currentSort: SortState | null
  ) => {
    if (!currentTreeData) {
      applyFilteredData.cancel();
      workspaceMemoHydrationKey = "";
      filtered_data.set(undefined);
      table_selected_id.set(undefined);
      return;
    }

    hydrateWorkspaceMemosForSearch(current, currentTreeData);

    const visibleTreeData = archivedAdjustedTree(currentTreeData);
    if (!visibleTreeData?.data) {
      applyFilteredData.cancel();
      filtered_data.set(undefined);
      table_selected_id.set(undefined);
      return;
    }

    if (!hasActiveFilters(current)) {
      applyFilteredData.cancel();
      const nextTree = (sortTree(visibleTreeData.data, currentSort) ??
        visibleTreeData.data) as TreeData;
      if (
        !get(table_selected_id) ||
        !nextTree ||
        !getNode(get(table_selected_id) as string, nextTree)
      ) {
        table_selected_id.set(undefined);
      }

      filtered_data.set(nextTree);
      return;
    }

    applyFilteredData(current, visibleTreeData, currentSort);
  };

  const applyFilteredData = debounce(
    (current: FilterState, currentTreeData: ProjectData, currentSort: SortState | null) => {
      const filtered = filterTree(currentTreeData.data, current);
      const sorted = (sortTree(filtered, currentSort) ?? filtered) as TreeData | null | undefined;
      if (
        !get(table_selected_id) ||
        !sorted ||
        !getNode(get(table_selected_id) as string, sorted)
      ) {
        table_selected_id.set(undefined);
      }

      filtered_data.set(sorted);
    },
    500
  );

  const hasActiveFilters = (current: FilterState) =>
    Object.keys(current || {}).some(
      (key) => key !== "search_memo" && current[key] && current[key].length > 0
    );

  return {
    subscribe,
    set,
    update,
    init: () => {
      subscribe((current) => {
        syncFilteredData(current, get(tree_data), get(sort_state));
      });

      tree_data.subscribe((currentTreeData) => {
        syncFilteredData(
          get({ subscribe } as Writable<FilterState>),
          currentTreeData,
          get(sort_state)
        );
      });

      sort_state.subscribe((currentSort) => {
        syncFilteredData(get({ subscribe } as Writable<FilterState>), get(tree_data), currentSort);
      });

      show_archived.subscribe(() => {
        // show_archived の変更時にも再フィルター（archived の strip 有無が変わる）。
        syncFilteredData(
          get({ subscribe } as Writable<FilterState>),
          get(tree_data),
          get(sort_state)
        );
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let filter: FilterStore = createFilter({});
export const filtered_data = writable<TreeData | null | undefined>(undefined);
export const pageSearchQuery = writable<string>("");
