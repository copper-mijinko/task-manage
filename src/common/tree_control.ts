import { uuidV4 } from "./uuid"

interface TreeData {
  "id": string,
  "data": {
    "name": string,
    "status": "Open" | "Pending" | "In Progress" | "Completed" | "Canceled",
    "due date": `${string}-${string}-${string}` | undefined,
    "memo": []
  },
  "children": TreeData[]
}

interface ProjectData {
  "headers": {
    "name": string,
    "default_ratio": number
  }[],
  "data": TreeData,
}

export function filterTree(tree, filter): TreeData {
  if (!tree || !filter) return tree;

  // Check match against all filters
  let allFiltersMatch = true;
  let nameFilterMatch = false;

  // Check if filter is empty
  const hasFilters = Object.keys(filter).some(key => filter[key] && filter[key].length > 0);
  if (!hasFilters) return tree; // Return tree as is if no filters

  // Evaluate each filter
  for (let key in filter) {
    const keywords = filter[key];
    if (!keywords || keywords.length === 0) continue;

    let keyMatch = false;
    if (key === 'name') {
      // In case of name filter
      keyMatch = keywords.some(keyword =>
        tree.data.name &&
        tree.data.name.toLowerCase().includes(keyword.toLowerCase())
      );
      nameFilterMatch = keyMatch; // Record if name filter matched
    } else {
      // For other filters
      keyMatch = keywords.some(keyword =>
        tree.data[key] &&
        JSON.stringify(tree.data[key]).toLowerCase().includes(keyword.toLowerCase())
      );
    }

    if (!keyMatch) {
      allFiltersMatch = false;
      // Early exit only for non-name filters
      if (key !== 'name') break;
    }
  }

  // Process child nodes
  let matchedChildren = [];
  for (let child of (tree.children || [])) {
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
function cloneTreeWithAllChildren(tree): TreeData {
  if (!tree) return null;

  const children = (tree.children || []).map(child =>
    cloneTreeWithAllChildren(child)
  );

  return { ...tree, children };
}

export function getDefaultNode(): TreeData {
  let date = new Date();
  date.setDate(date.getDate() + 7);
  return {
    "id": `${uuidV4()}`,
    "data": {
      "name": "new_task",
      "status": "Open",
      "due date": undefined,
      "memo": [],
    },
    "children": []
  }
}

export function getDefaultProject(): ProjectData {
  let date = new Date();
  return {
    "headers": [
      {
        "name": "name",
        "default_ratio": 10
      },
      {
        "name": "status",
        "default_ratio": 4
      },
      {
        "name": "due date",
        "default_ratio": 4
      },
      {
        "name": "memo",
        "default_ratio": 2
      }
    ],
    "data": {
      "id": `${uuidV4()}`,
      "data": {
        "name": "new_project",
        "status": "Open",
        "due date": undefined,
        "memo": [],
      },
      "children": []
    },
  }
}

export function getNode(base: string, tree_data: TreeData): TreeData {
  // Depth First Search
  let base_tree: TreeData;
  if (tree_data.id == base) {
    return tree_data
  }
  for (let child of tree_data.children) {
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

export function setNode(target: TreeData, tree_data: TreeData): TreeData {
  // Depth First Search
  if (tree_data.id == target.id) {
    return target
  }
  for (let child of tree_data.children) {
    if (child.id == target.id) {
      tree_data.children[tree_data.children.indexOf(child)] = target;
      break;
    } else {
      child = setNode(target, child);
    }
  }
  return tree_data;
}

function getParent(base: string, tree_data: TreeData): TreeData {
  // Depth First Search
  let parent_tree;
  if (tree_data.id == base) {
    return undefined
  }
  for (let child of tree_data.children) {
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
  const target_tree = getNode(target, base_tree)
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
    case "insert_after":
      const base_parent_tree = getParent(base, tree_data);
      if (!base_parent_tree) {
        return tree_data;
      }
      let index = undefined;
      let i = 0;
      for (let child of base_parent_tree.children) {
        if (child.id == base) {
          index = action == "insert" ? i : i + 1;
          break;
        }
        i++;
      }
      base_parent_tree.children.splice(index, 0, node);
      break;
    case "append":
      const base_tree = getNode(base, tree_data);
      base_tree.children.push(node);
      break;
  }
  return tree_data
}

export function rmNode(target: string, tree_data: TreeData): TreeData {
  const target_parent_tree = getParent(target, tree_data);
  let index = undefined;
  let i = 0;
  for (let child of target_parent_tree.children) {
    if (child.id == target) {
      index = i;
      break;
    }
    i++;
  }
  target_parent_tree.children.splice(index, 1);
  return tree_data
}

export function reorderTree(target: string, base: string, tree_data: TreeData, action: "insert" | "append"): TreeData {
  const target_tree = getNode(target, tree_data);
  tree_data = rmNode(target, tree_data);
  tree_data = addNode(target_tree, base, tree_data, action);
  return tree_data
}
