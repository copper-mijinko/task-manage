import debounce from "lodash/debounce";
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
import {
  selectOnly,
  selected_id,
  selected_type,
  show_archived,
  table_selected_id,
} from "@stores/ui";
import { sort_state } from "@features/tasks/stores/sort";
import { workspace_store, workspace_tasks_cache } from "@features/workspace/stores/workspace";
import * as platform from "@lib/ipc/platform";
import type { NodeBody } from "@app-types/workspace";

export interface FilterStore extends Writable<FilterState> {
  init: () => void;
}

let workspaceBodyHydrationKey = "";

function hasBodySearch(current: FilterState): boolean {
  return (
    (current?.search_memo?.length ?? 0) > 0 &&
    (current?.full_text ?? []).some((keyword) => String(keyword || "").trim())
  );
}

function treeHasUnloadedBody(node: TreeData | undefined): boolean {
  if (!node) return false;
  if (node.data.bodyLoaded === false) return true;
  return (node.children ?? []).some(treeHasUnloadedBody);
}

function mergeProjectBodies(
  node: TreeData,
  bodiesByTaskId: Record<string, NodeBody>,
  // 多親ノードの複数の出現は同じオブジェクトを共有している（workspace_tree の
  // 射影を参照）。作り直すときに出現ごとに別オブジェクトを作ると共有が壊れ、
  // 以後の編集が片方の出現にしか効かなくなる。同じ入力には同じ出力を返す。
  rebuilt: Map<TreeData, { node: TreeData; changed: boolean }> = new Map()
): { node: TreeData; changed: boolean } {
  const already = rebuilt.get(node);
  if (already) return already;

  let changed = false;
  const own = bodiesByTaskId[node.id];
  const data = own
    ? { ...node.data, body: own.body, format: own.format, bodyLoaded: true }
    : node.data;
  if (own) changed = true;

  const children = (node.children ?? []).map((child) => {
    const merged = mergeProjectBodies(child, bodiesByTaskId, rebuilt);
    if (merged.changed) changed = true;
    return merged.node;
  });

  const result = changed
    ? { node: { ...node, data, children }, changed: true }
    : { node, changed: false };
  rebuilt.set(node, result);
  return result;
}

async function hydrateWorkspaceBodiesForSearch(current: FilterState, currentTreeData: ProjectData) {
  if (!hasBodySearch(current)) return;
  if (get(selected_type) !== "WorkspaceProject") return;
  if (!treeHasUnloadedBody(currentTreeData.data)) return;

  const { activeProjectDir } = get(workspace_store);
  const projectId = get(selected_id);
  if (!activeProjectDir || !projectId) return;

  const key = `${activeProjectDir}:${projectId}`;
  if (workspaceBodyHydrationKey === key) return;
  workspaceBodyHydrationKey = key;

  try {
    const result = await platform.wsReadProjectBodies(activeProjectDir);
    if (!result?.bodiesByTaskId || get(selected_type) !== "WorkspaceProject") return;
    if (
      get(workspace_store).activeProjectDir !== activeProjectDir ||
      get(selected_id) !== projectId
    ) {
      return;
    }

    const latestTreeData = get(tree_data);
    if (!latestTreeData?.data) return;
    const merged = mergeProjectBodies(latestTreeData.data, result.bodiesByTaskId);
    if (!merged.changed) return;

    tree_data.setFromSource({ ...latestTreeData, data: merged.node });
    workspace_tasks_cache.update((cache) => {
      let changed = false;
      const next = { ...cache };
      for (const [taskId, entry] of Object.entries(result.bodiesByTaskId)) {
        if (!next[taskId]) continue;
        changed = true;
        next[taskId] = {
          ...next[taskId],
          body: entry.body,
          format: entry.format,
          bodyLoaded: true,
        };
      }
      return changed ? next : cache;
    });
  } finally {
    if (workspaceBodyHydrationKey === key) {
      workspaceBodyHydrationKey = "";
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
      workspaceBodyHydrationKey = "";
      filtered_data.set(undefined);
      table_selected_id.set(undefined);
      return;
    }

    hydrateWorkspaceBodiesForSearch(current, currentTreeData);

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
        // A filter can clear the focused row when it temporarily hides that row.
        // When the full tree returns, focus the project root so the detail pane
        // never remains in an orphaned "No data." state.
        selectOnly(nextTree.id);
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
