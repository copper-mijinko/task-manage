import type { WorkspaceTask } from "../types/workspace";
import type { ProjectData, TreeData } from "./tree_control";

const DEFAULT_HEADERS = [
  { name: "name", default_ratio: 10 },
  { name: "status", default_ratio: 4 },
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
        "due date": task.dueDate as `${string}-${string}-${string}` | undefined,
        memo: task.memos.map((m) => ({ title: m.title, content: m.content })),
      },
      children: childIds.map((cid) => buildNode(cid)),
    };
  }

  if (!tasks[rootId]) {
    return {
      headers: DEFAULT_HEADERS,
      data: {
        id: rootId,
        data: { name: "unknown", status: "Open", "due date": undefined, memo: [] },
        children: [],
      },
    };
  }

  return { headers: DEFAULT_HEADERS, data: buildNode(rootId) };
}
