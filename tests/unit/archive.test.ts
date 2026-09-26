import { describe, expect, test } from "vitest";
import { restoreNode, type TreeData } from "@features/tasks/utils/tree_control";

function nodeData(name: string) {
  return {
    name,
    status: "Open" as const,
    "start date": undefined,
    "due date": undefined,
    memo: [],
  };
}

function makeTree(): TreeData {
  return {
    id: "root",
    data: nodeData("Root"),
    children: [
      {
        id: "a",
        data: nodeData("A"),
        children: [
          { id: "a1", data: nodeData("A1"), children: [] },
          { id: "a2", data: nodeData("A2"), children: [] },
        ],
      },
      { id: "b", data: nodeData("B"), children: [] },
      { id: "c", data: nodeData("C"), children: [] },
    ],
  };
}

describe("archive / restore tree helpers", () => {
  test("restoreNode は archived でないノードに対しては no-op", () => {
    const tree = makeTree();
    const before = tree.children.map((c) => c.id);
    restoreNode("b", tree);
    expect(tree.children.map((c) => c.id)).toEqual(before);
  });
});
