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
 * DAG → 木の射影。多親ノードは親ごとに現れる（＝行は辺）。打ち切るのは循環だけ。
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

  /**
   * 展開の安全弁。多親が重なると出現数は経路数ぶん増えるので、病的な構造で
   * 固まらないよう総数で頭打ちにする。通常のデータでは到達しない。
   */
  const MAX_TREE_NODES = 20000;
  let emitted = 0;

  /**
   * 同じノードの複数の出現は**同じオブジェクト**を共有する。
   * 子の追加・削除・並べ替え・アーカイブはどれもノードの属性（`parents` /
   * `order` / `archived`）であって辺の属性ではないので、片方の出現にだけ
   * 効くのは誤り。共有すれば `children` 配列が 1 つになり、どの出現から
   * 操作しても全出現に反映される（保存後の再読込を待たずに一致する）。
   *
   * 共有できるのは**経路に依らない**部分木だけ。循環の打ち切りが起きた部分木は
   * 祖先集合に依存するので共有しない。
   */
  const shared = new Map<string, TreeData>();
  const sharedSize = new Map<string, number>();

  type Built = { node: TreeData; size: number; pathDependent: boolean };

  /**
   * 多親ノードは**親ごとに**展開する。木は DAG の射影なので、同じノードが
   * 複数の経路に現れるのが正しい。
   *
   * 打ち切るのは循環だけ。判定は「グローバルに一度出したか」ではなく
   * 「いま辿っている経路の祖先に含まれるか」で行う。前者だと多親が潰れて
   * 全域木になり、辺が消える（保存にも波及していた）。
   *
   * 同じ id のノードが複数現れるため、行の key はノード id ではなく
   * ルートからの経路にする必要がある（flattenVisibleTree の `path`）。
   */
  function buildNode(id: string, ancestors: ReadonlySet<string>): Built {
    const cached = shared.get(id);
    if (cached) {
      // 使い回しても「表示上は何行に展開されるか」は変わらないので、
      // 安全弁の勘定には部分木のぶんを足す。
      const size = sharedSize.get(id) ?? 1;
      emitted += size;
      return { node: cached, size, pathDependent: false };
    }

    emitted += 1;
    let size = 1;
    let pathDependent = false;
    const task = tasks[id];
    const pathAncestors = new Set(ancestors).add(id);
    const children: TreeData[] = [];
    for (const cid of childrenMap.get(id) ?? []) {
      if (pathAncestors.has(cid)) {
        pathDependent = true;
        continue;
      }
      if (emitted >= MAX_TREE_NODES) {
        pathDependent = true;
        break;
      }
      const built = buildNode(cid, pathAncestors);
      children.push(built.node);
      size += built.size;
      if (built.pathDependent) pathDependent = true;
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
    if (!pathDependent) {
      shared.set(id, node);
      sharedSize.set(id, size);
    }
    return { node, size, pathDependent };
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

  const root = buildNode(resolvedRootId, new Set<string>()).node;

  /*
   * ルートから辿れないタスクをルート直下に付け直す。
   *
   * 親が存在しない id を指している、親をたどると自分に戻る、といった形で
   * ルートに繋がらないタスクは、木に現れない＝保存時に書き出されないので、
   * ファイルごと消える。アプリの外（エディタ・CLI・同期）で壊れることは
   * あるので、読み込み時に必ず拾う。孤児を作らない設計の受け皿。
   *
   * 走査はタスク数に比例する 1 パスで、共有のおかげで部分木は作り直さない。
   */
  const reachable = new Set<string>();
  const mark = (node: TreeData) => {
    if (reachable.has(node.id)) return;
    reachable.add(node.id);
    for (const child of node.children) mark(child);
  };
  mark(root);

  const unreachable = Object.keys(tasks).filter((id) => !reachable.has(id));
  const unreachableSet = new Set(unreachable);
  const rescue = (id: string) => {
    if (reachable.has(id)) return;
    const built = buildNode(id, new Set<string>([resolvedRootId]));
    root.children.push(built.node);
    mark(built.node);
  };
  // まず孤児のかたまりの「てっぺん」だけを付け直す。子から先に拾うと、
  // 同じかたまりがルート直下と親の下の両方に出てしまう。
  for (const id of unreachable) {
    if (tasks[id].parents.some((parentId) => unreachableSet.has(parentId))) continue;
    rescue(id);
  }
  // てっぺんが無いかたまり（ルートに繋がらない循環）はここで拾う。
  for (const id of unreachable) rescue(id);

  return { headers: DEFAULT_HEADERS, data: root };
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
   * 多親ノードは親ごとに複数の行として現れるため、traverse は同じノードを
   * 複数回訪れる。ノードごとに 1 件だけ出し、親は**全出現の和**を採る。
   *
   * 木が全ての辺を見せるようになったので、木の位置から親を正確に導ける。
   * 片方の出現だけを動かせば、その辺だけが変わり、他の親は残る（行＝辺）。
   */
  const emittedIndexById = new Map<string, number>();

  function traverse(
    node: TreeData,
    parentIds: string[],
    siblingIndex: number,
    // いま辿っている経路の祖先。編集の結果ツリーに循環ができても、
    // ここで打ち切って保存が落ちないようにする（防御）。
    ancestors: ReadonlySet<string> = new Set<string>()
  ) {
    if (ancestors.has(node.id)) return;
    const pathAncestors = new Set(ancestors).add(node.id);
    const alreadyAt = emittedIndexById.get(node.id);
    if (alreadyAt !== undefined) {
      // 2 回目以降の出現：親だけ足して、中身は最初の出現のものを使う。
      const emitted = result[alreadyAt];
      for (const parentId of parentIds) {
        if (!emitted.parents.includes(parentId)) emitted.parents.push(parentId);
      }
      for (const [index, child] of (node.children || []).entries()) {
        traverse(child, [node.id], index, pathAncestors);
      }
      return;
    }

    const existing = existingTasks[node.id];
    const resolvedParents = [...parentIds];
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
    emittedIndexById.set(node.id, result.length);
    result.push(task);
    for (const [index, child] of (node.children || []).entries()) {
      traverse(child, [node.id], index, pathAncestors);
    }
  }

  if (projectData.data) {
    traverse(projectData.data, [], 0);
  }
  return result;
}
