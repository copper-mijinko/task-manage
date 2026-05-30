import { uuidV4 } from "@lib/utils/uuid";
import { memoContentForSearch, type MemoFormat } from "@features/memos/utils/memo_utils";
import type { SortState } from "@app-types/app";

export type TaskStatus = "Open" | "Pending" | "In Progress" | "Completed" | "Canceled";

export interface MemoEntry {
  id: string;
  title: string;
  content: unknown;
  tags: string[];
  format?: MemoFormat;
  bodyLoaded?: boolean;
}

export interface TaskAttachmentEntry {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedAt?: string;
}

export interface TreeNodeData {
  name: string;
  status: TaskStatus;
  "start date": `${string}-${string}-${string}` | undefined;
  "due date": `${string}-${string}-${string}` | undefined;
  memo: MemoEntry[];
  attachments?: TaskAttachmentEntry[];
  [key: string]: unknown;
}

export interface TreeData {
  id: string;
  data: TreeNodeData;
  children: TreeData[];
  /**
   * アーカイブされたノードに付くフラグ。`true` のときはツリーから「論理削除」
   * された扱いで、`flattenVisibleTree` の `includeArchived` が `false`
   * （既定）の場合に自分自身と子孫が表示対象から外れる。
   *
   * `permanentlyDeleteNode` ／ `bulkRemoveNodes` を呼ぶまでデータとしては残る。
   * 親が archived のとき子も連動して非表示になる（子の archived フラグの
   * 有無は問わない）。
   */
  archived?: boolean;
  /** archived を立てた時刻（ISO 8601）。表示ソート用。 */
  archivedAt?: string;
}

export interface ProjectHeader {
  name: string;
  default_ratio: number;
}

export interface ProjectData {
  headers: ProjectHeader[];
  data: TreeData;
}

export interface VisibleTreeRow {
  id: string;
  depth: number;
  parentId?: string;
  siblingIndex: number;
  siblingCount: number;
  node: TreeData;
  hasChildren: boolean;
  expanded: boolean;
  /**
   * True when this row is archived OR sits under an archived ancestor. Only
   * meaningful in the show-archived view (includeArchived=true); in the normal
   * view archived subtrees are skipped entirely. Rows use this — not the row's
   * own `node.archived` — to drive read-only / muted-row behaviour so children
   * of an archived task are treated as archived too.
   */
  effectivelyArchived: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canIndent: boolean;
  canOutdent: boolean;
}

const FILTER_FLAG_KEYS = new Set(["search_memo"]);

function valueForFullText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function tokenizeFullTextQuery(input: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(input)) !== null) {
    const token = m[1] !== undefined ? m[1] : m[2];
    if (token) tokens.push(token);
  }
  return tokens;
}

