import { memoContentForSearch, type MemoFormat } from "@features/memos/utils/memo_utils";
import type { SortState } from "@app-types/app";

export type TaskStatus = "Open" | "Pending" | "In Progress" | "Completed" | "Canceled";

/**
 * 「ステータス無し」を表す値。
 *
 * メモがノードになったので、ノードには「期限やステータスで追跡するもの」と
 * 「ただ書いてあるもの」の両方が実在する。後者に既定のステータスを与えると、
 * ノート 1 つ 1 つが「未着手のノード」として積み上がり、ステータス列と
 * 絞り込みが意味を失う。だから「無し」は既定値ではなく**状態のひとつ**。
 *
 * 空文字を使うのは、ステータスが選択コントロールの値として往復するため。
 * ファイル上は `status:` キーを書かないことで表す（[data.md](../../../docs/data.md) § 4）。
 */
export const NO_STATUS = "";
export type NodeStatus = TaskStatus | typeof NO_STATUS;

export interface TaskAttachmentEntry {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedAt?: string;
}

export interface TreeNodeData {
  name: string;
  /** ステータス。`NO_STATUS`（空）は「追跡しないノード」を表す状態のひとつ。 */
  status: NodeStatus;
  "start date": `${string}-${string}-${string}` | undefined;
  "due date": `${string}-${string}-${string}` | undefined;
  /**
   * ノード本文。「1 つのメモ ＝ 1 つのノード」なので 1 つだけ持つ。
   * 複数の記録はタブではなく子ノードで表す。
   */
  body?: unknown;
  /** 本文の形式。 */
  format?: MemoFormat;
  /** 本文を読み込み済みか。 */
  bodyLoaded?: boolean;
  /**
   * ノードに付けたタグ。未設定は「タグなし」と同じ扱い。旧メモのタグは
   * 取り込みのときにそのノードのタグとして引き継ぐ。
   */
  tags?: string[];
  attachments?: TaskAttachmentEntry[];
  [key: string]: unknown;
}

export interface TreeData {
  /** Terminal occurrence of a graph cycle. */
  cycleReference?: boolean;
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
  /**
   * ツリーのガイド線。祖先の段ごとに「この行より下にその祖先の兄弟がまだ
   * 続くか」を持つ（`length === depth - 1`、深さ 0 と 1 の行では空）。false の
   * 段は線を引かない＝末っ子の下で線が伸びっぱなしにならない。
   */
  guideLines: boolean[];
  /** 表示上の末っ子か。末っ子の縦線は行の中央で閉じる（└ の形）。 */
  isLastSibling: boolean;
}

const FILTER_FLAG_KEYS = new Set(["search_memo"]);

/**
 * 件数で絞り込む列。値は `[最小, 最大]` の 2 要素で、空欄はその側の制限なし。
 *
 * 件数バッジを出す列は件数で絞り込めるべきなので、ここに集約する。以前は
 * 「メモ数」だけが絞り込めて、隣の「添付数」は同じ件数列なのに絞り込めない
 * という非対称があった。
 */
