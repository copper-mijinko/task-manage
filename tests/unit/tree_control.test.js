import {
  addNode,
  canIndentNode,
  canMoveNodeDown,
  canMoveNodeUp,
  canOutdentNode,
  cloneWithNewIds,
  filterTree,
  flattenVisibleTree,
  getNode,
  indentNode,
  moveNodeDown,
  moveNodeUp,
  outdentNode,
  reorderTree,
  rmNode,
  updateNodeDataById,
} from "../../src/common/tree_control.ts";

function createTree() {
  return {
    id: "project-1",
    data: {
      name: "Sample Project",
      status: "Open",
      "due date": undefined,
      memo: [],
    },
    children: [
      {
        id: "task-1",
        data: {
          name: "Write tests",
          status: "In Progress",
          "due date": "2026-05-01",
          memo: [],
        },
        children: [],
      },
      {
        id: "task-2",
        data: {
          name: "Ship release",
          status: "Pending",
          "due date": "2026-05-10",
          memo: [],
        },
        children: [
          {
            id: "task-2-1",
            data: {
              name: "Checklist",
              status: "Open",
              "due date": undefined,
              memo: [],
            },
            children: [],
          },
        ],
      },
    ],
  };
}

describe("tree_control", () => {
  test("filterTree keeps only matching branches and preserves matching descendants", () => {
    const filtered = filterTree(createTree(), { name: ["ship"] });

    expect(filtered.data.name).toBe("Sample Project");
    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("task-2");
    expect(filtered.children[0].children).toHaveLength(1);
    expect(filtered.children[0].children[0].id).toBe("task-2-1");
  });

  test("filterTree supports multiple filters and removes branches that do not match all conditions", () => {
    const filtered = filterTree(createTree(), {
      name: ["ship"],
      status: ["pending"],
    });

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("task-2");
    expect(filtered.children[0].data.status).toBe("Pending");
  });

  test("updateNodeDataById patches a nested node without mutating siblings", () => {
    const tree = createTree();
    const originalSibling = tree.children[0];

    const updated = updateNodeDataById(tree, "task-2", {
      status: "Completed",
      name: "Ship stable release",
    });

    expect(getNode("task-2", updated).data.status).toBe("Completed");
    expect(getNode("task-2", updated).data.name).toBe("Ship stable release");
    expect(updated.children[0]).toBe(originalSibling);
    expect(updated).not.toBe(tree);
  });

  test("flattenVisibleTree omits descendants of collapsed nodes", () => {
    const rows = flattenVisibleTree(createTree(), new Set(["task-2"]));

    expect(rows.map((row) => row.id)).toEqual(["project-1", "task-1", "task-2"]);
    expect(rows.find((row) => row.id === "task-2")).toMatchObject({
      depth: 1,
      expanded: false,
      hasChildren: true,
    });
  });

  test("flattenVisibleTree exposes movement metadata for each visible row", () => {
    const rows = flattenVisibleTree(createTree());
    const task1 = rows.find((row) => row.id === "task-1");
    const nestedTask = rows.find((row) => row.id === "task-2-1");

    expect(task1).toMatchObject({
      depth: 1,
      canMoveUp: false,
      canMoveDown: true,
      canIndent: false,
      canOutdent: false,
    });
    expect(nestedTask).toMatchObject({
      depth: 2,
      canMoveUp: false,
      canMoveDown: false,
      canIndent: false,
      canOutdent: true,
    });
  });

  test("addNode can append and remove nodes within the tree", () => {
    const tree = createTree();
    const newNode = {
      id: "task-3",
      data: {
        name: "Review",
        status: "Open",
        "due date": undefined,
        memo: [],
      },
      children: [],
    };

    addNode(newNode, "task-2", tree, "append");
    expect(getNode("task-2", tree).children.map((child) => child.id)).toEqual([
      "task-2-1",
      "task-3",
    ]);

    rmNode("task-3", tree);
    expect(getNode("task-2", tree).children.map((child) => child.id)).toEqual(["task-2-1"]);
  });

  test("reorderTree can move a node before another node", () => {
    const tree = createTree();

    reorderTree("task-2", "task-1", tree, "insert");

    expect(tree.children.map((child) => child.id)).toEqual(["task-2", "task-1"]);
  });

  test("moveNodeUp and moveNodeDown reorder siblings safely", () => {
    const tree = createTree();
    tree.children.push({
      id: "task-3",
      data: {
        name: "Archive",
        status: "Open",
        "due date": undefined,
        memo: [],
      },
      children: [],
    });

    expect(canMoveNodeUp("task-1", tree)).toBe(false);
    expect(canMoveNodeDown("task-1", tree)).toBe(true);

    moveNodeDown("task-1", tree);
    expect(tree.children.map((child) => child.id)).toEqual(["task-2", "task-1", "task-3"]);

    moveNodeUp("task-1", tree);
    expect(tree.children.map((child) => child.id)).toEqual(["task-1", "task-2", "task-3"]);
  });

  test("move and hierarchy helpers are no-ops for invalid or blocked operations", () => {
    const tree = createTree();
    const snapshot = JSON.parse(JSON.stringify(tree));

    expect(canMoveNodeUp("missing", tree)).toBe(false);
    expect(canMoveNodeDown("missing", tree)).toBe(false);
    expect(canIndentNode("task-1", tree)).toBe(false);
    expect(canOutdentNode("task-1", tree)).toBe(false);

    moveNodeUp("task-1", tree);
    moveNodeDown("task-2", tree);
    indentNode("task-1", tree);
    outdentNode("task-1", tree);

    expect(tree).toEqual(snapshot);
  });

  test("indentNode and outdentNode change hierarchy level", () => {
    const tree = createTree();
    tree.children.push({
      id: "task-3",
      data: {
        name: "Archive",
        status: "Open",
        "due date": undefined,
        memo: [],
      },
      children: [],
    });

    expect(canIndentNode("task-3", tree)).toBe(true);
    indentNode("task-3", tree);
    expect(tree.children.map((child) => child.id)).toEqual(["task-1", "task-2"]);
    expect(getNode("task-2", tree).children.map((child) => child.id)).toEqual([
      "task-2-1",
      "task-3",
    ]);

    expect(canOutdentNode("task-3", tree)).toBe(true);
    outdentNode("task-3", tree);
    expect(tree.children.map((child) => child.id)).toEqual(["task-1", "task-2", "task-3"]);
  });

  test("getNode returns undefined when the target does not exist", () => {
    expect(getNode("missing", createTree())).toBeUndefined();
  });
});

