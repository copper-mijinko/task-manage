import {
  filterTree,
  flattenVisibleTree,
  getNode,
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
});
