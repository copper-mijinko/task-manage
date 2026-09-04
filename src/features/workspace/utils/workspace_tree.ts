import { normalizeTagList } from "@lib/utils/tags";
import type { WorkspaceTask, WorkspaceTaskStatus } from "@app-types/workspace";
import {
  normalizeMemoFormat,
  normalizeMemoKind,
  toMarkdown,
} from "@features/memos/utils/memo_utils";
import type { ProjectData, TreeData } from "@features/tasks/utils/tree_control";

const DEFAULT_HEADERS = [
  { name: "name", default_ratio: 10 },
  { name: "status", default_ratio: 4 },
  { name: "start date", default_ratio: 4 },
  { name: "due date", default_ratio: 4 },
  { name: "memo", default_ratio: 2 },
  { name: "attachments", default_ratio: 2 },
];

/**
 * Convert a flat WorkspaceTask map to a ProjectData tree for display.
 * Uses DFS with a global visited set for cycle detection (DAG → tree projection).
 * Multi-parent tasks appear only under the first parent reached.
 */
export function workspaceToProjectData(
  tasks: Record<string, WorkspaceTask>,
  rootId: string
): ProjectData {
  const resolvedRootId =
    tasks[rootId] !== undefined
      ? rootId
      : (Object.values(tasks).find((task) => task.parents.length === 0)?.id ?? rootId);
  const childrenMap = new Map<string, string[]>();
  for (const [id, task] of Object.entries(tasks)) {
    for (const parent of task.parents) {
      if (!childrenMap.has(parent)) childrenMap.set(parent, []);
      childrenMap.get(parent)!.push(id);
    }
  }

  for (const children of childrenMap.values()) {
    children.sort((a, b) => {
      const aOrder = tasks[a]?.order;
      const bOrder = tasks[b]?.order;
      if (aOrder === undefined && bOrder === undefined) return 0;
      if (aOrder === undefined) return 1;
      if (bOrder === undefined) return -1;
      return aOrder - bOrder;
    });
  }

  const visited = new Set<string>();

  function buildNode(id: string): TreeData {
    visited.add(id);
    const task = tasks[id];
    // visited は「子を組み立てる直前」に見る。先に配列へ絞り込んでしまうと、
    // 別の親の下でそのタスクが展開された後でもこちらのリストに残り続け、
    // 同じ id のノードが 2 箇所に現れて Svelte の keyed each が壊れる
    // （each_key_duplicate → ツリーが描画できず「読み込み中...」のまま）。
    const children: TreeData[] = [];
    for (const cid of childrenMap.get(id) ?? []) {
      if (visited.has(cid)) continue;
      children.push(buildNode(cid));
    }
    const node: TreeData = {
      id,
      data: {
        name: task.name,
        status: task.status,
        "start date": task.startDate as `${string}-${string}-${string}` | undefined,
        "due date": task.dueDate as `${string}-${string}-${string}` | undefined,
        memo: task.memos.map((m) => ({
          id: m.id,
          title: m.title,
          content: m.content,
          tags: m.tags,
          format: normalizeMemoFormat(m.format, "markdown"),
          kind: normalizeMemoKind(m.kind),
          order: m.order,
          bodyLoaded: m.bodyLoaded,
        })),
        tags: normalizeTagList(task.tags),
        attachments: task.attachments ?? [],
      },
      children,
    };
    if (task.archived) {
      node.archived = true;
      if (task.archivedAt) node.archivedAt = task.archivedAt;
    }
    return node;
  }

  if (!tasks[resolvedRootId]) {
    return {
      headers: DEFAULT_HEADERS,
      data: {
        id: rootId,
        data: {
          name: "unknown",
          status: "Open",
          "start date": undefined,
          "due date": undefined,
          memo: [],
        },
        children: [],
      },
    };
  }

  return { headers: DEFAULT_HEADERS, data: buildNode(resolvedRootId) };
}

/**
 * Convert a ProjectData tree back to a flat WorkspaceTask array.
 * Preserves createdAt from existingTasks when available.
 */
export function projectDataToWorkspaceTasks(
  projectData: ProjectData,
  existingTasks: Record<string, WorkspaceTask>
): WorkspaceTask[] {
  const result: WorkspaceTask[] = [];
  const today = new Date().toISOString().slice(0, 10);

  /**
   * 保存する親の集合を決める。
   *
   * ツリーは DAG の射影で、多親ノードは 1 箇所にしか現れない（同じ id の行が
   * 2 つあると Svelte の keyed each が壊れるため、workspaceToProjectData が
   * 意図的に 1 回だけ描いている）。そのため木の位置だけから親を作り直すと、
   * **描かれなかった辺がファイルからも消える**。種別を切り替えただけ、名前を
   * 直しただけ、といった構造と無関係な保存でも親が削られる。
   *
   * そこで「木が見せている親が既知の親に含まれているなら、構造は動いていない」
   * と判断し、既知の親をそのまま残す。木の位置が既知に無い親に変わったときだけ、
   * ユーザーが動かしたとみなして木の位置を採る。
   *
   * 後者はまだ不正確で、多親ノードを動かすと他の親も落ちる。それは行を辺として
   * 扱う（同じノードを親ごとに描く）ようにして初めて曖昧さが消えるので、そこまでは
   * この近似で「構造を触っていない保存が壊さない」ことだけを保証する。
   */
  function resolveParents(nodeId: string, treeParentIds: string[]): string[] {
    const known = existingTasks[nodeId]?.parents;
    if (!Array.isArray(known) || known.length <= 1) return treeParentIds;
    if (treeParentIds.length === 0) return known.length === 0 ? treeParentIds : known;
    const stillKnown = treeParentIds.every((id) => known.includes(id));
    return stillKnown ? known : treeParentIds;
  }

  function traverse(node: TreeData, parentIds: string[], siblingIndex: number) {
    const existing = existingTasks[node.id];
    const resolvedParents = resolveParents(node.id, parentIds);
    const task: WorkspaceTask = {
      id: node.id,
      name: node.data.name,
      status: (node.data.status as WorkspaceTaskStatus) || "Open",
      startDate: node.data["start date"] || undefined,
      dueDate: node.data["due date"] || undefined,
      parents: resolvedParents,
      memos: (node.data.memo || []).map((m, index) => {
        const format = normalizeMemoFormat(m.format, "markdown");
        const existingMemo =
          existing?.memos.find((memo) => memo.id === m.id) ?? existing?.memos[index];
        const content = m.bodyLoaded === false && existingMemo ? existingMemo.content : m.content;
        return {
          id: m.id || "",
          title: m.title || "",
          content: format === "markdown" ? toMarkdown(content) : content,
          tags: Array.isArray(m.tags) ? m.tags : [],
          format,
          kind: normalizeMemoKind(m.kind),
          order: index,
          bodyLoaded: m.bodyLoaded,
        };
      }),
      tags: normalizeTagList(node.data.tags),
      attachments: Array.isArray(node.data.attachments)
        ? node.data.attachments
        : (existing?.attachments ?? []),
      createdAt: existing?.createdAt || today,
      order: resolvedParents.length === 0 ? existing?.order : siblingIndex,
    };
    if (node.archived) {
      task.archived = true;
      task.archivedAt = node.archivedAt ?? existing?.archivedAt;
    }
    result.push(task);
    for (const [index, child] of (node.children || []).entries()) {
      traverse(child, [node.id], index);
    }
  }

  if (projectData.data) {
    traverse(projectData.data, [], 0);
  }
  return result;
}