const COUNT_FILTER_KEYS = new Set(["attachments"]);

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
  includeBody: boolean
): boolean {
  const pathText = ancestorNames.filter(Boolean).join(" ");
  // 本文は別枠で扱う（本文まで探すかは絞り込みの切り替えで決まる）。メモは
  // ノードになったので、ここで見る `memo` は残っていない。
  const fieldText = Object.entries(data)
    .filter(([key]) => key !== "memo" && key !== "body")
    .map(([, value]) => valueForFullText(value))
    .join(" ");
  const bodyText = includeBody ? memoContentForSearch(data.body) : "";
  const text = `${pathText} ${fieldText} ${bodyText}`.toLowerCase();
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
      const tags = ((tree.data.tags as string[]) ?? []).map((tag) => tag.toLowerCase());
      keyMatch = keywords.some((tag) =>
        tag === "" ? tags.length === 0 : tags.includes(tag.toLowerCase())
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
    } else if (COUNT_FILTER_KEYS.has(key)) {
      // 件数列の範囲絞り込み。空欄はその側の上限／下限なしを意味する。
      const minStr = keywords[0] ?? "";
      const maxStr = keywords[1] ?? "";
      const value = tree.data[key];
      const count = Array.isArray(value) ? value.length : Number(value) || 0;
      const minNum = minStr !== "" ? parseInt(minStr, 10) : null;
      const maxNum = maxStr !== "" ? parseInt(maxStr, 10) : null;
      keyMatch = (minNum === null || count >= minNum) && (maxNum === null || count <= maxNum);
    } else if (key === "status") {
      // 「なし」は空文字で表す状態のひとつなので、部分一致では絞れない
      // （あらゆる文字列が "" を含むので、全行に当たってしまう）。
      // ステータスは値の集合が閉じているため完全一致で見る。
      const nodeStatus = ((tree.data.status as string) || NO_STATUS).toLowerCase();
      keyMatch = keywords.some((keyword) => keyword.toLowerCase() === nodeStatus);
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
    /** 祖先の段ごとの「まだ兄弟が続くか」。`guideLines` にそのまま入る。 */
    guideLines: boolean[],
    /** この行の下に、実際に描画される兄弟がまだあるか。 */
    hasNextRenderedSibling: boolean,
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
      guideLines,
      isLastSibling: !hasNextRenderedSibling,
    });

    if (!hasChildren || !expanded) {
      return;
    }

    const pathAncestors = new Set(ancestors).add(node.id);
    const childCount = node.children.length;
    // 実際に行になる子だけを見て「次の兄弟が居るか」を決める。循環で打ち切る
    // 子やアーカイブで隠す子を数えると、末っ子の下に線が残ってしまう。
    const willRender = node.children.map(
      (child) =>
        !(pathAncestors.has(child.id) && !child.cycleReference) &&
        !((effectivelyArchived || !!child.archived) && !includeArchived)
    );
    // ルート行は兄弟を持たない単独の行なので、その段のガイドは引かない。
    const childGuideLines = depth === 0 ? [] : [...guideLines, hasNextRenderedSibling];
    node.children.forEach((child, index) => {
      if (!willRender[index]) return;
      visit(
        child,
        depth + 1,
        node.id,
        index,
        childCount,
        effectivelyArchived,
        path,
        node.children[index - 1]?.id,
        childGuideLines,
        willRender.slice(index + 1).some(Boolean),
        pathAncestors
      );
    });
  };

  visit(tree_data, 0, undefined, 0, 1, false, "", undefined, [], false, new Set<string>());

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
      if (pathAncestors.has(child.id) && !child.cycleReference) continue;
      visit(child, path, pathAncestors);
    }
  };
  visit(tree, "", new Set<string>());
  return result;
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

export function canIndentNode(target: string, tree_data: TreeData, rowPath?: string): boolean {
  const context = getSiblingContext(target, tree_data, rowPath);
  if (!context || context.index === 0) return false;
  // 直前の兄弟が自分の子孫なら、その下に入ると自分の祖先になってしまう
  // （＝循環）。D&D は同じ判定で止めている。
  const newParent = context.parent.children[context.index - 1];
  return !!newParent && !isChild(newParent.id, target, tree_data);
}

// ステータス無しのノードは最後に置く。並べ替えは「進み具合を見る」ための
// 操作なので、進み具合を持たないものを間に挟むと列が読みにくくなる。
const STATUS_ORDER: Record<NodeStatus, number> = {
  Open: 0,
  "In Progress": 1,
  Pending: 2,
  Completed: 3,
  Canceled: 4,
  [NO_STATUS]: 5,
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
    } else if (column === "attachments") {
      result = (a.data.attachments?.length ?? 0) - (b.data.attachments?.length ?? 0);
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
