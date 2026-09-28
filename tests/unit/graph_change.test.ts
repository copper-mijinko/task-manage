import { describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import {
  changedNodeNames,
  describeHistoryStep,
} from "../../src/features/workspace/utils/graph_change";
import { dismissNotice, notice, showNotice } from "../../src/stores/notice";

describe("graph_change", () => {
  const spec = { name: "Spec", status: "Open" };
  const build = { name: "Build" };

  test("names nodes that were added, removed or changed", () => {
    const before = { nodes: { spec, build } };
    const after = { nodes: { spec: { ...spec, status: "Completed" }, idea: { name: "Idea" } } };
    expect(changedNodeNames(before, after).sort()).toEqual(["Build", "Idea", "Spec"]);
    expect(changedNodeNames(before, { nodes: { spec, build } })).toEqual([]);
  });

  test("describes an undo or redo step", () => {
    const before = { nodes: { spec, build } };
    expect(
      describeHistoryStep("undo", before, { nodes: { spec: { ...spec, name: "S2" }, build } })
    ).toBe("元に戻しました：「S2」");
    expect(describeHistoryStep("redo", before, { nodes: {} })).toBe(
      "やり直しました：「Spec」 ほか 1 件"
    );
    expect(describeHistoryStep("undo", before, before)).toBe("元に戻しました");
  });
});

describe("notice", () => {
  test("shows one notice at a time and hides it after the timeout", () => {
    vi.useFakeTimers();
    showNotice("first");
    const id = showNotice("second", { timeout: 1000 });
    expect(get(notice)?.message).toBe("second");
    vi.advanceTimersByTime(1001);
    expect(get(notice)).toBeNull();
    showNotice("third");
    dismissNotice(id);
    expect(get(notice)?.message).toBe("third");
    dismissNotice();
    expect(get(notice)).toBeNull();
    vi.useRealTimers();
  });
});
