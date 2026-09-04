import { uuidV4 } from "@lib/utils/uuid";
import {
  memoContentForSearch,
  type MemoFormat,
  type MemoKind,
} from "@features/memos/utils/memo_utils";
import type { SortState } from "@app-types/app";

export type TaskStatus = "Open" | "Pending" | "In Progress" | "Completed" | "Canceled";

export interface MemoEntry {
  id: string;
  title: string;
  content: unknown;
  tags: string[];
  format?: MemoFormat;
  /** 記録の種別。省略時は作業メモ扱い。詳細は normalizeMemoKind を参照。 */
  kind?: MemoKind;
  order?: number;
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
  /**
   * タスク自身に付けたタグ。メモのタグ (`MemoEntry.tags`) とは別に、タスクを
   * 横断的に分類するために使う。未設定は「タグなし」と同じ扱い。
   */
  tags?: string[];
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
  /**
   * 循環のせいで木に描けなかった親の id。
   *
   * 木は DAG の射影なので、循環がある場合だけ「データにはあるが描かれない辺」
   * が生まれる。保存は木を辿って親を導くため、これを持っておかないとその辺が
   * ファイルから消える。表示には使わない（`workspaceToProjectData` が付け、
   * `projectDataToWorkspaceTasks` が書き戻す）。
   */
  cutParentIds?: string[];
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
  /**
   * ルートからの経路（`親id/子id/…`）。多親ノードは親ごとに複数行として現れる
   * ので、行の同一性はノード id ではなく**辺**＝経路で決まる。Svelte の keyed
   * each の key はこれを使う（id を使うと each_key_duplicate で描画が壊れる）。
   */
  path: string;
  /**
   * この行がそのノードの最初の出現か。DOM の `id` 属性は最初の出現にだけ付ける
   * （重複 id を作らないため）。既存の `getElementById` と E2E セレクタはこれで
   * 従来どおり動く。
   */
  isPrimaryOccurrence: boolean;
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

function fullTextMatches(
  data: TreeNodeData,
  ancestorNames: string[],
  keywords: string[],
  includeMemo: boolean
): boolean {
  const pathText = ancestorNames.filter(Boolean).join(" ");
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
  const text = `${pathText} ${fieldText} ${memoText}`.toLowerCase();
  const tokens = keywords.flatMap((keyword) => tokenizeFullTextQuery(keyword));
  if (tokens.length === 0) return true;
  return tokens.every((token) => text.includes(token.toLowerCase()));
}

export function filterTree(
  tree: TreeData | null | undefined,
  filter: Record<string, string[]> | null | undefined,
  // 祖先ノードの name を根から現在ノードの親までの順で並べたもの。
  // ルート呼び出し（既存の 2 引数呼び出し）では省略され空配列になる。
  // 再帰時のみ [...親の ancestorNames, 親自身の name] を渡して 1 階層ずつ伸ばす
  // ので、深さに比例した長さで止まり、無限に育つことはない。
  ancestorNames: string[] = []
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
      keyMatch = fullTextMatches(
        tree.data,
        ancestorNames,
        keywords,
        (filter["search_memo"]?.length ?? 0) > 0
      );
      fullTextFilterMatch = keyMatch;
    } else if (key === "name") {
      // In case of name filter: match against the node's own name OR any
      // ancestor's name, so e.g. filtering by "tasks" also hits descendants
      // nested under a task named "tasks" (full-path matching).
      keyMatch = keywords.some((keyword) => {
        const kw = keyword.toLowerCase();
        if (tree.data.name && tree.data.name.toLowerCase().includes(kw)) return true;
        return ancestorNames.some((name) => name && name.toLowerCase().includes(kw));
      });
      nameFilterMatch = keyMatch; // Record if name filter matched
    } else if (key === "tags") {
      const tag = keywords[0].toLowerCase();
      // タグはタスク自身にもメモにも付く。どちらで一致しても、そのタスクは
      // そのタグの付いたタスクとして扱う。
      const taskTagMatch = ((tree.data.tags as string[]) ?? []).some(
        (t) => t.toLowerCase() === tag
      );
      keyMatch =
        taskTagMatch ||
        (tree.data.memo ?? []).some((entry) =>
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
  const childAncestorNames = [...ancestorNames, tree.data.name ?? ""];
  const matchedChildren: TreeData[] = [];
  for (const child of tree.children || []) {
    if ((nameFilterMatch || fullTextFilterMatch) && allFiltersMatch) {
      // If name/full-text filter matches and all filters match,
      // include all child nodes (no filtering)
      matchedChildren.push(cloneTreeWithAllChildren(child));
    } else {
      // Otherwise filter recursively, extending the ancestor-name chain by
      // this node's own name so descendants can match on the full path.
      const filteredChild = filterTree(child, filter, childAncestorNames);
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
  patch: Partial<TreeData["data"]>,
  // 多親ノードの複数の出現は同じオブジェクトを共有している（workspace_tree の
  // 射影を参照）。作り直すときに出現ごとに別オブジェクトを作ると共有が壊れ、
  // 以後の編集が片方の出現にしか効かなくなる。同じ入力には同じ出力を返す。
  rebuilt: Map<TreeData, TreeData> = new Map()
): TreeData | undefined {
  if (!tree_data) {
    return tree_data;
  }

  const already = rebuilt.get(tree_data);
  if (already) {
    return already;
  }

  if (tree_data.id === targetId) {
    const next = {
      ...tree_data,
      data: {
        ...tree_data.data,
        ...patch,
      },
    };
    rebuilt.set(tree_data, next);
    return next;
  }

  if (!tree_data.children || tree_data.children.length === 0) {
    return tree_data;
  }

  let hasChanged = false;
  const updatedChildren = tree_data.children.map((child) => {
    const nextChild = updateNodeDataById(child, targetId, patch, rebuilt) ?? child;
    if (nextChild !== child) {
      hasChanged = true;
    }
    return nextChild;
  });

  if (!hasChanged) {
    return tree_data;
  }

  const next = {
    ...tree_data,
    children: updatedChildren,
  };
  rebuilt.set(tree_data, next);
  return next;
}

export function flattenVisibleTree(
  tree_data: TreeData | undefined,
  /** 折り畳まれている**経路**の集合（ノード id ではない。`VisibleTreeRow.path` と同じ形式）。 */
  closedPaths: Set<string> = new Set(),
  includeArchived: boolean = false
): VisibleTreeRow[] {
  if (!tree_data) {
    return [];
  }

  const rows: VisibleTreeRow[] = [];
  const seenNodeIds = new Set<string>();

  const visit = (
    node: TreeData,
    depth: number,
    parentId: string | undefined,
    siblingIndex: number,
    siblingCount: number,
    insideArchived: boolean,
    parentPath: string,
    /** 直前の兄弟の id。インデント可否の判定に使う。 */
    previousSiblingId: string | undefined,
    // いま辿っている経路の祖先。編集の結果ツリーに循環ができても、
    // ここで打ち切って画面が落ちないようにする（防御。作らせない方は
    // canIndentNode / canDropTarget 側で止める）。
    ancestors: ReadonlySet<string>
  ) => {
    const isArchived = !!node.archived;
    const effectivelyArchived = insideArchived || isArchived;
    if (effectivelyArchived && !includeArchived) {
      // includeArchived=false の通常表示モードでは archived 配下を丸ごとスキップ。
      return;
    }
    const hasChildren = !!(node.children && node.children.length > 0);
    const path = parentPath ? `${parentPath}/${node.id}` : node.id;
    // 子を持たないノードは誰の祖先にもならないので、その場合は調べない。
    const previousSiblingIsDescendant =
      hasChildren && siblingIndex > 0 && previousSiblingId
        ? subtreeContains(node, previousSiblingId)
        : false;
    // 開閉は**辺ごと**に持つ。多親ノードは親ごとに別の行なので、片方の親の下で
    // 畳んでも、もう片方の親の下では開いたままでなければならない。
    const expanded = !closedPaths.has(path);
    const isPrimaryOccurrence = !seenNodeIds.has(node.id);
    seenNodeIds.add(node.id);

    rows.push({
      id: node.id,
      path,
      isPrimaryOccurrence,
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
      // 直前の兄弟が自分の子孫なら、そこへ入れると循環する（多親でのみ起こる）。
      // ボタンを押せてしまうと、押しても何も起きない行ができる。
      canIndent: siblingIndex > 0 && !previousSiblingIsDescendant,
      canOutdent: depth > 1,
    });

    if (!hasChildren || !expanded) {
      return;
    }

    const pathAncestors = new Set(ancestors).add(node.id);
    const childCount = node.children.length;
    node.children.forEach((child, index) => {
      if (pathAncestors.has(child.id)) return;
      visit(
        child,
        depth + 1,
        node.id,
        index,
        childCount,
        effectivelyArchived,
        path,
        node.children[index - 1]?.id,
        pathAncestors
      );
    });
  };

  visit(tree_data, 0, undefined, 0, 1, false, "", undefined, new Set<string>());

  return rows;
}

/** その部分木に指定 id のノードが居るか。見つかり次第打ち切る。 */
function subtreeContains(node: TreeData, targetId: string): boolean {
  const visited = new Set<string>();
  const walk = (current: TreeData): boolean => {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    for (const child of current.children ?? []) {
      if (child.id === targetId) return true;
      if (walk(child)) return true;
    }
    return false;
  };
  return walk(node);
}

type TreePathEntry = {
  node: TreeData;
  parent?: TreeData;
};

function findPathToNode(
  target: string,
  tree_data: TreeData | undefined
): TreePathEntry[] | undefined {
  if (!tree_data) return undefined;
  const path: TreePathEntry[] = [];

  function visit(node: TreeData, parent?: TreeData): boolean {
    path.push({ node, parent });
    if (node.id === target) return true;

    for (const child of node.children) {
      if (visit(child, node)) return true;
    }

    path.pop();
    return false;
  }

  return visit(tree_data) ? path : undefined;
}

/**
 * そのノードが「アーカイブされた扱い」か。自分が archived か、ルートから
 * archived を通らずに辿り着けない場合に true。
 *
 * 多親なので、最初に見つかった経路で決めてはいけない。片方の親がアーカイブ
 * されていても、もう片方から生きて辿れるならそのノードは生きている
 * （画面でも、その行は編集できる状態で出ている）。
 */
export function isNodeEffectivelyArchived(
  target: string | undefined,
  tree_data: TreeData | undefined
): boolean {
  if (!target || !tree_data) return false;
  // ツリーに無いものは判定できない（従来どおり false）。
  if (!getNode(target, tree_data)) return false;

  const visited = new Set<string>();
  const reachableAlive = (node: TreeData): boolean => {
    if (node.archived) return false;
    if (node.id === target) return true;
    if (visited.has(node.id)) return false;
    visited.add(node.id);
    return (node.children ?? []).some(reachableAlive);
  };

  return !reachableAlive(tree_data);
}

// 各行に対し、ルートから現在ノードまでの名前パス ("root / a / b / current") を返す。
// 行は flattenVisibleTree の DFS 順 (親が子より先) なので、親のパスを引いて連結するだけで O(N)。
//
// 多親ノードは親ごとに別の行なので、名前パスも行ごとに違う。したがってキーは
// ノード id ではなく**経路**（`VisibleTreeRow.path`）。
export function buildNodePathMap(rows: VisibleTreeRow[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    const name = row.node.data["name"] ?? "";
    const parentPath = result.get(parentPathOf(row.path));
    result.set(row.path, parentPath ? `${parentPath} / ${name}` : name);
  }
  return result;
}

// ツリー全体を DFS して各ノードに 1 始まりの通し番号を割り当てる。
// flattenVisibleTree と違い折り畳み状態を無視するので、ノードを開閉しても番号は動かない。
/**
 * 行番号は**経路**で引く。多親ノードは親ごとに複数行に出るので、ノード id で
 * 引くと同じ番号が 2 行に出て、番号が飛ぶ（行＝辺なので、番号も辺に振る）。
 */
export function buildLineNumberMap(tree: TreeData | null | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (!tree) return result;

  let counter = 0;
  const visit = (node: TreeData, parentPath: string, ancestors: ReadonlySet<string>) => {
    const path = parentPath ? `${parentPath}/${node.id}` : node.id;
    counter += 1;
    result.set(path, counter);
    const pathAncestors = new Set(ancestors).add(node.id);
    for (const child of node.children ?? []) {
      // 循環は打ち切る（flattenVisibleTree と同じ規則にして行がずれないように）。
      if (pathAncestors.has(child.id)) continue;
      visit(child, path, pathAncestors);
    }
  };
  visit(tree, "", new Set<string>());
  return result;
}

/**
 * ツリー中のすべての経路（`親id/子id/…`）を列挙する。「すべて折りたたむ」が
 * 全行を畳むために使う。折り畳み状態は見ずにツリー全体を辿る。
 */
export function collectTreePaths(tree: TreeData | undefined, parentPath: string = ""): string[] {
  if (!tree) return [];
  const path = parentPath ? `${parentPath}/${tree.id}` : tree.id;
  const paths = [path];
  for (const child of tree.children ?? []) {
    paths.push(...collectTreePaths(child, path));
  }
  return paths;
}

/** 経路が指定ノードを通るか。ノードを消したときの後始末に使う。 */
export function pathIncludesNode(path: string, nodeId: string): boolean {
  return path.split("/").includes(nodeId);
}

/** 経路の終端ノード id（＝その行が指すノード）。 */
export function pathLeafId(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

/** 経路の親側（`a/b/c` → `a/b`）。ルート行では空文字。 */
export function parentPathOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
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
  // Optional precomputed 経路→row map. Callers that recompute the trail on every
  // scroll event (TreeTable) should pass a map memoized against `visibleRows`
  // so scrolling does not rebuild it for every frame. When omitted the map is
  // built locally, keeping the function self-contained for tests/other callers.
  //
  // 多親ノードは複数の行に出るので、祖先を辿るキーは経路でなければならない。
  // ノード id で辿ると、別の親の下の祖先列が混ざる。
  rowByPath?: Map<string, VisibleTreeRow>
): VisibleTreeRow[] {
  if (!visibleRows?.length) return [];
  if (!rowHeightPx || rowHeightPx <= 0) return [];

  const topVisibleIndex = Math.min(
    visibleRows.length - 1,
    Math.max(0, Math.floor(scrollTop / rowHeightPx) + 1)
  );
  const topVisibleRow = visibleRows[topVisibleIndex];
  if (!topVisibleRow || topVisibleRow.depth <= 1) return [];

  const byPath = rowByPath ?? new Map(visibleRows.map((row) => [row.path, row]));
  const trail: VisibleTreeRow[] = [];
  let cursor: VisibleTreeRow | undefined = byPath.get(parentPathOf(topVisibleRow.path));
  while (cursor) {
    trail.unshift(cursor);
    cursor = byPath.get(parentPathOf(cursor.path));
  }
  return trail;
}

/**
 * 期限を持たない行が、祖先から引き継ぐ期限。多親ノードは親ごとに祖先が違うので、
 * 引き継ぐ期限も行ごとに違う。キーも辿りも**経路**で行う。
 */
export function buildInheritedDueDateMap(rows: VisibleTreeRow[]): Map<string, string> {
  const rowMap = new Map(rows.map((r) => [r.path, r]));
  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.node.data["due date"]) continue;
    let cur = rowMap.get(parentPathOf(row.path));
    while (cur) {
      const d = cur.node.data["due date"];
      if (d) {
        result.set(row.path, d);
        break;
      }
      cur = rowMap.get(parentPathOf(cur.path));
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
  action: "insert" | "insert_after" | "append",
  // 落とし先の行の経路。多親ノードは同じ id の行が複数あるので、
  // 「どの行の隣か／どの行の下か」は経路でしか決まらない。
  basePath?: string
): TreeData {
  // insert or append
  switch (action) {
    case "insert":
    case "insert_after": {
      const base_parent_tree = resolveRowParent(base, tree_data, basePath);
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
      // 辺は集合。すでに同じ親の子なら二重に足さない（多親ノードを、すでに
      // 親であるノードの下へ動かしたときに起こる。行の経路が衝突して壊れる）。
      if (base_parent_tree.children.some((child) => child.id === node.id)) {
        return tree_data;
      }
      base_parent_tree.children.splice(index, 0, node);
      break;
    }
    case "append": {
      const base_tree = getNodeByPath(tree_data, basePath) ?? getNode(base, tree_data);
      if (!base_tree) {
        return tree_data;
      }
      if (base_tree.children.some((child) => child.id === node.id)) {
        return tree_data;
      }
      base_tree.children.push(node);
      break;
    }
  }
  return tree_data;
}

export function rmNode(target: string, tree_data: TreeData, rowPath?: string): TreeData {
  const target_parent_tree = resolveRowParent(target, tree_data, rowPath);
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
  action: "insert" | "insert_after" | "append",
  // 掴んだ行と落とした行の経路。多親ノードは「どの辺を掴んで、どの辺の隣に
  // 置いたか」で結果が変わるので、経路が分かるなら必ず渡す。
  paths: { targetPath?: string; basePath?: string } = {}
): TreeData {
  const target_tree = getNodeByPath(tree_data, paths.targetPath) ?? getNode(target, tree_data);
  if (!target_tree) {
    return tree_data;
  }
  tree_data = rmNode(target, tree_data, paths.targetPath);
  tree_data = addNode(target_tree, base, tree_data, action, paths.basePath);
  return tree_data;
}

/**
 * 経路（`ルートid/親id/子id`）でノードを引く。多親ノードはノード id では
 * 一意に決まらないので、「どの行か」を要求する操作はこちらで引く。
 */
export function getNodeByPath(
  tree_data: TreeData | undefined,
  path: string | undefined
): TreeData | undefined {
  if (!tree_data || !path) return undefined;
  const segments = path.split("/");
  if (segments[0] !== tree_data.id) return undefined;
  let node: TreeData = tree_data;
  for (const id of segments.slice(1)) {
    const next = node.children?.find((child) => child.id === id);
    if (!next) return undefined;
    node = next;
  }
  return node;
}

/**
 * 移動・インデントは「どの辺を動かすか」の操作なので、多親ノードでは
 * **クリックした行の親**を使わなければならない。`rowPath` を渡さない
 * 呼び出し（テストや、行が分からない経路）は従来どおり最初の親を使う。
 */
function resolveRowParent(
  target: string,
  tree_data: TreeData,
  rowPath?: string
): TreeData | undefined {
  const byPath = rowPath ? getNodeByPath(tree_data, parentPathOf(rowPath)) : undefined;
  if (byPath?.children?.some((child) => child.id === target)) return byPath;
  return getParent(target, tree_data);
}

function getSiblingContext(target: string, tree_data: TreeData, rowPath?: string) {
  const parent = resolveRowParent(target, tree_data, rowPath);
  if (!parent) {
    return undefined;
  }

  const index = parent.children.findIndex((child) => child.id === target);
  if (index < 0) {
    return undefined;
  }

  return { parent, index };
}

export function canMoveNodeUp(target: string, tree_data: TreeData, rowPath?: string): boolean {
  const context = getSiblingContext(target, tree_data, rowPath);
  return !!context && context.index > 0;
}

export function canMoveNodeDown(target: string, tree_data: TreeData, rowPath?: string): boolean {
  const context = getSiblingContext(target, tree_data, rowPath);
  return !!context && context.index < context.parent.children.length - 1;
}

export function canIndentNode(target: string, tree_data: TreeData, rowPath?: string): boolean {
  const context = getSiblingContext(target, tree_data, rowPath);
  if (!context || context.index === 0) return false;
  // 直前の兄弟が自分の子孫なら、その下に入ると自分の祖先になってしまう
  // （＝循環）。D&D は同じ判定で止めている。
  const newParent = context.parent.children[context.index - 1];
  return !!newParent && !isChild(newParent.id, target, tree_data);
}

export function canOutdentNode(target: string, tree_data: TreeData, rowPath?: string): boolean {
  const parent = resolveRowParent(target, tree_data, rowPath);
  if (!parent) {
    return false;
  }

  return !!resolveRowParent(parent.id, tree_data, parentPathOf(rowPath ?? ""));
}

export function moveNodeUp(target: string, tree_data: TreeData, rowPath?: string): TreeData {
  const context = getSiblingContext(target, tree_data, rowPath);
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

export function moveNodeDown(target: string, tree_data: TreeData, rowPath?: string): TreeData {
  const context = getSiblingContext(target, tree_data, rowPath);
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

export function indentNode(target: string, tree_data: TreeData, rowPath?: string): TreeData {
  const context = getSiblingContext(target, tree_data, rowPath);
  if (!context || context.index === 0) {
    return tree_data;
  }

  const { parent, index } = context;
  const newParent = parent.children[index - 1];
  // 循環を作らない。多親では「直前の兄弟が自分の子孫」が起こりうる。
  if (!newParent || isChild(newParent.id, target, tree_data)) {
    return tree_data;
  }

  const [node] = parent.children.splice(index, 1);
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

export function outdentNode(target: string, tree_data: TreeData, rowPath?: string): TreeData {
  const parentPath = parentPathOf(rowPath ?? "");
  const parent = resolveRowParent(target, tree_data, rowPath);
  if (!parent) {
    return tree_data;
  }

  const grandParent = resolveRowParent(parent.id, tree_data, parentPath);
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

  // 多親ノードの出現はオブジェクトを共有しているので、作り直しても
  // 同じ入力には同じ出力を返す（共有を壊さない）。
  const rebuilt = new Map<TreeData, TreeData>();

  function visit(node: TreeData): TreeData {
    const already = rebuilt.get(node);
    if (already) return already;

    let nextNode = node;
    if (ids.has(node.id) && !isNoopFor(node)) {
      nextNode = { ...node, data: { ...node.data, ...patch } };
    }

    if (!nextNode.children || nextNode.children.length === 0) {
      if (nextNode !== node) rebuilt.set(node, nextNode);
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
    const result = childChanged ? { ...nextNode, children: updatedChildren } : nextNode;
    rebuilt.set(node, result);
    return result;
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

/**
 * 経路（`ルートid/親id/子id`）を `TreePathEntry[]` に開く。多親ノードは
 * 「どの行から復元したか」で解除すべき祖先が変わるので、経路が分かるなら使う。
 */
function pathEntriesFor(tree_data: TreeData, rowPath?: string): TreePathEntry[] | undefined {
  if (!rowPath) return undefined;
  const segments = rowPath.split("/");
  if (segments[0] !== tree_data.id) return undefined;
  const entries: TreePathEntry[] = [{ node: tree_data }];
  let node = tree_data;
  for (const id of segments.slice(1)) {
    const next = node.children?.find((child) => child.id === id);
    if (!next) return undefined;
    entries.push({ node: next, parent: node });
    node = next;
  }
  return entries;
}

/**
 * ノードの archived を解除する。`archivedAt` も消す。
 * 経路を渡すと、その行の祖先だけを解除する（多親ノードで、たまたま最初に
 * 見つかった別の親側を解除してしまうのを防ぐ）。
 */
export function restoreNode(target: string, tree_data: TreeData, rowPath?: string): TreeData {
  if (target === tree_data.id) return tree_data;
  const path =
    pathEntriesFor(tree_data, rowPath)?.at(-1)?.node.id === target
      ? pathEntriesFor(tree_data, rowPath)
      : findPathToNode(target, tree_data);
  if (!path) return tree_data;

  for (const { node, parent } of path) {
    if (!parent || !node.archived) continue;
    delete node.archived;
    delete node.archivedAt;
    // 復元時は元の親の末尾へ移動する。元親 ID をエントリに残していない
    // 設計のため、archived 中も子は親の children 配列内にいる前提で、
    // 末尾に詰め直す（同 parent の他の active 兄弟の後ろになるため、
    // archived 表示時の並びと整合する）。
    const index = parent.children.findIndex((c) => c.id === node.id);
    if (index >= 0 && index !== parent.children.length - 1) {
      const [moved] = parent.children.splice(index, 1);
      parent.children.push(moved);
    }
  }

  return tree_data;
}

/**
 * 復元のために解除すべき祖先。多親ノードは経路が複数あるので、**解除する数が
 * 最小の経路**を選ぶ（最初に見つかった経路を使うと、見てもいない別の親の側が
 * 巻き添えで解除される）。
 */
function getRestoreNodeIds(target: string, tree_data: TreeData): Set<string> {
  let best: Set<string> | undefined;

  const walk = (node: TreeData, archivedOnPath: string[], ancestors: ReadonlySet<string>) => {
    if (ancestors.has(node.id)) return;
    const isRoot = node.id === tree_data.id;
    const nextArchived = !isRoot && node.archived ? [...archivedOnPath, node.id] : archivedOnPath;
    if (node.id === target) {
      if (!best || nextArchived.length < best.size) best = new Set(nextArchived);
      return;
    }
    const nextAncestors = new Set(ancestors).add(node.id);
    for (const child of node.children ?? []) {
      // 既に「解除ゼロ」の経路が見つかっていれば、それ以上は探さない。
      if (best && best.size === 0) return;
      walk(child, nextArchived, nextAncestors);
    }
  };
  walk(tree_data, [], new Set<string>());

  return best ?? new Set<string>();
}

/** archived フラグを無視して、対象ノードをツリーから物理削除する。 */
export function permanentlyDeleteNode(target: string, tree_data: TreeData): TreeData {
  return rmNode(target, tree_data);
}

/**
 * 削除で最後の親を失ったノードをルート直下に付け直す。
 *
 * ノードは親を複数持てるので、削除は「辺を 1 本切る」操作でしかない。
 * 切った先がそのノードの唯一の親だった場合、中身はそのままなのにルートから
 * 辿れなくなる（＝孤児）。保存はツリーを辿って書き出すため、孤児はファイルごと
 * 消える。孤児を作らない（どのノードも必ず 1 つ以上の親を持つ）ために、
 * 孤児が生まれる瞬間＝削除の直後に拾ってルート直下へ付け直す。
 *
 * 消したノード自身は拾わない。まとめて消したノード同士も拾わない
 * （どちらも「消す」と言われたもの）。
 *
 * @param tree 削除後のツリー（ルート）
 * @param removed 削除したノード。削除**前**に `getNode` などで掴んでおく
 * @returns 付け直したノードの id
 */
export function reattachOrphans(tree: TreeData, removed: TreeData[]): string[] {
  if (!tree || removed.length === 0) return [];

  const reachable = new Set<string>();
  const mark = (node: TreeData) => {
    if (reachable.has(node.id)) return;
    reachable.add(node.id);
    for (const child of node.children ?? []) mark(child);
  };
  mark(tree);

  const removedIds = new Set(removed.map((node) => node.id));
  const reattached: string[] = [];

  for (const node of removed) {
    // まだ他の親から辿れるなら、切れたのは辺 1 本だけ。子も当然辿れる。
    if (reachable.has(node.id)) continue;
    for (const child of node.children ?? []) {
      if (reachable.has(child.id) || removedIds.has(child.id)) continue;
      tree.children.push(child);
      reattached.push(child.id);
      // 付け直した時点で、その子孫もルートから辿れるようになる。
      mark(child);
    }
  }

  return reattached;
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
  const restoreIds = new Set<string>();

  for (const id of ids) {
    for (const restoreId of getRestoreNodeIds(id, tree_data)) {
      restoreIds.add(restoreId);
    }
  }

  if (restoreIds.size === 0) return tree_data;

  function visit(node: TreeData) {
    let i = 0;
    while (i < node.children.length) {
      const child = node.children[i];
      if (restoreIds.has(child.id) && child.archived) {
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

  // 多親ノードの出現はオブジェクトを共有しているので、作り直しても
  // 同じ入力には同じ出力を返す（共有を壊さない）。
  const rebuilt = new Map<TreeData, TreeData>();

  function visit(node: TreeData): TreeData {
    const already = rebuilt.get(node);
    if (already) return already;

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
    const result = { ...node, children: visited };
    rebuilt.set(node, result);
    return result;
  }

  return visit(tree_data);
}

/**
 * 一括操作の基準となる親。選択はノード単位なので、多親ノードが混ざると
 * 「どの親の下でまとめて動かすのか」が決まらない。いま操作している行の経路
 * （`parentPath`）が分かるなら、その親を基準にする。
 */
function resolveBulkParent(
  tree_data: TreeData,
  ids: Set<string>,
  parentPath?: string
): TreeData | undefined {
  const byPath = getNodeByPath(tree_data, parentPath);
  if (byPath && [...ids].every((id) => byPath.children.some((child) => child.id === id))) {
    return byPath;
  }
  const anyId = ids.values().next().value as string;
  return getParent(anyId, tree_data);
}

export function areAllSiblings(
  tree_data: TreeData | undefined,
  ids: Set<string>,
  parentPath?: string
): boolean {
  if (!tree_data || ids.size === 0) {
    return false;
  }
  const reference = resolveBulkParent(tree_data, ids, parentPath);
  if (!reference) return false;
  for (const id of ids) {
    if (id === tree_data.id) return false;
    if (!reference.children.some((child) => child.id === id)) return false;
  }
  return true;
}

export function isContiguousSiblingBlock(
  tree_data: TreeData | undefined,
  ids: Set<string>,
  parentPath?: string
): boolean {
  if (!areAllSiblings(tree_data, ids, parentPath)) return false;
  const parent = resolveBulkParent(tree_data!, ids, parentPath);
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

/**
 * 選択のうち「他の選択ノードの子孫ではないもの」を返す。
 *
 * 多親ノードは複数の経路に現れるので、同じ id を 2 回返してはいけない。
 * 返り値は D&D で `getNode` してから挿入に使われるため、重複すると同じ
 * ノードが兄弟として 2 回入り、行の経路が衝突して描画が壊れる。
 * 共有された部分木を何度も降りないよう、訪問済みも覚える。
 */
export function getTopLevelSelection(tree_data: TreeData | undefined, ids: Set<string>): string[] {
  if (!tree_data || ids.size === 0) return [];
  const result: string[] = [];
  const picked = new Set<string>();
  const visited = new Set<string>();
  function visit(node: TreeData) {
    if (ids.has(node.id)) {
      if (!picked.has(node.id)) {
        picked.add(node.id);
        result.push(node.id);
      }
      return; // descendants of a top-level selected node are skipped
    }
    if (visited.has(node.id)) return;
    visited.add(node.id);
    for (const child of node.children) visit(child);
  }
  visit(tree_data);
  return result;
}

export function bulkMoveUp(
  target_ids: Set<string>,
  tree_data: TreeData,
  parentPath?: string
): TreeData {
  if (!isContiguousSiblingBlock(tree_data, target_ids, parentPath)) return tree_data;
  const parent = resolveBulkParent(tree_data, target_ids, parentPath);
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

export function bulkMoveDown(
  target_ids: Set<string>,
  tree_data: TreeData,
  parentPath?: string
): TreeData {
  if (!isContiguousSiblingBlock(tree_data, target_ids, parentPath)) return tree_data;
  const parent = resolveBulkParent(tree_data, target_ids, parentPath);
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

export function bulkIndent(
  target_ids: Set<string>,
  tree_data: TreeData,
  parentPath?: string
): BulkIndentResult {
  if (!areAllSiblings(tree_data, target_ids, parentPath)) {
    return { tree_data, new_parent_ids: [] };
  }
  const parent = resolveBulkParent(tree_data, target_ids, parentPath);
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
    // 循環を作らない（単体のインデントと同じ規則）。
    if (isChild(predecessor.id, c.id, tree_data)) continue;
    parent.children.splice(currentIndex, 1);
    predecessor.children.push(c);
    if (!newParentIds.includes(predecessor.id)) newParentIds.push(predecessor.id);
  }
  return { tree_data, new_parent_ids: newParentIds };
}

export function bulkOutdent(
  target_ids: Set<string>,
  tree_data: TreeData,
  parentPath?: string
): TreeData {
  if (!areAllSiblings(tree_data, target_ids, parentPath)) return tree_data;
  const parent = resolveBulkParent(tree_data, target_ids, parentPath);
  if (!parent) return tree_data;
  const grandParent =
    getNodeByPath(tree_data, parentPathOf(parentPath ?? "")) ?? getParent(parent.id, tree_data);
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
  action: "insert" | "insert_after" | "append",
  /** 落とし先の行の経路。多親ノードでは id だけでは行が決まらない。 */
  basePath?: string
): TreeData {
  if (nodes.length === 0) return tree_data;
  switch (action) {
    case "insert":
    case "insert_after": {
      const baseParent = resolveRowParent(base, tree_data, basePath);
      if (!baseParent) return tree_data;
      let index = -1;
      for (let i = 0; i < baseParent.children.length; i++) {
        if (baseParent.children[i].id === base) {
          index = action === "insert" ? i : i + 1;
          break;
        }
      }
      if (index < 0) return tree_data;
      // 辺は集合。すでに同じ親の子になっているものは足さない。
      const insertable = nodes.filter(
        (node) => !baseParent.children.some((child) => child.id === node.id)
      );
      baseParent.children.splice(index, 0, ...insertable);
      break;
    }
    case "append": {
      const baseNode = getNodeByPath(tree_data, basePath) ?? getNode(base, tree_data);
      if (!baseNode) return tree_data;
      baseNode.children.push(
        ...nodes.filter((node) => !baseNode.children.some((child) => child.id === node.id))
      );
      break;
    }
  }
  return tree_data;
}

export function bulkDuplicate(nodes: TreeData[]): TreeData[] {
  return nodes.map((n) => cloneWithNewIds(n));
}
