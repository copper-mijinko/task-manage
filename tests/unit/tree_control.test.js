import {
  addNode,
  areAllSiblings,
  buildStickyTrail,
  bulkAddNodes,
  bulkDuplicate,
  bulkIndent,
  bulkMoveDown,
  bulkMoveUp,
  bulkOutdent,
  bulkRemoveNodes,
  bulkUpdateNodeData,
  canIndentNode,
  canMoveNodeDown,
  canMoveNodeUp,
  canOutdentNode,
  cloneWithNewIds,
  filterTree,
  flattenVisibleTree,
  getNode,
  getTopLevelSelection,
  indentNode,
  isContiguousSiblingBlock,
  moveNodeDown,
  moveNodeUp,
  outdentNode,
  reorderTree,
  rmNode,
  updateNodeDataById,
} from "@features/tasks/utils/tree_control";

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

  test("filterTree keeps name filter scoped to the name column", () => {
    const tree = createTree();
    tree.children[0].data.memo = [{ id: "m1", title: "Note", content: "ship", tags: [] }];

    const filtered = filterTree(tree, { name: ["ship"] });

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("task-2");
  });

  test("filterTree supports full-text search separately from column filters", () => {
    const filtered = filterTree(createTree(), { full_text: ["progress"] });

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("task-1");
  });

  test("filterTree treats space-separated full-text query as AND search", () => {
    const tree = createTree();

    // "ship release" matches task-2 ("Ship release") — both tokens present
    const both = filterTree(tree, { full_text: ["ship release"] });
    expect(both.children).toHaveLength(1);
    expect(both.children[0].id).toBe("task-2");

    // Order does not matter for AND
    const reversed = filterTree(tree, { full_text: ["release ship"] });
    expect(reversed.children).toHaveLength(1);
    expect(reversed.children[0].id).toBe("task-2");

    // No single task contains both "ship" and "tests"
    expect(filterTree(tree, { full_text: ["ship tests"] })).toBeNull();
  });

  test("filterTree treats double-quoted substrings as a single phrase", () => {
    const tree = createTree();

    // Quoted phrase requires the contiguous "ship release" substring
    const quoted = filterTree(tree, { full_text: ['"ship release"'] });
    expect(quoted.children).toHaveLength(1);
    expect(quoted.children[0].id).toBe("task-2");

    // Quoted phrase in the wrong order does NOT match (because the space matters)
    expect(filterTree(tree, { full_text: ['"release ship"'] })).toBeNull();

    // Mixed: phrase + standalone token must both match within the same node
    // task-2 has name "Ship release" AND status "Pending"
    expect(filterTree(tree, { full_text: ['"ship release" pending'] }).children[0].id).toBe(
      "task-2"
    );
    expect(filterTree(tree, { full_text: ['"ship release" missing'] })).toBeNull();
  });

  test("filterTree can include memo content in full-text search", () => {
    const tree = createTree();
    tree.children[0].data.memo = [{ id: "m1", title: "Note", content: "launch notes", tags: [] }];

    expect(filterTree(tree, { full_text: ["launch"] })).toBeNull();

    const filtered = filterTree(tree, { full_text: ["launch"], search_memo: ["1"] });

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("task-1");
  });

  test("filterTree with tags filter keeps only tasks whose memos contain the tag", () => {
    const tree = {
      id: "root",
      data: { name: "Root", status: "Open", memo: [] },
      children: [
        {
          id: "task-a",
          data: {
            name: "Task A",
            status: "Open",
            memo: [{ id: "m1", title: "Note", content: "text", tags: ["design"] }],
          },
          children: [],
        },
        {
          id: "task-b",
          data: {
            name: "Task B",
            status: "Open",
            memo: [{ id: "m2", title: "Note", content: "text", tags: ["backend"] }],
          },
          children: [],
        },
      ],
    };

    const filtered = filterTree(tree, { tags: ["design"] });

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("task-a");
  });

  test("filterTree with tags filter does not expand children of matching parent", () => {
    const tree = {
      id: "root",
      data: { name: "Root", status: "Open", memo: [] },
      children: [
        {
          id: "task-parent",
          data: {
            name: "Parent",
            status: "Open",
            memo: [{ id: "m1", title: "Note", content: "text", tags: ["design"] }],
          },
          children: [
            {
              id: "task-child",
              data: { name: "Child", status: "Open", memo: [] },
              children: [],
            },
          ],
        },
      ],
    };

    const filtered = filterTree(tree, { tags: ["design"] });

    // Parent matches, but child has no tag — child should not be included
    expect(filtered.children[0].id).toBe("task-parent");
    expect(filtered.children[0].children).toHaveLength(0);
  });

  test("filterTree with tags filter returns null when no task matches", () => {
    const tree = {
      id: "root",
      data: { name: "Root", status: "Open", memo: [] },
      children: [
        {
          id: "task-a",
          data: {
            name: "Task A",
            status: "Open",
            memo: [{ id: "m1", title: "Note", content: "text", tags: ["frontend"] }],
          },
          children: [],
        },
      ],
    };

    const filtered = filterTree(tree, { tags: ["design"] });

    expect(filtered).toBeNull();
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

function createFlatTree() {
  // root -> [A, B, C, D]
  return {
    id: "root",
    data: {
      name: "root",
      status: "Open",
      "start date": undefined,
      "due date": undefined,
      memo: [],
    },
    children: ["A", "B", "C", "D"].map((id) => ({
      id,
      data: {
        name: id,
        status: "Open",
        "start date": undefined,
        "due date": undefined,
        memo: [],
      },
      children: [],
    })),
  };
}

describe("bulk operations", () => {
  test("bulkUpdateNodeData patches multiple ids and skips non-selected", () => {
    const tree = createFlatTree();
    const updated = bulkUpdateNodeData(tree, new Set(["A", "C"]), { status: "Completed" });

    expect(getNode("A", updated).data.status).toBe("Completed");
    expect(getNode("B", updated).data.status).toBe("Open");
    expect(getNode("C", updated).data.status).toBe("Completed");
    expect(getNode("D", updated).data.status).toBe("Open");
    expect(updated).not.toBe(tree);
  });

  test("bulkUpdateNodeData is a no-op when no patched field would change", () => {
    const tree = createFlatTree();
    const updated = bulkUpdateNodeData(tree, new Set(["A"]), { status: "Open" });
    expect(updated).toBe(tree);
  });

  test("bulkUpdateNodeData skips clearing fields already empty", () => {
    const tree = createFlatTree();
    const updated = bulkUpdateNodeData(tree, new Set(["A", "B"]), { "due date": undefined });
    expect(updated).toBe(tree);
  });

  test("bulkUpdateNodeData applies clear when at least one node has a value", () => {
    const tree = createFlatTree();
    tree.children[0].data["due date"] = "2026-05-01";

    const updated = bulkUpdateNodeData(tree, new Set(["A", "B"]), { "due date": undefined });
    expect(getNode("A", updated).data["due date"]).toBeUndefined();
    // B is still no-op but the operation as a whole produced a new tree.
    expect(updated).not.toBe(tree);
  });

  test("bulkRemoveNodes removes multiple siblings in one traversal", () => {
    const tree = createFlatTree();
    const updated = bulkRemoveNodes(tree, new Set(["B", "D"]));
    expect(updated.children.map((c) => c.id)).toEqual(["A", "C"]);
  });

  test("bulkRemoveNodes silently skips when only root is requested", () => {
    const tree = createFlatTree();
    const updated = bulkRemoveNodes(tree, new Set(["root"]));
    expect(updated).toBe(tree);
  });

  test("bulkRemoveNodes removes selected but never the root, even if root id is included", () => {
    const tree = createFlatTree();
    const updated = bulkRemoveNodes(tree, new Set(["root", "B"]));
    // root must survive at the top; B should be removed.
    expect(updated.id).toBe("root");
    expect(updated.children.map((c) => c.id)).toEqual(["A", "C", "D"]);
  });

  test("areAllSiblings is true for same-parent ids and false otherwise", () => {
    const tree = createFlatTree();
    expect(areAllSiblings(tree, new Set(["A", "B"]))).toBe(true);
    expect(areAllSiblings(tree, new Set(["A"]))).toBe(true);
    expect(areAllSiblings(tree, new Set(["A", "root"]))).toBe(false);
    expect(areAllSiblings(tree, new Set())).toBe(false);
  });

  test("isContiguousSiblingBlock detects contiguous runs", () => {
    const tree = createFlatTree();
    expect(isContiguousSiblingBlock(tree, new Set(["A", "B"]))).toBe(true);
    expect(isContiguousSiblingBlock(tree, new Set(["B", "C", "D"]))).toBe(true);
    expect(isContiguousSiblingBlock(tree, new Set(["A", "C"]))).toBe(false);
    expect(isContiguousSiblingBlock(tree, new Set(["A", "D"]))).toBe(false);
  });

  test("getTopLevelSelection drops descendants whose ancestor is also selected", () => {
    const tree = createTree();
    const top = getTopLevelSelection(tree, new Set(["task-2", "task-2-1"]));
    expect(top).toEqual(["task-2"]);
  });

  test("getTopLevelSelection preserves DFS order across separate subtrees", () => {
    const tree = createTree();
    const top = getTopLevelSelection(tree, new Set(["task-2-1", "task-1"]));
    expect(top).toEqual(["task-1", "task-2-1"]);
  });

  test("bulkMoveUp shifts a contiguous block up by one position", () => {
    const tree = createFlatTree();
    bulkMoveUp(new Set(["B", "C"]), tree);
    expect(tree.children.map((c) => c.id)).toEqual(["B", "C", "A", "D"]);
  });

  test("bulkMoveUp is a no-op when the block starts at index 0", () => {
    const tree = createFlatTree();
    bulkMoveUp(new Set(["A", "B"]), tree);
    expect(tree.children.map((c) => c.id)).toEqual(["A", "B", "C", "D"]);
  });

  test("bulkMoveUp is a no-op for non-contiguous selection", () => {
    const tree = createFlatTree();
    bulkMoveUp(new Set(["A", "C"]), tree);
    expect(tree.children.map((c) => c.id)).toEqual(["A", "B", "C", "D"]);
  });

  test("bulkMoveDown shifts a contiguous block down by one position", () => {
    const tree = createFlatTree();
    bulkMoveDown(new Set(["A", "B"]), tree);
    expect(tree.children.map((c) => c.id)).toEqual(["C", "A", "B", "D"]);
  });

  test("bulkMoveDown is a no-op when the block ends at the last index", () => {
    const tree = createFlatTree();
    bulkMoveDown(new Set(["C", "D"]), tree);
    expect(tree.children.map((c) => c.id)).toEqual(["A", "B", "C", "D"]);
  });

  test("bulkIndent left-to-right nests selected siblings under non-selected predecessor", () => {
    const tree = createFlatTree();
    const { new_parent_ids } = bulkIndent(new Set(["B", "D"]), tree);

    expect(tree.children.map((c) => c.id)).toEqual(["A", "C"]);
    expect(getNode("A", tree).children.map((c) => c.id)).toEqual(["B"]);
    expect(getNode("C", tree).children.map((c) => c.id)).toEqual(["D"]);
    expect(new_parent_ids).toEqual(["A", "C"]);
  });

  test("bulkIndent skips the first selected sibling when no predecessor exists", () => {
    const tree = createFlatTree();
    const { new_parent_ids } = bulkIndent(new Set(["A", "B"]), tree);
    // A has no predecessor; B becomes a child of A. C and D are untouched.
    expect(tree.children.map((c) => c.id)).toEqual(["A", "C", "D"]);
    expect(getNode("A", tree).children.map((c) => c.id)).toEqual(["B"]);
    expect(new_parent_ids).toEqual(["A"]);
  });

  test("bulkIndent is a no-op when selection is not all siblings", () => {
    const tree = createTree();
    const { tree_data, new_parent_ids } = bulkIndent(new Set(["task-1", "task-2-1"]), tree);
    expect(tree_data).toBe(tree);
    expect(new_parent_ids).toEqual([]);
  });

  test("bulkOutdent right-to-left preserves order in grandparent", () => {
    const tree = createTree();
    // Build a parent with three children, all selected for outdent
    tree.children[1].children.push(
      {
        id: "task-2-2",
        data: { name: "B", status: "Open", "due date": undefined, memo: [] },
        children: [],
      },
      {
        id: "task-2-3",
        data: { name: "C", status: "Open", "due date": undefined, memo: [] },
        children: [],
      }
    );
    // task-2 children = [task-2-1, task-2-2, task-2-3]; outdent all 3 to root.
    bulkOutdent(new Set(["task-2-1", "task-2-2", "task-2-3"]), tree);
    // After outdent, root.children should contain task-1, task-2 (now empty), then the outdented trio in order.
    expect(tree.children.map((c) => c.id)).toEqual([
      "task-1",
      "task-2",
      "task-2-1",
      "task-2-2",
      "task-2-3",
    ]);
    expect(tree.children[1].children).toHaveLength(0);
  });

  test("bulkOutdent is a no-op when shared parent is root (no grandparent)", () => {
    const tree = createFlatTree();
    const result = bulkOutdent(new Set(["A", "B"]), tree);
    expect(result).toBe(tree);
    expect(tree.children.map((c) => c.id)).toEqual(["A", "B", "C", "D"]);
  });

  test("bulkAddNodes inserts the array in DFS order at target", () => {
    const tree = createFlatTree();
    const extras = [
      {
        id: "X",
        data: { name: "X", status: "Open", "due date": undefined, memo: [] },
        children: [],
      },
      {
        id: "Y",
        data: { name: "Y", status: "Open", "due date": undefined, memo: [] },
        children: [],
      },
    ];
    bulkAddNodes(extras, "B", tree, "insert_after");
    expect(tree.children.map((c) => c.id)).toEqual(["A", "B", "X", "Y", "C", "D"]);
  });

  test("bulkAddNodes append target = node id, pushes into target.children", () => {
    const tree = createFlatTree();
    const extras = [
      {
        id: "X",
        data: { name: "X", status: "Open", "due date": undefined, memo: [] },
        children: [],
      },
    ];
    bulkAddNodes(extras, "A", tree, "append");
    expect(getNode("A", tree).children.map((c) => c.id)).toEqual(["X"]);
  });

  test("bulkDuplicate clones each node with fresh ids", () => {
    const tree = createTree();
    const dup = bulkDuplicate([getNode("task-2", tree)]);
    expect(dup).toHaveLength(1);
    expect(dup[0].id).not.toBe("task-2");
    expect(dup[0].children[0].id).not.toBe("task-2-1");
    expect(dup[0].data.name).toBe("Ship release");
  });
});

describe("buildStickyTrail", () => {
  // Builds a tree like:
  //   Root
  //   ├── A
  //   │   ├── A1
  //   │   ├── A2
  //   │   └── A3
  //   ├── B
  //   │   ├── B1
  //   │   └── B2
  //   └── C
  function makeStickyTree() {
    const node = (id, children = []) => ({
      id,
      data: { name: id, status: "Open", "due date": undefined, memo: [] },
      children,
    });
    return node("Root", [
      node("A", [node("A1"), node("A2"), node("A3")]),
      node("B", [node("B1"), node("B2")]),
      node("C"),
    ]);
  }

  const ROW_HEIGHT = 40;

  function namesOf(trail) {
    return trail.map((row) => row.node.data.name);
  }

  test("returns empty array when nothing is visible", () => {
    expect(buildStickyTrail([], 0, ROW_HEIGHT)).toEqual([]);
  });

  test("returns empty array when row height is zero or negative", () => {
    const rows = flattenVisibleTree(makeStickyTree());
    expect(buildStickyTrail(rows, 100, 0)).toEqual([]);
    expect(buildStickyTrail(rows, 100, -1)).toEqual([]);
  });

  test("hides the trail at the very top (only root in scope)", () => {
    const rows = flattenVisibleTree(makeStickyTree());
    // scrollTop=0: topmost-visible row is A (depth 1); only ancestor would
    // be the root, so the breadcrumb is suppressed.
    expect(buildStickyTrail(rows, 0, ROW_HEIGHT)).toEqual([]);
  });

  test("shows parent path when topmost-visible row is a descendant of covered row", () => {
    const rows = flattenVisibleTree(makeStickyTree());
    // Flattened order: Root, A, A1, A2, A3, B, B1, B2, C
    // scrollTop=1*rowHeight covers A; topmost-visible = A1; ancestors of A1 = [Root, A]
    expect(namesOf(buildStickyTrail(rows, 1 * ROW_HEIGHT, ROW_HEIGHT))).toEqual(["Root", "A"]);
  });

  test("does NOT show sibling row when topmost-visible is a sibling of covered row", () => {
    const rows = flattenVisibleTree(makeStickyTree());
    // scrollTop=2*rowHeight covers A1; topmost-visible = A2 (sibling of A1).
    // Before fix this produced ["Root", "A", "A1"] — A1 is a sibling, not an ancestor.
    const trail = buildStickyTrail(rows, 2 * ROW_HEIGHT, ROW_HEIGHT);
    expect(namesOf(trail)).toEqual(["Root", "A"]);
    expect(namesOf(trail)).not.toContain("A1");
  });

  test("switches scope when scrolling across subtrees", () => {
    const rows = flattenVisibleTree(makeStickyTree());
    // scrollTop=4*rowHeight covers A3 (last child of A); topmost-visible = B.
    // B has no meaningful parents (only root), so the trail is hidden.
    expect(buildStickyTrail(rows, 4 * ROW_HEIGHT, ROW_HEIGHT)).toEqual([]);

    // scrollTop=5*rowHeight covers B; topmost-visible = B1 → ["Root", "B"].
    expect(namesOf(buildStickyTrail(rows, 5 * ROW_HEIGHT, ROW_HEIGHT))).toEqual(["Root", "B"]);
  });

  test("handles fractional scrollTop the same as the floor row boundary", () => {
    const rows = flattenVisibleTree(makeStickyTree());
    // scrollTop slightly past 2 rows still covers A1 → trail computed from A2.
    const trail = buildStickyTrail(rows, 2 * ROW_HEIGHT + 17, ROW_HEIGHT);
    expect(namesOf(trail)).toEqual(["Root", "A"]);
  });

  test("clamps to the last row when scrollTop exceeds content", () => {
    const rows = flattenVisibleTree(makeStickyTree());
    // Far past the end: topmost-visible is clamped to the last row (C, depth 1).
    // C's only ancestor is the root, so the trail is suppressed.
    expect(buildStickyTrail(rows, 99 * ROW_HEIGHT, ROW_HEIGHT)).toEqual([]);
  });

  test("respects collapsed nodes: skips hidden descendants entirely", () => {
    const rows = flattenVisibleTree(makeStickyTree(), new Set(["A"]));
    // With A collapsed, A's children (A1, A2, A3) are not in the rows.
    // Flattened: Root, A, B, B1, B2, C
    // scrollTop=2*rowHeight covers B; topmost-visible = B1; ancestors = [Root, B].
    expect(namesOf(buildStickyTrail(rows, 2 * ROW_HEIGHT, ROW_HEIGHT))).toEqual(["Root", "B"]);
  });

  test("respects collapsed nodes: covered=collapsed node has no descendants to leak", () => {
    const rows = flattenVisibleTree(makeStickyTree(), new Set(["A"]));
    // Flattened: Root, A, B, B1, B2, C
    // scrollTop=1*rowHeight covers A; topmost-visible = B (depth 1 → trail hidden).
    expect(buildStickyTrail(rows, 1 * ROW_HEIGHT, ROW_HEIGHT)).toEqual([]);
  });

  test("respects filtered trees: traversal only sees rows present in the filtered view", () => {
    // Filter the tree by name "A1". filterTree keeps A (because A1 is a
    // matching descendant) but drops A2, A3 and all of B's / C's subtrees.
    // Resulting tree: Root → A → A1
    const filtered = filterTree(makeStickyTree(), { name: ["A1"] });
    const rows = flattenVisibleTree(filtered);
    // Flattened: Root, A, A1
    // scrollTop=1*rowHeight covers A; topmost-visible = A1; ancestors = [Root, A].
    expect(namesOf(buildStickyTrail(rows, 1 * ROW_HEIGHT, ROW_HEIGHT))).toEqual(["Root", "A"]);
  });

  test("trail length grows with subtree depth", () => {
    const deepTree = {
      id: "Root",
      data: { name: "Root", status: "Open", "due date": undefined, memo: [] },
      children: [
        {
          id: "L1",
          data: { name: "L1", status: "Open", "due date": undefined, memo: [] },
          children: [
            {
              id: "L2",
              data: { name: "L2", status: "Open", "due date": undefined, memo: [] },
              children: [
                {
                  id: "L3",
                  data: { name: "L3", status: "Open", "due date": undefined, memo: [] },
                  children: [
                    {
                      id: "leaf",
                      data: {
                        name: "leaf",
                        status: "Open",
                        "due date": undefined,
                        memo: [],
                      },
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const rows = flattenVisibleTree(deepTree);
    // Flattened: Root, L1, L2, L3, leaf
    // scrollTop=3*rowHeight covers L3; topmost-visible = leaf; ancestors = [Root, L1, L2, L3].
    expect(namesOf(buildStickyTrail(rows, 3 * ROW_HEIGHT, ROW_HEIGHT))).toEqual([
      "Root",
      "L1",
      "L2",
      "L3",
    ]);
  });

  test("a precomputed id→row map yields the same trail as the internal build", () => {
    // TreeTable passes a rows-memoized map so scrolling does not rebuild it per
    // frame; the precomputed-map path must match the self-contained path.
    const rows = flattenVisibleTree(makeStickyTree());
    const rowById = new Map(rows.map((row) => [row.id, row]));
    for (const scrollTop of [0, 1 * ROW_HEIGHT, 2 * ROW_HEIGHT, 5 * ROW_HEIGHT]) {
      const withMap = buildStickyTrail(rows, scrollTop, ROW_HEIGHT, rowById);
      const withoutMap = buildStickyTrail(rows, scrollTop, ROW_HEIGHT);
      expect(namesOf(withMap)).toEqual(namesOf(withoutMap));
    }
    // Spot-check an expected value so the equality above isn't vacuous.
    expect(namesOf(buildStickyTrail(rows, 1 * ROW_HEIGHT, ROW_HEIGHT, rowById))).toEqual([
      "Root",
      "A",
    ]);
  });
});
