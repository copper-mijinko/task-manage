import { projectGraphTree } from "../utils/graph_projection";

// A disposable view model. Domain records never become mutable TreeTable objects.
export function projectTreeGrid(graph, rootId) {
  if (!graph?.nodes[rootId]) return undefined;
  const rows = projectGraphTree(graph, { rootId });
  const occurrences = new Map();
  let root;
  for (const row of rows) {
    const node = row.node;
    const item = {
      id: node.id,
      archived: node.archived,
      cycleReference: row.cycleReference,
      data: {
        name: node.name,
        status: node.status ?? "",
        "start date": node.startDate,
        "due date": node.dueDate,
        body: structuredClone(node.body),
        format: node.format,
        bodyLoaded: true,
        tags: [...(node.tags || [])],
        attachments: structuredClone(node.attachments || []),
      },
      children: [],
    };
    occurrences.set(row.occurrenceId, item);
    const parentPath = row.occurrenceId.split("/").slice(0, -1).join("/");
    if (parentPath) occurrences.get(parentPath)?.children.push(item);
    else root = item;
  }
  return { data: root, headers: [], truncated: rows.truncated };
}

export function nodeChanges(patch) {
  const result = {};
  const names = { "start date": "startDate", "due date": "dueDate" };
  for (const [key, value] of Object.entries(patch)) {
    const field = names[key] || key;
    if (
      [
        "name",
        "status",
        "startDate",
        "dueDate",
        "body",
        "format",
        "tags",
        "attachments",
        "archived",
      ].includes(field)
    )
      result[field] =
        ["status", "startDate", "dueDate"].includes(field) && !value ? undefined : value;
  }
  return result;
}