describe("cloneWithNewIds", () => {
  test("cloned root node has a different id", () => {
    const tree = createTree();
    const cloned = cloneWithNewIds(tree);
    expect(cloned.id).not.toBe(tree.id);
  });

  test("cloned node preserves name, status, and memo", () => {
    const tree = createTree();
    const cloned = cloneWithNewIds(tree);
    expect(cloned.data.name).toBe(tree.data.name);
    expect(cloned.data.status).toBe(tree.data.status);
    expect(cloned.data.memo).toEqual(tree.data.memo);
  });

  test("cloned children all get new ids", () => {
    const tree = createTree();
    const cloned = cloneWithNewIds(tree);
    expect(cloned.children.length).toBe(tree.children.length);
    cloned.children.forEach((child, i) => {
      expect(child.id).not.toBe(tree.children[i].id);
    });
  });

  test("cloned grandchildren also get new ids", () => {
    const tree = createTree();
    const cloned = cloneWithNewIds(tree);
    const originalGrandchild = tree.children[1].children[0];
    const clonedGrandchild = cloned.children[1].children[0];
    expect(clonedGrandchild.id).not.toBe(originalGrandchild.id);
    expect(clonedGrandchild.data.name).toBe(originalGrandchild.data.name);
  });

  test("modifying cloned memo does not affect original", () => {
    const node = {
      id: "a",
      data: { name: "task", status: "Open", memo: [{ text: "hello" }] },
      children: [],
    };
    const cloned = cloneWithNewIds(node);
    cloned.data.memo.push({ text: "world" });
    expect(node.data.memo.length).toBe(1);
  });
});
