import { normalizeTagList } from "@lib/utils/tags";
import type { WorkspaceParentLink, WorkspaceTask, WorkspaceTaskStatus } from "@app-types/workspace";
import { normalizeParentLinks, orderUnderParent } from "@lib/utils/parent_links";
import { normalizeMemoFormat, toMarkdown } from "@features/memos/utils/memo_utils";
import { NO_STATUS, type ProjectData, type TreeData } from "@features/tasks/utils/tree_control";

const DEFAULT_HEADERS = [
  { name: "name", default_ratio: 10 },
  { name: "status", default_ratio: 4 },
  { name: "start date", default_ratio: 4 },
  { name: "due date", default_ratio: 4 },
  { name: "attachments", default_ratio: 2 },
];

/**
 * Convert a flat WorkspaceTask map to a ProjectData tree for display.
 * DAG → 木の射影。多親ノードは親ごとに現れる（＝行は辺）。打ち切るのは循環だけ。
 */
export function workspaceToProjectData(
  rawTasks: Record<string, WorkspaceTask>,
  rootId: string
): ProjectData {
  // `parents` は旧形式（id の配列）でも来る。ファイルを直接書いた場合や、
  // 別ウィンドウから渡された古いキャッシュがそれにあたる。入口で 1 回だけ
  // 揃える（すでに新形式なら元のオブジェクトをそのまま使う）。
  const tasks = normalizeTasksParents(rawTasks);
  const resolvedRootId =
    tasks[rootId] !== undefined
      ? rootId
      : (Object.values(tasks).find((task) => task.parents.length === 0)?.id ?? rootId);
  const childrenMap = new Map<string, string[]>();
  for (const [id, task] of Object.entries(tasks)) {
    for (const parent of task.parents) {
      if (!childrenMap.has(parent.id)) childrenMap.set(parent.id, []);
      childrenMap.get(parent.id)!.push(id);
    }
  }

  for (const [parentId, children] of childrenMap) {
    children.sort((a, b) => {
      // 並び順は辺の属性。**その親の下での** order で並べる。
      const aOrder = orderUnderParent(tasks[a]?.parents, parentId);
      const bOrder = orderUnderParent(tasks[b]?.parents, parentId);
      if (aOrder !== bOrder) return aOrder - bOrder;
      // 同値・未指定どうしは id で決める。読み取り順に頼ると環境で並びが変わる。
      return a < b ? -1 : a > b ? 1 : 0;
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
  /** 循環で描けなかった辺。子 id → 描けなかった親 id の集合。 */
  const cutParentsByChild = new Map<string, Set<string>>();

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
    // 循環で描けなかった辺（この親 → その子）。保存で消さないため子側に残す。
    const cutChildIds: string[] = [];
    for (const cid of childrenMap.get(id) ?? []) {
      if (pathAncestors.has(cid)) {
        pathDependent = true;
        cutChildIds.push(cid);
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
        status: task.status ?? NO_STATUS,
        body: task.body,
        format: normalizeMemoFormat(task.format, "markdown"),
        bodyLoaded: task.bodyLoaded,
        "start date": task.startDate as `${string}-${string}-${string}` | undefined,
        "due date": task.dueDate as `${string}-${string}-${string}` | undefined,
        tags: normalizeTagList(task.tags),
        attachments: task.attachments ?? [],
      },
      children,
    };
    if (task.archived) {
      node.archived = true;
      if (task.archivedAt) node.archivedAt = task.archivedAt;
    }
    // 打ち切った辺は「子から見た親」として記録する。
    for (const cid of cutChildIds) {
      cutParentsByChild.set(cid, (cutParentsByChild.get(cid) ?? new Set()).add(id));
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
    if (tasks[id].parents.some((parent) => unreachableSet.has(parent.id))) continue;
    rescue(id);
  }
  // てっぺんが無いかたまり（ルートに繋がらない循環）はここで拾う。
  for (const id of unreachable) rescue(id);

  // 打ち切った辺を、そのノードに載せて保存側へ渡す。
  if (cutParentsByChild.size > 0) {
    const applyCuts = (node: TreeData, seen: Set<TreeData>) => {
      if (seen.has(node)) return;
      seen.add(node);
      const cut = cutParentsByChild.get(node.id);
      if (cut && cut.size > 0) node.cutParentIds = [...cut];
      for (const child of node.children) applyCuts(child, seen);
    };
    applyCuts(root, new Set<TreeData>());
  }

  return { headers: DEFAULT_HEADERS, data: root };
}

/**
 * ノード本文を書き戻す形にする。
 *
 * **本文を読み込んでいないノードは、既存の本文をそのまま残す。** 一覧目的の
 * 読み出しでは本文を読まない（`bodyLoaded: false`）ので、そこで空文字を書き
 * 戻すと「開かなかったノードの本文が消える」形の事故になる。メモの content が
 * 同じ理由で同じ扱いをしている。
 */
function nodeBodyFor(node: TreeData, existing: WorkspaceTask | undefined) {
  const format = normalizeMemoFormat(node.data.format, "markdown");
  if (node.data.bodyLoaded === false) {
    return { body: existing?.body, format, bodyLoaded: false };
  }
  const body = node.data.body;
  return {
    body: format === "markdown" ? toMarkdown(body) : body,
    format,
    bodyLoaded: node.data.bodyLoaded,
  };
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
    // その出現の親リンク（親 id ＋ その親の下での並び順）。ルートは空。
    parentLinks: WorkspaceParentLink[],
    siblingIndex: number,
    // いま辿っている経路の祖先。編集の結果ツリーに循環ができても、
    // ここで打ち切って保存が落ちないようにする（防御）。
    ancestors: ReadonlySet<string> = new Set<string>()
  ) {
    if (ancestors.has(node.id)) return;
    const pathAncestors = new Set(ancestors).add(node.id);
    const alreadyAt = emittedIndexById.get(node.id);
    if (alreadyAt !== undefined) {
      // 2 回目以降の出現：親リンクだけ足して、中身は最初の出現のものを使う。
      // 並び順は辺ごとに違うので、その出現での位置をそのまま持たせる。
      const emitted = result[alreadyAt];
      for (const link of parentLinks) {
        if (!emitted.parents.some((parent) => parent.id === link.id)) {
          emitted.parents.push(link);
        }
      }
      for (const [index, child] of (node.children || []).entries()) {
        traverse(child, [{ id: node.id, order: index }], index, pathAncestors);
      }
      return;
    }

    const existing = existingTasks[node.id];
    const resolvedParents = [...parentLinks];
    const task: WorkspaceTask = {
      id: node.id,
      name: node.data.name,
      status: (node.data.status as WorkspaceTaskStatus) || undefined,
      startDate: node.data["start date"] || undefined,
      dueDate: node.data["due date"] || undefined,
      parents: resolvedParents,
      ...nodeBodyFor(node, existing),
      tags: normalizeTagList(node.data.tags),
      attachments: Array.isArray(node.data.attachments)
        ? node.data.attachments
        : (existing?.attachments ?? []),
      createdAt: existing?.createdAt || today,
      // タスク直下の order はルート（＝プロジェクトの並び順）だけが持つ。
      // 通常タスクの並び順は parents[].order にある。
      order: resolvedParents.length === 0 ? existing?.order : undefined,
    };
    if (node.archived) {
      task.archived = true;
      task.archivedAt = node.archivedAt ?? existing?.archivedAt;
    }
    // 循環で描けなかった辺を戻す。木からは導けないので、ここでしか復元できない。
    for (const cutId of node.cutParentIds ?? []) {
      if (!task.parents.some((parent) => parent.id === cutId)) {
        const previous = existing?.parents?.find((parent) => parent.id === cutId);
        task.parents.push(previous ?? { id: cutId });
      }
    }
    emittedIndexById.set(node.id, result.length);
    result.push(task);
    for (const [index, child] of (node.children || []).entries()) {
      traverse(child, [{ id: node.id, order: index }], index, pathAncestors);
    }
  }

  if (projectData.data) {
    traverse(projectData.data, [], 0);
  }
  return result;
}

/**
 * `parents` を親リンクに揃える。旧形式が 1 件も無ければ、元の Record を
 * そのまま返す（通常経路でコピーを作らない）。
 */
function normalizeTasksParents(
  tasks: Record<string, WorkspaceTask>
): Record<string, WorkspaceTask> {
  let needsFix = false;
  for (const task of Object.values(tasks)) {
    if ((task.parents ?? []).some((parent) => typeof parent !== "object" || parent === null)) {
      needsFix = true;
      break;
    }
  }
  if (!needsFix) return tasks;

  const fixed: Record<string, WorkspaceTask> = {};
  for (const [id, task] of Object.entries(tasks)) {
    fixed[id] = { ...task, parents: normalizeParentLinks(task.parents, task.order) };
  }
  return fixed;
}
