import { get } from "svelte/store";
import { describe, expect, test } from "vitest";

import { filtered_data, filter } from "../../src/stores/search.ts";
import { tree_data } from "../../src/stores/tree.ts";

function createProjectData() {
  return {
    headers: [{ name: "name", default_ratio: 10 }],
    data: {
      id: "project-1",
      data: {
        name: "Sample Project",
        status: "Open",
        "due date": undefined,
        memo: [],
      },
      children: [],
    },
  };
}

describe("filter store", () => {
  test("updates visible tree data when tree_data changes without filter changes", () => {
    filter.init();
    filtered_data.set(undefined);
    filter.set({});

    tree_data.set(createProjectData());

    expect(get(filtered_data).id).toBe("project-1");
    expect(get(filtered_data).data.name).toBe("Sample Project");
  });
});