function fullTextMatches(data: TreeNodeData, keywords: string[], includeMemo: boolean): boolean {
  const fieldText = Object.entries(data)
    .filter(([key]) => key !== "memo")
    .map(([, value]) => valueForFullText(value))
    .join(" ");
  const memoText = includeMemo
    ? (data.memo ?? [])
        .map((entry) =>
          [entry.title, memoContentForSearch(entry.content), (entry.tags ?? []).join(" ")]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ")
    : "";
  const text = `${fieldText} ${memoText}`.toLowerCase();
  const tokens = keywords.flatMap((keyword) => tokenizeFullTextQuery(keyword));
  if (tokens.length === 0) return true;
  return tokens.every((token) => text.includes(token.toLowerCase()));
}

export function filterTree(
  tree: TreeData | null | undefined,
  filter: Record<string, string[]> | null | undefined
): TreeData | null | undefined {
  if (!tree || !filter) return tree;

  // Check match against all filters
  let allFiltersMatch = true;
  let nameFilterMatch = false;
  let fullTextFilterMatch = false;

  // Check if filter is empty
  const hasFilters = Object.keys(filter).some(
    (key) => !FILTER_FLAG_KEYS.has(key) && filter[key] && filter[key].length > 0
  );
  if (!hasFilters) return tree; // Return tree as is if no filters

  // Evaluate each filter
  for (const key in filter) {
    if (FILTER_FLAG_KEYS.has(key)) continue; // flag key, not a data field

    const keywords = filter[key];
    if (!keywords || keywords.length === 0) continue;

    let keyMatch = false;
    if (key === "full_text") {
      keyMatch = fullTextMatches(tree.data, keywords, (filter["search_memo"]?.length ?? 0) > 0);
      fullTextFilterMatch = keyMatch;
    } else if (key === "name") {
      // In case of name filter
      keyMatch = keywords.some(
        (keyword) => tree.data.name && tree.data.name.toLowerCase().includes(keyword.toLowerCase())
      );
      nameFilterMatch = keyMatch; // Record if name filter matched
    } else if (key === "tags") {
      const tag = keywords[0].toLowerCase();
      keyMatch = (tree.data.memo ?? []).some((entry) =>
        ((entry.tags as string[]) ?? []).some((t) => t.toLowerCase() === tag)
      );
    } else if (key === "start date" || key === "due date") {
      const from = keywords[0] ?? "";
      const to = keywords[1] ?? "";
      const nodeDate = (tree.data[key] as string | undefined) ?? "";
      if (!nodeDate) {
        keyMatch = !from && !to;
      } else {
        keyMatch = (!from || nodeDate >= from) && (!to || nodeDate <= to);
      }
    } else if (key === "memo") {
      const minStr = keywords[0] ?? "";
      const maxStr = keywords[1] ?? "";
      const count = Array.isArray(tree.data.memo) ? tree.data.memo.length : 0;
      const minNum = minStr !== "" ? parseInt(minStr, 10) : null;
      const maxNum = maxStr !== "" ? parseInt(maxStr, 10) : null;
      keyMatch = (minNum === null || count >= minNum) && (maxNum === null || count <= maxNum);
    } else {
      // For other filters
      keyMatch = keywords.some(
        (keyword) =>
          tree.data[key] &&
          JSON.stringify(tree.data[key]).toLowerCase().includes(keyword.toLowerCase())
      );
    }

    if (!keyMatch) {
      allFiltersMatch = false;
      // Early exit only for non-name filters
      if (key !== "name") break;
    }
  }

  // Process child nodes
  const matchedChildren: TreeData[] = [];
  for (const child of tree.children || []) {
    if ((nameFilterMatch || fullTextFilterMatch) && allFiltersMatch) {
      // If name/full-text filter matches and all filters match,
      // include all child nodes (no filtering)
      matchedChildren.push(cloneTreeWithAllChildren(child));
    } else {
      // Otherwise filter recursively
      const filteredChild = filterTree(child, filter);
      if (filteredChild) {
        matchedChildren.push(filteredChild);
      }
    }
  }

  // Determine the result
  if (allFiltersMatch || matchedChildren.length > 0) {
    const cloned = { ...tree, children: matchedChildren };
    return cloned;
  }

  return null;
}

// Helper function to clone the given tree node and all its children
function cloneTreeWithAllChildren(tree: TreeData): TreeData {
  const children = (tree.children || []).map((child) => cloneTreeWithAllChildren(child));

  return { ...tree, children };
}

export function cloneWithNewIds(node: TreeData): TreeData {
  return {
    id: `${uuidV4()}`,
    data: {
      ...node.data,
      memo: [...node.data.memo],
      attachments: node.data.attachments ? [...node.data.attachments] : undefined,
    },
    children: node.children.map((child) => cloneWithNewIds(child)),
  };
}

export function getDefaultNode(): TreeData {
  return {
    id: `${uuidV4()}`,
    data: {
      name: "new_task",
      status: "Open",
      "start date": undefined,
      "due date": undefined,
      memo: [],
    },
    children: [],
  };
}

export function getDefaultProject(): ProjectData {
  return {
    headers: [
      {
        name: "name",
        default_ratio: 10,
      },
      {
        name: "status",
        default_ratio: 4,
      },
      {
        name: "start date",
        default_ratio: 4,
      },
      {
        name: "due date",
        default_ratio: 4,
      },
      {
        name: "memo",
        default_ratio: 2,
      },
      {
        name: "attachments",
        default_ratio: 2,
      },
    ],
    data: {
      id: `${uuidV4()}`,
      data: {
        name: "new_project",
        status: "Open",
        "start date": undefined,
        "due date": undefined,
        memo: [],
        attachments: [],
      },
      children: [],
    },
  };
}

export function getNode(base: string, tree_data: TreeData | undefined): TreeData | undefined {
  // Depth First Search
  let base_tree: TreeData | undefined;
  if (!tree_data) {
    return undefined;
  }
  if (tree_data.id == base) {
    return tree_data;
  }
  for (const child of tree_data.children) {
    if (child.id == base) {
      base_tree = child;
    } else {
      base_tree = getNode(base, child);
    }
    if (base_tree) {
      break;
    }
  }
  return base_tree;
}

export function updateNodeDataById(
  tree_data: TreeData | undefined,
  targetId: string,
  patch: Partial<TreeData["data"]>
): TreeData | undefined {
  if (!tree_data) {
    return tree_data;
  }

  if (tree_data.id === targetId) {
    return {
      ...tree_data,
      data: {
        ...tree_data.data,
        ...patch,
      },
    };
  }

  if (!tree_data.children || tree_data.children.length === 0) {
    return tree_data;
  }

  let hasChanged = false;
  const updatedChildren = tree_data.children.map((child) => {
    const nextChild = updateNodeDataById(child, targetId, patch) ?? child;
    if (nextChild !== child) {
      hasChanged = true;
    }
    return nextChild;
  });

  if (!hasChanged) {
    return tree_data;
  }

  return {
    ...tree_data,
    children: updatedChildren,
  };
}

export function flattenVisibleTree(
  tree_data: TreeData | undefined,
  closedIds: Set<string> = new Set(),
  includeArchived: boolean = false
): VisibleTreeRow[] {
  if (!tree_data) {
    return [];
  }

  const rows: VisibleTreeRow[] = [];

  const visit = (
    node: TreeData,
    depth: number,
    parentId: string | undefined,
    siblingIndex: number,
    siblingCount: number,
    insideArchived: boolean
  ) => {
    const isArchived = !!node.archived;
    const effectivelyArchived = insideArchived || isArchived;
    if (effectivelyArchived && !includeArchived) {
      // includeArchived=false の通常表示モードでは archived 配下を丸ごとスキップ。
      return;
    }
    const hasChildren = !!(node.children && node.children.length > 0);
    const expanded = !closedIds.has(node.id);

    rows.push({
      id: node.id,
      depth,
      parentId,
      siblingIndex,
      siblingCount,
      node,
      hasChildren,
      expanded,
      effectivelyArchived,
      canMoveUp: siblingIndex > 0,
      canMoveDown: siblingIndex < siblingCount - 1,
      canIndent: siblingIndex > 0,
      canOutdent: depth > 1,
    });

    if (!hasChildren || !expanded) {
      return;
    }

    const childCount = node.children.length;
    node.children.forEach((child, index) => {
      visit(child, depth + 1, node.id, index, childCount, effectivelyArchived);
    });
  };

  visit(tree_data, 0, undefined, 0, 1, false);

  return rows;
}

// 各行に対し、ルートから現在ノードまでの名前パス ("root / a / b / current") を返す。
// 行は flattenVisibleTree の DFS 順 (親が子より先) なので、親のパスを引いて連結するだけで O(N)。
export function buildNodePathMap(rows: VisibleTreeRow[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    const name = row.node.data["name"] ?? "";
    if (row.parentId) {
      const parentPath = result.get(row.parentId);
      result.set(row.id, parentPath ? `${parentPath} / ${name}` : name);
    } else {
      result.set(row.id, name);
    }
  }
  return result;
}

// ツリー全体を DFS して各ノードに 1 始まりの通し番号を割り当てる。
// flattenVisibleTree と違い折り畳み状態を無視するので、ノードを開閉しても番号は動かない。
export function buildLineNumberMap(tree: TreeData | null | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (!tree) return result;

  let counter = 0;
  const visit = (node: TreeData) => {
    counter += 1;
    result.set(node.id, counter);
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(tree);
  return result;
}

// ツリーテーブルのスクロール時に、ヘッダー直下のスティッキーバーへ表示する
// パンくず (祖先列) を計算する。
//
// 仕様:
//  - スティッキーバーは本文行 1 行分 (= rowHeightPx) を覆い隠す。
//    floor(scrollTop / rowHeightPx) は「覆われている行」のインデックス。
//    ユーザが実際にバー下に最初に見る本文行はその +1。
//  - パンくずに含めるのは「最上段可視行 の祖先のみ」(自分自身は除く)。
//    可視行そのものを混ぜると、子を持たない兄弟ノードを横切るときに
//    祖先ではない兄弟が一瞬パンくずに混入してしまう。
//  - depth が 1 以下のときの祖先はルートのみ。ルート名は別途見えているので
//    冗長なパンくずを避けるため空配列を返す。
export function buildStickyTrail(
  visibleRows: VisibleTreeRow[],
  scrollTop: number,
  rowHeightPx: number,
  // Optional precomputed id→row map. Callers that recompute the trail on every
  // scroll event (TreeTable) should pass a map memoized against `visibleRows`
  // so scrolling does not rebuild it for every frame. When omitted the map is
  // built locally, keeping the function self-contained for tests/other callers.
  rowById?: Map<string, VisibleTreeRow>
): VisibleTreeRow[] {
  if (!visibleRows?.length) return [];
  if (!rowHeightPx || rowHeightPx <= 0) return [];

  const topVisibleIndex = Math.min(
    visibleRows.length - 1,
    Math.max(0, Math.floor(scrollTop / rowHeightPx) + 1)
  );
  const topVisibleRow = visibleRows[topVisibleIndex];
  if (!topVisibleRow || topVisibleRow.depth <= 1) return [];

  const byId = rowById ?? new Map(visibleRows.map((row) => [row.id, row]));
  const trail: VisibleTreeRow[] = [];
  let cursor: VisibleTreeRow | undefined = topVisibleRow.parentId
    ? byId.get(topVisibleRow.parentId)
    : undefined;
  while (cursor) {
    trail.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return trail;
}

export function buildInheritedDueDateMap(rows: VisibleTreeRow[]): Map<string, string> {
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.node.data["due date"]) continue;
    let cur = row.parentId ? rowMap.get(row.parentId) : undefined;
    while (cur) {
      const d = cur.node.data["due date"];
      if (d) {
        result.set(row.id, d);
        break;
      }
      cur = cur.parentId ? rowMap.get(cur.parentId) : undefined;
    }
  }
  return result;
}

export function getParent(base: string, tree_data: TreeData | undefined): TreeData | undefined {
  // Depth First Search
  let parent_tree: TreeData | undefined;
  if (!tree_data) {
    return undefined;
  }
  if (tree_data.id == base) {
    return undefined;
  }
  for (const child of tree_data.children) {
    if (child.id == base) {
      parent_tree = tree_data;
    } else {
      parent_tree = getParent(base, child);
    }
    if (parent_tree) {
      break;
    }
  }
  return parent_tree;
}

export function isChild(target: string, base: string, tree_data: TreeData): boolean {
  if (target == base) {
    return false;
  }
  const base_tree = getNode(base, tree_data);
  if (!base_tree) {
    return false;
  }
  const target_tree = getNode(target, base_tree);
  if (target_tree) {
    return true;
  } else {
    return false;
  }
}

export function addNode(
  node: TreeData,
  base: string,
  tree_data: TreeData,
  action: "insert" | "insert_after" | "append"
): TreeData {
  // insert or append
  switch (action) {
    case "insert":
    case "insert_after": {
      const base_parent_tree = getParent(base, tree_data);
      if (!base_parent_tree) {
        return tree_data;
      }
      let index = undefined;
      let i = 0;
      for (const child of base_parent_tree.children) {
        if (child.id == base) {
          index = action == "insert" ? i : i + 1;
          break;
        }
        i++;
      }
      if (index === undefined) {
        return tree_data;
      }
      base_parent_tree.children.splice(index, 0, node);
      break;
    }
    case "append": {
      const base_tree = getNode(base, tree_data);
      if (!base_tree) {
        return tree_data;
      }
      base_tree.children.push(node);
      break;
    }
  }
  return tree_data;
}

export function rmNode(target: string, tree_data: TreeData): TreeData {
  const target_parent_tree = getParent(target, tree_data);
  if (!target_parent_tree) {
    return tree_data;
  }
  let index = undefined;
  let i = 0;
  for (const child of target_parent_tree.children) {
    if (child.id == target) {
      index = i;
      break;
    }
    i++;
  }
  if (index === undefined) {
    return tree_data;
  }
  target_parent_tree.children.splice(index, 1);
  return tree_data;
}

export function reorderTree(
  target: string,
  base: string,
  tree_data: TreeData,
  action: "insert" | "insert_after" | "append"
): TreeData {
  const target_tree = getNode(target, tree_data);
  if (!target_tree) {
    return tree_data;
  }
  tree_data = rmNode(target, tree_data);
  tree_data = addNode(target_tree, base, tree_data, action);
  return tree_data;
}

function getSiblingContext(target: string, tree_data: TreeData) {
  const parent = getParent(target, tree_data);
  if (!parent) {
    return undefined;
  }

  const index = parent.children.findIndex((child) => child.id === target);
  if (index < 0) {
    return undefined;
  }

  return { parent, index };
}

export function canMoveNodeUp(target: string, tree_data: TreeData): boolean {
  const context = getSiblingContext(target, tree_data);
  return !!context && context.index > 0;
}

export function canMoveNodeDown(target: string, tree_data: TreeData): boolean {
  const context = getSiblingContext(target, tree_data);
  return !!context && context.index < context.parent.children.length - 1;
}

export function canIndentNode(target: string, tree_data: TreeData): boolean {
  const context = getSiblingContext(target, tree_data);
  return !!context && context.index > 0;
}

export function canOutdentNode(target: string, tree_data: TreeData): boolean {
  const parent = getParent(target, tree_data);
  if (!parent) {
    return false;
  }

  return !!getParent(parent.id, tree_data);
}

export function moveNodeUp(target: string, tree_data: TreeData): TreeData {
  const context = getSiblingContext(target, tree_data);
  if (!context || context.index === 0) {
    return tree_data;
  }

  const { parent, index } = context;
  [parent.children[index - 1], parent.children[index]] = [
    parent.children[index],
    parent.children[index - 1],
  ];

  return tree_data;
}

export function moveNodeDown(target: string, tree_data: TreeData): TreeData {
  const context = getSiblingContext(target, tree_data);
  if (!context || context.index >= context.parent.children.length - 1) {
    return tree_data;
  }

  const { parent, index } = context;
  [parent.children[index], parent.children[index + 1]] = [
    parent.children[index + 1],
    parent.children[index],
  ];

  return tree_data;
}

export function indentNode(target: string, tree_data: TreeData): TreeData {
  const context = getSiblingContext(target, tree_data);
  if (!context || context.index === 0) {
    return tree_data;
  }

  const { parent, index } = context;
  const [node] = parent.children.splice(index, 1);
  const newParent = parent.children[index - 1];
  newParent.children.push(node);

  return tree_data;
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  Open: 0,
  "In Progress": 1,
  Pending: 2,
  Completed: 3,
  Canceled: 4,
};

export function sortTree(
  tree: TreeData | null | undefined,
  sort: SortState | null | undefined
): TreeData | null | undefined {
  if (!tree || !sort) return tree;

  const compare = (a: TreeData, b: TreeData): number => {
    const { column, direction } = sort;
    let result = 0;

    if (column === "status") {
      const aOrder = STATUS_ORDER[a.data.status] ?? 99;
      const bOrder = STATUS_ORDER[b.data.status] ?? 99;
      result = aOrder - bOrder;
    } else if (column === "name") {
      result = (a.data.name ?? "").localeCompare(b.data.name ?? "");
    } else if (column === "start date" || column === "due date") {
      const aVal = (a.data[column] as string | undefined) ?? "";
      const bVal = (b.data[column] as string | undefined) ?? "";
      if (!aVal && !bVal) result = 0;
      else if (!aVal) result = 1;
      else if (!bVal) result = -1;
      else result = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    }

    return direction === "desc" ? -result : result;
  };

  const sortedChildren = [...tree.children]
    .map((child) => sortTree(child, sort) as TreeData)
    .sort(compare);

  return { ...tree, children: sortedChildren };
}

export function outdentNode(target: string, tree_data: TreeData): TreeData {
  const parent = getParent(target, tree_data);
  if (!parent) {
    return tree_data;
  }

  const grandParent = getParent(parent.id, tree_data);
  if (!grandParent) {
    return tree_data;
  }

  const targetIndex = parent.children.findIndex((child) => child.id === target);
  const parentIndex = grandParent.children.findIndex((child) => child.id === parent.id);

  if (targetIndex < 0 || parentIndex < 0) {
    return tree_data;
  }

  const [node] = parent.children.splice(targetIndex, 1);
  grandParent.children.splice(parentIndex + 1, 0, node);

  return tree_data;
}

// --- Bulk operations for multi-select -----------------------------------

export function bulkUpdateNodeData(
  tree_data: TreeData | undefined,
  ids: Set<string>,
  patch: Partial<TreeData["data"]>
): TreeData | undefined {
  if (!tree_data || ids.size === 0) {
    return tree_data;
  }

  const patchKeys = Object.keys(patch);
  if (patchKeys.length === 0) {
    return tree_data;
  }

  function isNoopFor(node: TreeData): boolean {
    for (const key of patchKeys) {
      const newVal = (patch as Record<string, unknown>)[key];
      const curVal = (node.data as Record<string, unknown>)[key];
      // Treat null/undefined uniformly so "clear date" on already-empty fields is a no-op.
      if (newVal == null && curVal == null) continue;
      if (newVal !== curVal) return false;
    }
    return true;
  }

  function visit(node: TreeData): TreeData {
    let nextNode = node;
    if (ids.has(node.id) && !isNoopFor(node)) {
      nextNode = { ...node, data: { ...node.data, ...patch } };
    }

    if (!nextNode.children || nextNode.children.length === 0) {
      return nextNode;
    }

    let childChanged = false;
    const updatedChildren = nextNode.children.map((child) => {
      const next = visit(child);
      if (next !== child) childChanged = true;
      return next;
    });

    if (!childChanged && nextNode === node) {
      return node;
    }
    if (!childChanged) {
      return nextNode;
    }
    return { ...nextNode, children: updatedChildren };
  }

  return visit(tree_data);
}

/**
 * ノードに archived フラグを立てる（論理削除）。
 * - ルートは archived 不可（ルートを archive すると画面に何も出なくなるため）
 * - 既に archived ならそのまま
 * - archivedAt を新たに（または既存値を維持で）セット
 *
 * `permanentlyDeleteNode` で消すまでデータとしては残る。子はフラグを変えない
 * （親が archived なら表示側で連動して非表示になる）。
 */
export function archiveNode(target: string, tree_data: TreeData): TreeData {
  if (target === tree_data.id) {
    // ルートは archive 不可
    return tree_data;
  }
  const parent = getParent(target, tree_data);
  if (!parent) return tree_data;
  for (const child of parent.children) {
    if (child.id === target) {
      if (child.archived) return tree_data;
      child.archived = true;
      child.archivedAt = new Date().toISOString();
      return tree_data;
    }
  }
  return tree_data;
}

/** ノードの archived を解除する。`archivedAt` も消す。 */
export function restoreNode(target: string, tree_data: TreeData): TreeData {
  if (target === tree_data.id) return tree_data;
  const parent = getParent(target, tree_data);
  if (!parent) return tree_data;
  for (const child of parent.children) {
    if (child.id === target) {
      if (!child.archived) return tree_data;
      delete child.archived;
      delete child.archivedAt;
      // 復元時は元の親の末尾へ移動する。元親 ID をエントリに残していない
      // 設計のため、archived 中も子は親の children 配列内にいる前提で、
      // 末尾に詰め直す（同 parent の他の active 兄弟の後ろになるため、
      // archived 表示時の並びと整合する）。
      const index = parent.children.findIndex((c) => c.id === target);
      if (index >= 0 && index !== parent.children.length - 1) {
        const [moved] = parent.children.splice(index, 1);
        parent.children.push(moved);
      }
      return tree_data;
    }
  }
  return tree_data;
}

/** archived フラグを無視して、対象ノードをツリーから物理削除する。 */
export function permanentlyDeleteNode(target: string, tree_data: TreeData): TreeData {
  return rmNode(target, tree_data);
}

/** 複数まとめて archive する。ルートは含まれていても無視。 */
export function bulkArchiveNodes(tree_data: TreeData, ids: Set<string>): TreeData {
  if (ids.size === 0) return tree_data;
  const now = new Date().toISOString();
  function visit(node: TreeData) {
    for (const child of node.children) {
      if (ids.has(child.id) && !child.archived) {
        child.archived = true;
        child.archivedAt = now;
      }
      visit(child);
    }
  }
  visit(tree_data);
  return tree_data;
}

/** 複数まとめて restore する。 */
export function bulkRestoreNodes(tree_data: TreeData, ids: Set<string>): TreeData {
  if (ids.size === 0) return tree_data;
  function visit(node: TreeData) {
    let i = 0;
    while (i < node.children.length) {
      const child = node.children[i];
      if (ids.has(child.id) && child.archived) {
        delete child.archived;
        delete child.archivedAt;
        // 末尾へ移動
        if (i !== node.children.length - 1) {
          const [moved] = node.children.splice(i, 1);
          node.children.push(moved);
          // splice したので index は進めない
          visit(child);
          continue;
        }
      }
      visit(child);
      i++;
    }
  }
  visit(tree_data);
  return tree_data;
}

/**
 * archived フラグの立った子孫をすべて取り除いた新しいツリーを返す。
 * 表示・検索・タグ集計から archived を除外するための前処理として使う。
 * 元のツリーは変更しない（pure）。
 */
export function stripArchivedNodes(node: TreeData): TreeData {
  const children: TreeData[] = [];
  for (const child of node.children ?? []) {
    if (child.archived) continue;
    children.push(stripArchivedNodes(child));
  }
  return { ...node, children };
}

export function bulkRemoveNodes(
  tree_data: TreeData | undefined,
  ids: Set<string>
): TreeData | undefined {
  if (!tree_data || ids.size === 0) {
    return tree_data;
  }
  // Never remove the root.
  if (ids.has(tree_data.id) && ids.size === 1) {
    return tree_data;
  }

  function visit(node: TreeData): TreeData {
    if (!node.children || node.children.length === 0) {
      return node;
    }
    const kept = node.children.filter((c) => !ids.has(c.id));
    const visited = kept.map((c) => visit(c));

    const sameLength = kept.length === node.children.length;
    const sameRefs = sameLength && visited.every((c, i) => c === node.children[i]);
    if (sameRefs) {
      return node;
    }
    return { ...node, children: visited };
  }

  return visit(tree_data);
}

export function areAllSiblings(tree_data: TreeData | undefined, ids: Set<string>): boolean {
  if (!tree_data || ids.size === 0) {
    return false;
  }
  let parentId: string | undefined;
  for (const id of ids) {
    if (id === tree_data.id) return false;
    const parent = getParent(id, tree_data);
    if (!parent) return false;
    if (parentId === undefined) {
      parentId = parent.id;
    } else if (parent.id !== parentId) {
      return false;
    }
  }
  return parentId !== undefined;
}

export function isContiguousSiblingBlock(
  tree_data: TreeData | undefined,
  ids: Set<string>
): boolean {
  if (!areAllSiblings(tree_data, ids)) return false;
  const anyId = ids.values().next().value as string;
  const parent = getParent(anyId, tree_data!);
  if (!parent) return false;
  const indices: number[] = [];
  parent.children.forEach((c, i) => {
    if (ids.has(c.id)) indices.push(i);
  });
  if (indices.length !== ids.size) return false;
  indices.sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false;
  }
  return true;
}

