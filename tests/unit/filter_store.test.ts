import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import { tree_data } from "@features/tasks/stores/tree";
import { filter, filtered_data } from "@features/search/stores/search";
import { selected_type } from "@stores/ui";

function projectData(taskName: string) {
  return {
    headers: [{ name: "name", default_ratio: 10 }],
    data: {
      id: "root-id",
      data: { name: "root", status: "Open", memo: [] },
      children: [
        { id: "task-1", data: { name: taskName, status: "Open", memo: [] }, children: [] },
      ],
    },
  };
}

const firstChildName = () => get(filtered_data)?.children?.[0]?.data?.name;

describe("filter store wiring", () => {
  beforeEach(() => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { getProjectIDs: vi.fn().mockResolvedValue([]) },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { getProjectIDs: vi.fn().mockResolvedValue([]) },
    });
  });

  // Regression guard for the removal of the redundant `filter.set(get(filter))`
  // calls from the tree store: filtered_data must keep tracking tree edits
  // purely through the filter store's own tree_data subscription.
  test("filtered_data tracks tree edits without an explicit filter re-set", () => {
    selected_type.set("Projects");
    filter.set({});
    filter.init();

    tree_data.set(projectData("Foo"));
    expect(firstChildName()).toBe("Foo");

    // Simulate an edit producing a new tree_data value. With no active filter
    // the filter store derives filtered_data synchronously.
    tree_data.set(projectData("Bar"));
    expect(firstChildName()).toBe("Bar");
  });
});
