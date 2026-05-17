import { get } from "svelte/store";
import { describe, expect, test, beforeEach } from "vitest";

import { active_tag, tag_index } from "@features/memos/stores/tags";
import { selected_type } from "@stores/ui";
import { tree_data } from "@features/tasks/stores/tree";

function createProjectData(tags = ["design"]) {
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
      children: [
        {
          id: "task-1",
          data: {
            name: "Task",
            status: "Open",
            "due date": undefined,
            memo: [{ id: "memo-1", title: "Memo", content: "", tags }],
          },
          children: [],
        },
      ],
    },
  };
}

describe("tag stores", () => {
  beforeEach(() => {
    active_tag.set(null);
    selected_type.set("Projects");
    tree_data.set(createProjectData());
  });

  test("indexes memo tags by task id", () => {
    expect(get(tag_index).get("design")).toEqual(new Set(["task-1"]));
  });

  test("clears the active tag when switching between project storage scopes", () => {
    active_tag.set("design");

    selected_type.set("WorkspaceProject");

    expect(get(active_tag)).toBeNull();
  });

  test("clears the active tag when it no longer exists in the current tag index", () => {
    active_tag.set("design");

    tree_data.set(createProjectData([]));

    expect(get(active_tag)).toBeNull();
  });
});