export function getTopLevelSelection(tree_data: TreeData | undefined, ids: Set<string>): string[] {
  if (!tree_data || ids.size === 0) return [];
  const result: string[] = [];
  function visit(node: TreeData) {
    if (ids.has(node.id)) {
      result.push(node.id);
      return; // descendants of a top-level selected node are skipped
    }
    for (const child of node.children) visit(child);
  }
  visit(tree_data);
  return result;
}

export function bulkMoveUp(target_ids: Set<string>, tree_data: TreeData): TreeData {
  if (!isContiguousSiblingBlock(tree_data, target_ids)) return tree_data;
  const anyId = target_ids.values().next().value as string;
  const parent = getParent(anyId, tree_data);
  if (!parent) return tree_data;
  const indices: number[] = [];
  parent.children.forEach((c, i) => {
    if (target_ids.has(c.id)) indices.push(i);
  });
  indices.sort((a, b) => a - b);
  const start = indices[0];
  if (start === 0) return tree_data;
  const block = parent.children.splice(start, indices.length);
  parent.children.splice(start - 1, 0, ...block);
  return tree_data;
}

export function bulkMoveDown(target_ids: Set<string>, tree_data: TreeData): TreeData {
  if (!isContiguousSiblingBlock(tree_data, target_ids)) return tree_data;
  const anyId = target_ids.values().next().value as string;
  const parent = getParent(anyId, tree_data);
  if (!parent) return tree_data;
  const indices: number[] = [];
  parent.children.forEach((c, i) => {
    if (target_ids.has(c.id)) indices.push(i);
  });
  indices.sort((a, b) => a - b);
  const end = indices[indices.length - 1];
  if (end >= parent.children.length - 1) return tree_data;
  const start = indices[0];
  const block = parent.children.splice(start, indices.length);
  parent.children.splice(start + 1, 0, ...block);
  return tree_data;
}

