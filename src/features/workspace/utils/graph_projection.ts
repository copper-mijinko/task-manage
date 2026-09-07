import type { WorkspaceGraph, WorkspaceGraphNode } from "@app-types/workspace_graph";

export interface GraphProjectionRow {
  occurrenceId: string;
  nodeId: string;
  parentId: string | null;
  depth: number;
  order: number;
  node: WorkspaceGraphNode;
  cycleReference: boolean;
  expandable: boolean;
}
export type GraphProjection = GraphProjectionRow[] & { truncated: boolean };

type ChildrenIndex = Map<string, WorkspaceGraphNode[]>;
const childrenIndexCache = new WeakMap<WorkspaceGraph, ChildrenIndex>();

function buildChildrenIndex(graph: WorkspaceGraph): ChildrenIndex {
  const cached = childrenIndexCache.get(graph);
  if (cached) return cached;
  const index: ChildrenIndex = new Map();
  for (const node of Object.values(graph.nodes)) {
    for (const parent of node.parents) {
      const children = index.get(parent.id) ?? [];
      if (!children.includes(node)) children.push(node);
      index.set(parent.id, children);
    }
  }
  for (const [parentId, children] of index) {
    children.sort((a, b) => {
      const ao = a.parents.find((parent) => parent.id === parentId)?.order;
      const bo = b.parents.find((parent) => parent.id === parentId)?.order;
      return (
        (ao ?? Number.MAX_SAFE_INTEGER) - (bo ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    });
  }
  childrenIndexCache.set(graph, index);
  return index;
}

function childrenOf(index: ChildrenIndex, parentId: string): WorkspaceGraphNode[] {
  return index.get(parentId) ?? [];
}

export function projectGraphTree(
  graph: WorkspaceGraph,
  options: {
    rootId?: string;
    maxRows?: number;
    /** When supplied, only these occurrence paths are traversed. */
    expandedPaths?: ReadonlySet<string>;
    /** Alias used by tree views; retained separately for a clear UI-facing contract. */
    expandedOccurrenceIds?: ReadonlySet<string>;
  } = {}
): GraphProjection {
  const rootId = options.rootId ?? graph.rootId;
  const maxRows = options.maxRows ?? 20_000;
  const rows = [] as unknown as GraphProjection;
  const childrenIndex = buildChildrenIndex(graph);
  rows.truncated = false;
  const stack: { nodeId: string; parentId: string | null; path: string[]; order: number }[] = [
    { nodeId: rootId, parentId: null, path: [], order: 0 },
  ];
  while (stack.length) {
    if (rows.length >= maxRows) {
      rows.truncated = true;
      break;
    }
    const { nodeId, parentId, path, order } = stack.pop()!;
    const node = graph.nodes[nodeId];
    if (!node) continue;
    const cycleReference = path.includes(nodeId);
    const occurrencePath = [...path, nodeId];
    rows.push({
      occurrenceId: occurrencePath.join("/"),
      nodeId,
      parentId,
      depth: path.length,
      order,
      node,
      cycleReference,
      expandable: !cycleReference && childrenOf(childrenIndex, nodeId).length > 0,
    });
    if (cycleReference) continue;
    const expandedPaths = options.expandedOccurrenceIds ?? options.expandedPaths;
    const shouldExpand =
      !expandedPaths ||
      occurrencePath.join("/") === rootId ||
      expandedPaths.has(occurrencePath.join("/"));
    if (!shouldExpand) continue;
    const children = childrenOf(childrenIndex, nodeId);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        nodeId: children[index].id,
        parentId: nodeId,
        path: occurrencePath,
        order: index,
      });
    }
  }
  return rows;
}

export function projectFinderRows(
  graph: WorkspaceGraph,
  parentId: string,
  ancestorPath: string[] = []
): GraphProjectionRow[] {
  const childrenIndex = buildChildrenIndex(graph);
  return childrenOf(childrenIndex, parentId).map((node, index) => {
    const cycleReference = ancestorPath.includes(node.id);
    return {
      occurrenceId: [...ancestorPath, parentId, node.id].join("/"),
      nodeId: node.id,
      parentId,
      depth: ancestorPath.length + 1,
      order: index,
      node,
      cycleReference,
      expandable: !cycleReference && childrenOf(childrenIndex, node.id).length > 0,
    };
  });
}
