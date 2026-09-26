import { describe, it, expect } from "vitest";

import {
  normalizeTag,
  normalizeTagList,
  withTagAdded,
  withTagRemoved,
} from "../../src/lib/utils/tags";
import { filterTree } from "../../src/features/tasks/utils/tree_control";

describe("tag helpers (renderer)", () => {
  it("normalizes case, whitespace and leading hashes", () => {
    expect(normalizeTag("  #Frontend ")).toBe("frontend");
  });

  it("keeps tag lists unique", () => {
    expect(normalizeTagList(["a", "A", " a ", "b"])).toEqual(["a", "b"]);
    expect(normalizeTagList("not an array")).toEqual([]);
  });

  it("adds and removes without mutating the input", () => {
    const tags = ["a"];
    expect(withTagAdded(tags, "B")).toEqual(["a", "b"]);
    expect(withTagAdded(tags, "a")).toEqual(["a"]);
    expect(withTagRemoved(["a", "b"], "A")).toEqual(["b"]);
    expect(tags).toEqual(["a"]);
  });
});

describe("filterTree with the tags filter", () => {
  const node = (id, name, extra = {}) => ({
    id,
    data: {
      name,
      status: "Open",
      "start date": undefined,
      "due date": undefined,
      memo: [],
      ...extra,
    },
    children: [],
  });

  it("matches a tag on the task itself", () => {
    const tree = { ...node("root", "Root"), children: [node("a", "A", { tags: ["frontend"] })] };
    const result = filterTree(tree, { tags: ["frontend"] });
    expect(result.children.map((child) => child.id)).toEqual(["a"]);
  });

  // メモがノードになったので、タグの付いた記録は「タグの付いた子ノード」に
  // なる。親ではなくその子が一致する。
  it("子ノードに付いたタグで、その子ノードが残る", () => {
    const tree = {
      ...node("root", "Root"),
      children: [{ ...node("a", "A"), children: [node("m", "m", { tags: ["ops"] })] }],
    };
    const result = filterTree(tree, { tags: ["ops"] });
    expect(result.children.map((c) => c.id)).toEqual(["a"]);
    expect(result.children[0].children.map((c) => c.id)).toEqual(["m"]);
  });

  it("ignores case differences between filter and task tag", () => {
    const tree = { ...node("root", "Root"), children: [node("a", "A", { tags: ["Frontend"] })] };
    expect(filterTree(tree, { tags: ["frontend"] }).children.map((c) => c.id)).toEqual(["a"]);
  });
});
