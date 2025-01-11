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
  "data": TreeData
}

export function filterTree(tree, filter): TreeData {
  if (!tree || !filter) return tree;
  let matchedChildren = [];
  for (let child of (tree.children || [])) {
    const filteredChild = filterTree(child, filter);
    if (filteredChild) {
      matchedChildren.push(filteredChild);
    }
  }
  let isMatch = true;
  for (let key in filter) {
    const keywords = filter[key];
    if (! keywords) continue;
    isMatch = keywords.some(keyword => tree.data[key] && JSON.stringify(tree.data[key]).toLowerCase().includes(keyword.toLowerCase()));
    if (! isMatch) {
      break;
    }
  }
  if (matchedChildren.length > 0 || isMatch) {
    const cloned = { ...tree, children: matchedChildren };
    return cloned;
  }
  return null;
}

export function getDefaultNode():TreeData {
  let date = new Date();
  date.setDate(date.getDate() + 7);
  return  {
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

export function getDefaultProject():ProjectData {
  let date = new Date();
  return {
    "headers": [
      {
        "name": "name",
        "default_ratio": 8
      },
      {
        "name": "status",
        "default_ratio": 5
      },
      {
        "name": "due date",
        "default_ratio": 4
      },
      {
        "name": "memo",
        "default_ratio": 1
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
    }
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

export function setNode(target: TreeData, tree_data: TreeData):TreeData {
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

function getParent(base: string, tree_data: TreeData):TreeData {
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

export function isChild(target: string, base: string, tree_data: TreeData):boolean {
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
  ):TreeData {
  // insert or append
  switch (action) {
    case "insert":
    case "insert_after":
      const base_parent_tree = getParent(base, tree_data);
      if (! base_parent_tree) {
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

export function rmNode(target: string, tree_data: TreeData):TreeData {
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

export function reorderTree(target: string, base: string, tree_data: TreeData, action: "insert" | "append"):TreeData {
  const target_tree = getNode(target, tree_data);
  tree_data = rmNode(target, tree_data);
  tree_data = addNode(target_tree, base, tree_data, action);
  return tree_data
}
