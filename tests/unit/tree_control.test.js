import {
  areAllSiblings,
  buildStickyTrail,
  filterTree,
  sortTree,
  flattenVisibleTree,
  getNode,
  getTopLevelSelection,
  isContiguousSiblingBlock,
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

  test("filterTree ANDs multiple full_text array entries (chip-based search)", () => {
    const tree = createTree();

    // Each array entry is a separate chip; both "ship" and "release" must
    // match the same node, mirroring the single-string AND behavior above.
    const both = filterTree(tree, { full_text: ["ship", "release"] });
    expect(both.children).toHaveLength(1);
    expect(both.children[0].id).toBe("task-2");

    // Order of chips does not matter for AND
    const reversed = filterTree(tree, { full_text: ["release", "ship"] });
    expect(reversed.children).toHaveLength(1);
    expect(reversed.children[0].id).toBe("task-2");

    // No single task contains both "ship" and "tests"
    expect(filterTree(tree, { full_text: ["ship", "tests"] })).toBeNull();

    // A chip can itself contain multiple space-separated tokens (quoted phrase)
    // combined with another chip — all tokens across all chips must match.
    const mixed = filterTree(tree, { full_text: ['"ship release"', "pending"] });
    expect(mixed.children).toHaveLength(1);
    expect(mixed.children[0].id).toBe("task-2");
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

  test("filterTree can include node bodies in full-text search", () => {
    const tree = createTree();
    tree.children[0].data.body = "launch notes";

    expect(filterTree(tree, { full_text: ["launch"] })).toBeNull();

    const filtered = filterTree(tree, { full_text: ["launch"], search_memo: ["1"] });

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("task-1");
  });

  // 件数バッジを出す列は件数で絞り込める。以前は「メモ数」だけが絞り込めて、
  // 同じ件数列の「添付数」は絞り込めないという非対称があった。
  test("filterTree filters by attachment count range", () => {
    const tree = {
      id: "root",
      data: { name: "Root", status: "Open" },
      children: [
        { id: "none", data: { name: "None", status: "Open" }, children: [] },
        {
          id: "one",
          data: { name: "One", status: "Open", attachments: [{ name: "a" }] },
          children: [],
        },
        {
          id: "three",
          data: {
            name: "Three",
            status: "Open",
            attachments: [{ name: "a" }, { name: "b" }, { name: "c" }],
          },
          children: [],
        },
      ],
    };

    // 下限だけ
    expect(filterTree(tree, { attachments: ["1", ""] }).children.map((c) => c.id)).toEqual([
      "one",
      "three",
    ]);
    // 上限だけ。添付なしは 0 件として数える。
    expect(filterTree(tree, { attachments: ["", "1"] }).children.map((c) => c.id)).toEqual([
      "none",
      "one",
    ]);
    // 範囲
    expect(filterTree(tree, { attachments: ["2", "3"] }).children.map((c) => c.id)).toEqual([
      "three",
    ]);
    // 該当なし
    expect(filterTree(tree, { attachments: ["4", ""] })).toBeNull();
  });

  test("filterTree with tags filter keeps only nodes carrying the tag", () => {
    const tree = {
      id: "root",
      data: { name: "Root", status: "Open" },
      children: [
        {
          id: "task-a",
          data: { name: "Task A", status: "Open", tags: ["design"] },
          children: [],
        },
        {
          id: "task-b",
          data: { name: "Task B", status: "Open", tags: ["backend"] },
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
      data: { name: "Root", status: "Open" },
      children: [
        {
          id: "task-parent",
          data: { name: "Parent", status: "Open", tags: ["design"] },
          children: [
            {
              id: "task-child",
              data: { name: "Child", status: "Open" },
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

  test("flattenVisibleTree omits descendants of collapsed nodes", () => {
    // 折り畳みは経路（ルートからの `親id/子id`）で指定する。
    const rows = flattenVisibleTree(createTree(), new Set(["project-1/task-2"]));

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

  test("getNode returns undefined when the target does not exist", () => {
    expect(getNode("missing", createTree())).toBeUndefined();
  });
});

describe("filterTree full-path matching", () => {
  // root("tasks") -> one -> [aaa, bbb]
  //               -> two -> [ccc]
  function createPathTree() {
    return {
      id: "root",
      data: { name: "tasks", status: "Open", memo: [] },
      children: [
        {
          id: "one",
          data: { name: "one", status: "Open", memo: [] },
          children: [
            {
              id: "aaa",
              data: { name: "aaa", status: "Open", memo: [] },
              children: [],
            },
            {
              id: "bbb",
              data: { name: "bbb", status: "Open", memo: [] },
              children: [],
            },
          ],
        },
        {
          id: "two",
          data: { name: "two", status: "Open", memo: [] },
          children: [
            {
              id: "ccc",
              data: { name: "ccc", status: "Open", memo: [] },
              children: [],
            },
          ],
        },
      ],
    };
  }

  test("full_text AND-chips match a deep descendant via its ancestor path (tasks/one/aaa)", () => {
    const tree = createPathTree();
    // "tasks" only matches via the root ancestor name; "aaa" matches the
    // node's own name. Both must hold for the same node -> only aaa matches.
    const filtered = filterTree(tree, { full_text: ["tasks", "aaa"] });

    expect(filtered).not.toBeNull();
    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("one");
    expect(filtered.children[0].children).toHaveLength(1);
    expect(filtered.children[0].children[0].id).toBe("aaa");
  });

  test("full_text chip with no match in own fields or any ancestor still fails the node", () => {
    const tree = createPathTree();
    // "tasks" matches (root ancestor), but "missing" matches nothing anywhere.
    expect(filterTree(tree, { full_text: ["tasks", "missing"] })).toBeNull();
  });

  test("full_text path matching does not leak across sibling subtrees", () => {
    const tree = createPathTree();
    // "one" only appears in the "one" subtree's ancestor chain; "ccc" only
    // exists under "two". No single node's path+fields contains both.
    expect(filterTree(tree, { full_text: ["one", "ccc"] })).toBeNull();
  });

  test("name filter matches the node's own name directly (no regression)", () => {
    const tree = createPathTree();
    const filtered = filterTree(tree, { name: ["one"] });

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("one");
    // "one" matches directly, so its whole subtree is included as-is.
    expect(filtered.children[0].children.map((c) => c.id)).toEqual(["aaa", "bbb"]);
  });

  test("name filter also matches via an ancestor's name (full-path matching)", () => {
    const tree = createPathTree();
    // "aaa" doesn't match root/one's own names, but "tasks" matches the root.
    // Only a node whose own name OR ancestor chain contains "aaa" should show.
    const filtered = filterTree(tree, { name: ["aaa"] });

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("one");
    expect(filtered.children[0].children).toHaveLength(1);
    expect(filtered.children[0].children[0].id).toBe("aaa");
  });

  test("single-node matching still works unchanged when there is no nesting", () => {
    // No-regression check against the flat tree used elsewhere: matching a
    // top-level task's own name behaves exactly as before path matching.
    const filtered = filterTree(createTree(), { name: ["ship"] });
    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe("task-2");
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
    const rows = flattenVisibleTree(makeStickyTree(), new Set(["Root/A"]));
    // With A collapsed, A's children (A1, A2, A3) are not in the rows.
    // Flattened: Root, A, B, B1, B2, C
    // scrollTop=2*rowHeight covers B; topmost-visible = B1; ancestors = [Root, B].
    expect(namesOf(buildStickyTrail(rows, 2 * ROW_HEIGHT, ROW_HEIGHT))).toEqual(["Root", "B"]);
  });

  test("respects collapsed nodes: covered=collapsed node has no descendants to leak", () => {
    const rows = flattenVisibleTree(makeStickyTree(), new Set(["Root/A"]));
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

  test("a precomputed path→row map yields the same trail as the internal build", () => {
    // TreeTable passes a rows-memoized map so scrolling does not rebuild it per
    // frame; the precomputed-map path must match the self-contained path.
    // キーは経路（多親ノードは同じ id の行が複数あるため）。
    const rows = flattenVisibleTree(makeStickyTree());
    const rowByPath = new Map(rows.map((row) => [row.path, row]));
    for (const scrollTop of [0, 1 * ROW_HEIGHT, 2 * ROW_HEIGHT, 5 * ROW_HEIGHT]) {
      const withMap = buildStickyTrail(rows, scrollTop, ROW_HEIGHT, rowByPath);
      const withoutMap = buildStickyTrail(rows, scrollTop, ROW_HEIGHT);
      expect(namesOf(withMap)).toEqual(namesOf(withoutMap));
    }
    // Spot-check an expected value so the equality above isn't vacuous.
    expect(namesOf(buildStickyTrail(rows, 1 * ROW_HEIGHT, ROW_HEIGHT, rowByPath))).toEqual([
      "Root",
      "A",
    ]);
  });
});

test("attachment sorting treats absent lists as zero and keeps equal counts stable", () => {
  const child = (id, count) => ({
    id,
    data: {
      name: id,
      ...(count === undefined
        ? {}
        : { attachments: Array.from({ length: count }, (_, i) => ({ id: String(i) })) }),
    },
    children: [],
  });
  const tree = {
    id: "root",
    data: { name: "root" },
    children: [child("two", 2), child("missing"), child("one", 1), child("empty", 0)],
  };
  expect(
    sortTree(tree, { column: "attachments", direction: "asc" }).children.map((n) => n.id)
  ).toEqual(["missing", "empty", "one", "two"]);
  expect(
    sortTree(tree, { column: "attachments", direction: "desc" }).children.map((n) => n.id)
  ).toEqual(["two", "one", "missing", "empty"]);
  expect(tree.children.map((n) => n.id)).toEqual(["two", "missing", "one", "empty"]);
});

test("date sorting keeps rows without a date last in both directions", () => {
  const child = (id, due) => ({ id, data: { name: id, "due date": due }, children: [] });
  const tree = {
    id: "root",
    data: { name: "root" },
    children: [child("none"), child("late", "2026-10-20"), child("early", "2026-10-01")],
  };
  const order = (direction) =>
    sortTree(tree, { column: "due date", direction }).children.map((n) => n.id);
  expect(order("asc")).toEqual(["early", "late", "none"]);
  expect(order("desc")).toEqual(["late", "early", "none"]);
});
