import { get, writable, type Writable } from "svelte/store";
import {
  collectTreePaths,
  getNode,
  getNodeByPath,
  pathIncludesNode,
  pathLeafId,
  type TreeData,
} from "@features/tasks/utils/tree_control";
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

/**
 * `pendingTaskDetailSelection` をセットする。`setTaskDetailWindowTarget`
 * と違い `selected_type` / `selected_id` の store には触らない。
 * 主にページ遷移履歴の back/forward 用：load 完了後に loader 内で消費される
 * 「このプロジェクトのこのタスクを選択しろ」というヒントだけを与える。
 */
export function setPendingTaskDetailSelection(value: PendingTaskDetailSelection | undefined) {
  pendingTaskDetailSelection = value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export interface SelectedIdStore extends Writable<string | undefined> {
  init: () => void;
}

/**
 * 折り畳み状態は**行（＝辺）ごと**に持つ。多親ノードは親ごとに別の行として
 * 現れるので、ノード id で持つと片方を畳んだだけで全部が畳まれてしまう。
 * 集合の要素は `VisibleTreeRow.path`（`ルートid/親id/子id`）。
 *
 * ノード id しか分からない呼び出し（追加・貼り付け後の自動展開、削除後の
 * 後始末）は `expandNodeEverywhere` / `pruneNodes` を使う。
 */
export interface ClosedRowPathsStore extends Writable<Set<string>> {
  init: () => void;
  add: (path: string) => void;
  delete: (path: string) => void;
  /** そのノードを、現れるすべての経路で開く。子孫の折り畳みは保つ。 */
  expandNodeEverywhere: (nodeId: string) => void;
  /** 消えたノードの残骸を捨てる。そのノードを通る経路をすべて外す。 */
  pruneNodes: (nodeIds: Iterable<string>) => void;
  /**
   * 移動でノードの経路が変わったとき、折り畳み状態を新しい経路へ移す。
   * これをしないと、畳んだノードを動かした瞬間に開いてしまう。
   */
  rekey: (oldPath: string, newPath: string) => void;
  /** ツリーに存在しない経路を捨てる。移動を繰り返しても溜まらないように。 */
  pruneMissing: (tree: TreeData | undefined) => void;
  expandAll: () => void;
  collapseAll: () => void;
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
                selectOnly(pendingTaskDetailSelection.taskId);
              } else {
                clearPendingTaskDetailSelection();
                selectOnly(result.data.id);
              }
            } else {
              // プロジェクト選択時は、ツリーのルート (= プロジェクト名)
              // を自動選択する。
              selectOnly(result.data.id);
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
              selectOnly(pendingTaskDetailSelection.taskId);
            } else {
              // プロジェクト選択時は、ツリーのルート (= プロジェクト名)
              // を自動選択する。
              selectOnly(converted.data.id);
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

/**
 * 永続化キー。旧版はノード id の配列を `closed_nodes_<projectId>` に置いていた。
 * 意味が「ノード」から「経路」に変わったので新しいキーにする（旧キーは読まない）。
 * 影響は「移行後の初回だけ折り畳み状態が初期化される」ことだけ。
 */
function closedPathsMetaKey(projectId: string): string {
  return `closed_paths_${projectId}`;
}

function createClosedRowPaths(initialValue: Set<string>): ClosedRowPathsStore {
  const projectExpandedStates = new Map<string, Set<string>>();
  const { subscribe, set, update } = writable<Set<string>>(initialValue || new Set());

  const loadState = async (projectId: string) => {
    if (!projectId) return undefined;

    try {
      const metaKey = closedPathsMetaKey(projectId);
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
      platform.setMetaData(closedPathsMetaKey(projectId), Array.from(state));
    } catch {
      // ignore save error
    }
  };

  /** 現在プロジェクトの折り畳み集合を書き換えて保存する共通処理。 */
  const mutate = (apply: (draft: Set<string>) => void) => {
    const projectId = get(selected_id);
    if (!projectId) return;

    update((currentState) => {
      const newState = new Set(currentState);
      apply(newState);
      if (newState.size === currentState.size) {
        let same = true;
        for (const path of newState) {
          if (!currentState.has(path)) {
            same = false;
            break;
          }
        }
        if (same) return currentState;
      }
      projectExpandedStates.set(projectId, newState);
      saveState(projectId, newState);
      return newState;
    });
  };

  return {
    subscribe,
    set,
    update,
    add: (path: string) => {
      mutate((newState) => {
        newState.add(path);
      });
    },
    delete: (path: string) => {
      mutate((newState) => {
        newState.delete(path);
      });
    },
    expandNodeEverywhere: (nodeId: string) => {
      if (!nodeId) return;
      mutate((newState) => {
        for (const path of [...newState]) {
          // その行だけを開く。子孫の折り畳みはそのまま残す。
          if (pathLeafId(path) === nodeId) newState.delete(path);
        }
      });
    },
    pruneNodes: (nodeIds: Iterable<string>) => {
      const removed = new Set(nodeIds);
      if (removed.size === 0) return;
      mutate((newState) => {
        // 消えたノードを通る経路（その行と、そこから下の子孫の行）をまとめて外す。
        // 他の親から辿れる子孫の行は生きているので残る。
        for (const path of [...newState]) {
          if ([...removed].some((id) => pathIncludesNode(path, id))) newState.delete(path);
        }
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
    rekey: (oldPath: string, newPath: string) => {
      if (!oldPath || !newPath || oldPath === newPath) return;
      mutate((newState) => {
        for (const path of [...newState]) {
          if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
          newState.delete(path);
          newState.add(`${newPath}${path.slice(oldPath.length)}`);
        }
      });
    },
    pruneMissing: (tree: TreeData | undefined) => {
      if (!tree) return;
      mutate((newState) => {
        for (const path of [...newState]) {
          if (!getNodeByPath(tree, path)) newState.delete(path);
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
      const newState = new Set<string>(collectTreePaths(currentTreeData.data));
      projectExpandedStates.set(projectId, newState);
      saveState(projectId, newState);
      set(newState);
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
export let closed_row_paths: ClosedRowPathsStore = createClosedRowPaths(new Set<string>());

/**
 * いま操作している行（辺）の経路。多親ノードは親ごとに複数の行として現れる
 * ので、「選択されているノード」だけでは、移動・インデント・折り畳みが
 * どの行に対する操作なのかが決まらない。
 *
 * 実体は TreeTable が行の一覧から決めて書き込む。ツールバーやショートカット
 * （MainPage）も同じ行に対して操作できるよう、store に置いている。
 */
export const active_row_path: Writable<string | undefined> = writable<string | undefined>(
  undefined
);
// eslint-disable-next-line prefer-const
export let selected_id: SelectedIdStore = createSelectedID(undefined);

export interface ShowArchivedStore extends Writable<boolean> {
  init: () => void;
}

/**
 * 「アーカイブを表示する」トグルのプロジェクトごとの状態。
 * `meta.json` に `show_archived_<projectId>` として永続化する。
 */
function createShowArchived(): ShowArchivedStore {
  const cache = new Map<string, boolean>();
  const { subscribe, set, update } = writable<boolean>(false);

  const loadState = async (projectId: string) => {
    if (!projectId) return;
    try {
      const result = await platform.getMetaData(`show_archived_${projectId}`);
      const value = result === true;
      cache.set(projectId, value);
      set(value);
    } catch {
      set(false);
    }
  };

  const saveState = (projectId: string, value: boolean) => {
    if (!projectId) return;
    try {
      platform.setMetaData(`show_archived_${projectId}`, value);
    } catch {
      // ignore save error
    }
  };

  return {
    subscribe,
    set: (value: boolean) => {
      const projectId = get(selected_id);
      if (projectId) {
        cache.set(projectId, value);
        saveState(projectId, value);
      }
      set(value);
    },
    update,
    init: () => {
      selected_id.subscribe(async (projectId) => {
        if (projectId) {
          if (cache.has(projectId)) {
            set(cache.get(projectId)!);
          } else {
            await loadState(projectId);
          }
        } else {
          set(false);
        }
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let show_archived: ShowArchivedStore = createShowArchived();

// Multi-select state for the task tree.
// `selected_ids` holds the live set; `selection_anchor_id` is the pivot used
// for Shift-range expansion. `table_selected_id` continues to act as the
// "primary" / focused row (used by TaskDetail, MemoTab, paste-after target).
export const selected_ids: Writable<Set<string>> = writable<Set<string>>(new Set<string>());
// A focused row and a checked row are different concepts. Plain row clicks
// keep selected_ids as the operation target for compatibility, while this flag
// controls whether the checkbox/header expose an active bulk selection.
export const bulk_selection_active: Writable<boolean> = writable(false);
/**
 * Shift 選択の起点になっている**行**の経路。`selection_anchor_id` だけだと、
 * 多親ノードでどの出現が起点なのかが決まらない。
 */
export const selection_anchor_path: Writable<string | undefined> = writable<string | undefined>(
  undefined
);

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
  bulk_selection_active.set(false);
  selected_ids.set(new Set<string>());
  selection_anchor_id.set(undefined);
  selection_anchor_path.set(undefined);
  table_selected_id.set(undefined);
}

export function selectOnly(id: string, path?: string) {
  bulk_selection_active.set(false);
  const next = new Set<string>([id]);
  selected_ids.set(next);
  selection_anchor_id.set(id);
  // 起点の行（辺）。多親ノードでどの出現から Shift 選択を始めたかを覚える。
  selection_anchor_path.set(path);
  mirrorTableSelected(next, id);
}

export function toggleSelection(id: string) {
  bulk_selection_active.set(true);
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

/**
 * Shift 選択。範囲は「画面に並んでいる行」の上で決まる。
 *
 * 多親ノードは同じ id の行が複数あるので、id の配列から `indexOf` で端を
 * 探すと別の出現が端になり、選ぶ範囲がずれる。行が分かる呼び出し
 * （`rows` を渡す TreeTable）は経路で端を決める。
 */
export function selectRange(
  targetId: string,
  visibleRowIds: string[],
  rows?: { id: string; path: string }[],
  targetPath?: string
) {
  const anchor = get(selection_anchor_id);
  if (!anchor || !visibleRowIds.includes(anchor) || !visibleRowIds.includes(targetId)) {
    // No valid anchor: fall back to single-select.
    selectOnly(targetId);
    bulk_selection_active.set(true);
    return;
  }
  bulk_selection_active.set(true);

  let a: number;
  let b: number;
  // 起点の経路は、`selection_anchor_id` を動かす他の入口（Ctrl+クリック、
  // 選択のクリア、ツリー更新時の刈り込み）では更新されないので、古くなり得る。
  // 起点 id と一致する行を指しているときだけ信じる。
  const anchorPath = get(selection_anchor_path);
  if (rows && targetPath) {
    a = rows.findIndex((row) => row.path === anchorPath && row.id === anchor);
    if (a < 0) a = rows.findIndex((row) => row.id === anchor);
    b = rows.findIndex((row) => row.path === targetPath);
    if (b < 0) b = rows.findIndex((row) => row.id === targetId);
  } else {
    a = visibleRowIds.indexOf(anchor);
    b = visibleRowIds.indexOf(targetId);
  }
  if (a < 0 || b < 0) {
    selectOnly(targetId);
    return;
  }
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const next = new Set<string>(
    rows && targetPath
      ? rows.slice(lo, hi + 1).map((row) => row.id)
      : visibleRowIds.slice(lo, hi + 1)
  );
  selected_ids.set(next);
  // anchor remains unchanged
  mirrorTableSelected(next, anchor);
}

export function selectAll(visibleRowIds: string[]) {
  if (visibleRowIds.length === 0) {
    clearSelection();
    return;
  }
  bulk_selection_active.set(true);
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
    if (next.size === 0) bulk_selection_active.set(false);
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

/** 初期画面など、サイドバー外からWorkspace設定を開くための共有状態。 */
export const showWorkspaceSetup = writable(false);

export const saveStatus = writable<SaveStatus>("idle");

// Populated with a *live* node reference at copy time (see TreeTable.svelte's
// handleCopyTask) — not cloned yet. TreeTable.svelte's handlePasteTask clones
// with fresh ids on every paste, both for the node actually inserted into the
// tree AND to refresh this store to a new, still-detached snapshot. That
// refresh matters: without it, pasting the project root (whose only possible
// paste targets are its own descendants) would leave this store aliasing a
// live subtree that grows with every paste, so a second paste from the same
// copy would clone an already-grown tree instead of the original one.
export const copied_task = writable<TreeData | null>(null);

// Multi-selection clipboard. When non-empty, takes precedence over `copied_task`.
export const copied_tasks = writable<TreeData[]>([]);

/**
 * The left navigation sidebar always starts hidden on launch. Per UX
 * feedback we do NOT persist the open/closed preference across sessions —
 * each window opens with the maximum amount of working space available.
 */
export const sidebarCollapsed = writable<boolean>(true);
