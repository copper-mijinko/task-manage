import { get, writable, type Writable } from "svelte/store";
import type { PendingTaskDetailSelection, SelectedType } from "@app-types/app";
import * as platform from "@lib/ipc/platform";

export { saveStatus } from "./save_status";

/**
 * 「このプロジェクトのこのノードを選んで」というヒント。ページ遷移履歴の
 * 戻る／進むが入れ、`WorkspaceTreeGridPage` がプロジェクトを開いた直後に消費する。
 */
export let pendingTaskDetailSelection: PendingTaskDetailSelection | undefined = undefined;

export function clearPendingTaskDetailSelection() {
  pendingTaskDetailSelection = undefined;
}

export function setPendingTaskDetailSelection(value: PendingTaskDetailSelection | undefined) {
  pendingTaskDetailSelection = value;
}

export const selected_type: Writable<SelectedType> = writable<SelectedType>(undefined);
export const table_selected_id: Writable<string | undefined> = writable<string | undefined>(
  undefined
);

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
/** 開いているプロジェクト（スコープ）のノード id。 */
export const selected_id: Writable<string | undefined> = writable<string | undefined>(undefined);

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

export const show_archived: ShowArchivedStore = createShowArchived();

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

export const showPageSearch = writable(false);

/**
 * Whether the Inbox Quick Capture overlay is currently shown. Toggled by
 * the header button and the global Ctrl+Shift+I shortcut.
 */
export const showQuickCapture = writable(false);

/**
 * 「作った直後の行をそのまま名前入力にする」ためのハンドオフ。
 *
 * 追加ボタンを押しても名前欄にフォーカスが入らず、行は既定名の「新しいノード」
 * のまま残っていた。連続で追加すると同名の行が並び、名前を付けるには毎回
 * マウスへ持ち替えてダブルクリックする必要があった。
 *
 * 行を作った側がここに node id を書き、その行の TaskName が拾って編集モードへ
 * 入り、フォーカスと全選択まで済ませたら undefined に戻す。
 */
export const pending_rename_id = writable<string | undefined>(undefined);

/** 初期画面など、サイドバー外からWorkspace設定を開くための共有状態。 */
export const showWorkspaceSetup = writable(false);

/**
 * The left navigation sidebar always starts hidden on launch. Per UX
 * feedback we do NOT persist the open/closed preference across sessions —
 * each window opens with the maximum amount of working space available.
 */
export const sidebarCollapsed = writable<boolean>(true);
