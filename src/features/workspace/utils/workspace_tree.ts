import type { WorkspaceTask, WorkspaceTaskStatus } from "@app-types/workspace";
import { normalizeMemoFormat, toMarkdown } from "@features/memos/utils/memo_utils";
import type { ProjectData, TreeData } from "@features/tasks/utils/tree_control";

const DEFAULT_HEADERS = [
  { name: "name", default_ratio: 10 },
  { name: "status", default_ratio: 4 },
  { name: "start date", default_ratio: 4 },
  { name: "due date", default_ratio: 4 },
  { name: "memo", default_ratio: 2 },
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
    const childIds = (childrenMap.get(id) ?? []).filter((cid) => !visited.has(cid));
    return {
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
          order: m.order,
        })),
      },
      children: childIds.map((cid) => buildNode(cid)),
    };
  }

  if (!tasks[rootId]) {
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

  return { headers: DEFAULT_HEADERS, data: buildNode(rootId) };
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

  function traverse(node: TreeData, parentIds: string[], siblingIndex: number) {
    const existing = existingTasks[node.id];
    result.push({
      id: node.id,
      name: node.data.name,
      status: (node.data.status as WorkspaceTaskStatus) || "Open",
      startDate: node.data["start date"] || undefined,
      dueDate: node.data["due date"] || undefined,
      parents: parentIds,
      memos: (node.data.memo || []).map((m, index) => {
        const format = normalizeMemoFormat(m.format, "markdown");
        return {
          id: m.id || "",
          title: m.title || "",
          content: format === "markdown" ? toMarkdown(m.content) : m.content,
          tags: Array.isArray(m.tags) ? m.tags : [],
          format,
          order: index,
        };
      }),
      createdAt: existing?.createdAt || today,
      order: parentIds.length === 0 ? existing?.order : siblingIndex,
    });
    for (const [index, child] of (node.children || []).entries()) {
      traverse(child, [node.id], index);
    }
  }

  if (projectData.data) {
    traverse(projectData.data, [], 0);
  }
  return result;
}
