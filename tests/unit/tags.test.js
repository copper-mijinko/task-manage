import { get } from "svelte/store";
import { beforeEach, describe, expect, test } from "vitest";
import { active_tag, tag_index } from "@features/memos/stores/tags";

describe("tag stores", () => {
  beforeEach(() => {
    tag_index.set(new Map([["design", new Set(["task-1"])]]));
    active_tag.set(null);
  });

  test("keeps the active tag while the index still has it", () => {
    active_tag.set("design");
    tag_index.set(new Map([["design", new Set(["task-2"])]]));
    expect(get(active_tag)).toBe("design");
  });

  test("clears the active tag when no node carries it any more", () => {
    active_tag.set("design");
    tag_index.set(new Map());
    expect(get(active_tag)).toBeNull();
  });
});
