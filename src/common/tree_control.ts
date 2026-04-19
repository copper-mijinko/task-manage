import { uuidV4 } from "./uuid";

export type TaskStatus = "Open" | "Pending" | "In Progress" | "Completed" | "Canceled";

export interface MemoEntry {
  title: string;
  content: unknown;
}

export interface TreeNodeData {
  name: string;
  status: TaskStatus;
  "due date": `${string}-${string}-${string}` | undefined;
  memo: MemoEntry[];
  [key: string]: unknown;
}

export interface TreeData {
  id: string;
  data: TreeNodeData;
  children: TreeData[];
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
  canMoveUp: boolean;
  canMoveDown: boolean;
  canIndent: boolean;
  canOutdent: boolean;
}

export function filterTree(
  tree: TreeData | null | undefined,
  filter: Record<string, string[]> | null | undefined
): TreeData | null | undefined {
  if (!tree || !filter) return tree;

  // Check match against all filters
  let allFiltersMatch = true;
  let nameFilterMatch = false;

  // Check if filter is empty
  const hasFilters = Object.keys(filter).some((key) => filter[key] && filter[key].length > 0);
  if (!hasFilters) return tree; // Return tree as is if no filters

  // Evaluate each filter
  for (const key in filter) {
    const keywords = filter[key];
    if (!keywords || keywords.length === 0) continue;

    let keyMatch = false;
    if (key === "name") {
      // In case of name filter
      keyMatch = keywords.some(
        (keyword) => tree.data.name && tree.data.name.toLowerCase().includes(keyword.toLowerCase())
      );
      nameFilterMatch = keyMatch; // Record if name filter matched
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
    if (nameFilterMatch && allFiltersMatch) {
      // If name filter matches and all filters match,
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

export function getDefaultNode(): TreeData {
  return {
    id: `${uuidV4()}`,
    data: {
      name: "new_task",
      status: "Open",
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
        name: "due date",
        default_ratio: 4,
      },
      {
        name: "memo",
        default_ratio: 2,
      },
    ],
    data: {
      id: `${uuidV4()}`,
      data: {
        name: "new_project",
        status: "Open",
        "due date": undefined,
        memo: [],
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
  closedIds: Set<string> = new Set()
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
    siblingCount: number
  ) => {
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
      visit(child, depth + 1, node.id, index, childCount);
    });
  };

  visit(tree_data, 0, undefined, 0, 1);

  return rows;
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
  action: "insert" | "append"
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