export interface BulkIndentResult {
  tree_data: TreeData;
  new_parent_ids: string[];
}

export function bulkIndent(target_ids: Set<string>, tree_data: TreeData): BulkIndentResult {
  if (!areAllSiblings(tree_data, target_ids)) {
    return { tree_data, new_parent_ids: [] };
  }
  const anyId = target_ids.values().next().value as string;
  const parent = getParent(anyId, tree_data);
  if (!parent) return { tree_data, new_parent_ids: [] };

  const selectedInOrder = parent.children
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => target_ids.has(c.id))
    .sort((a, b) => a.i - b.i);

  const newParentIds: string[] = [];
  for (const { c } of selectedInOrder) {
    const currentIndex = parent.children.findIndex((child) => child.id === c.id);
    if (currentIndex <= 0) continue;
    const predecessor = parent.children[currentIndex - 1];
    parent.children.splice(currentIndex, 1);
    predecessor.children.push(c);
    if (!newParentIds.includes(predecessor.id)) newParentIds.push(predecessor.id);
  }
  return { tree_data, new_parent_ids: newParentIds };
}

export function bulkOutdent(target_ids: Set<string>, tree_data: TreeData): TreeData {
  if (!areAllSiblings(tree_data, target_ids)) return tree_data;
  const anyId = target_ids.values().next().value as string;
  const parent = getParent(anyId, tree_data);
  if (!parent) return tree_data;
  const grandParent = getParent(parent.id, tree_data);
  if (!grandParent) return tree_data;

  const selectedInOrder = parent.children
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => target_ids.has(c.id))
    .sort((a, b) => b.i - a.i); // right-to-left

  for (const { c } of selectedInOrder) {
    const currentIndex = parent.children.findIndex((child) => child.id === c.id);
    if (currentIndex < 0) continue;
    parent.children.splice(currentIndex, 1);
    const parentIndex = grandParent.children.findIndex((child) => child.id === parent.id);
    grandParent.children.splice(parentIndex + 1, 0, c);
  }
  return tree_data;
}

export function bulkAddNodes(
  nodes: TreeData[],
  base: string,
  tree_data: TreeData,
  action: "insert" | "insert_after" | "append"
): TreeData {
  if (nodes.length === 0) return tree_data;
  switch (action) {
    case "insert":
    case "insert_after": {
      const baseParent = getParent(base, tree_data);
      if (!baseParent) return tree_data;
      let index = -1;
      for (let i = 0; i < baseParent.children.length; i++) {
        if (baseParent.children[i].id === base) {
          index = action === "insert" ? i : i + 1;
          break;
        }
      }
      if (index < 0) return tree_data;
      baseParent.children.splice(index, 0, ...nodes);
      break;
    }
    case "append": {
      const baseNode = getNode(base, tree_data);
      if (!baseNode) return tree_data;
      baseNode.children.push(...nodes);
      break;
    }
  }
  return tree_data;
}

export function bulkDuplicate(nodes: TreeData[]): TreeData[] {
  return nodes.map((n) => cloneWithNewIds(n));
}
