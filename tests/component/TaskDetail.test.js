import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("../../src/components/Memo.svelte", async () => {
  const mod = await import("../mocks/MemoStub.svelte");
  return { default: mod.default };
});

import TaskDetail from "../../src/components/TaskDetail.svelte";
import { table_selected_id, tree_data } from "../../src/stores.ts";

function createProjectData() {
  return {
    headers: [
      { name: "name", default_ratio: 10 },
      { name: "status", default_ratio: 4 },
      { name: "due date", default_ratio: 4 },
      { name: "memo", default_ratio: 2 },
    ],
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
            name: "First Task",
            status: "Open",
            "due date": undefined,
            memo: [],
          },
          children: [],
        },
        {
          id: "task-2",
          data: {
            name: "Second Task",
            status: "Pending",
            "due date": undefined,
            memo: [{ title: "review", content: "" }],
          },
          children: [],
        },
      ],
    },
  };
}

describe("TaskDetail", () => {
  beforeEach(() => {
    tree_data.set(createProjectData());
    table_selected_id.set(undefined);
  });

  test("shows a placeholder when no task is selected", () => {
    render(TaskDetail);

    expect(screen.getByText("No data.")).toBeInTheDocument();
  });

  test("adds a memo tab to the selected task", async () => {
    table_selected_id.set("task-1");
    const { container } = render(TaskDetail);

    const buttons = container.querySelectorAll(".memotab-control button");
    await fireEvent.click(buttons[0]);
    await tick();

    expect(screen.getByDisplayValue("memo")).toBeInTheDocument();
    expect(get(tree_data).data.children[0].data.memo).toEqual([
      { title: "memo", content: "" },
    ]);
  });

  test("deletes the selected memo after confirmation", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [{ title: "draft", content: "" }];
    tree_data.set(project);
    table_selected_id.set("task-1");

    const { container } = render(TaskDetail);

    const buttons = container.querySelectorAll(".memotab-control button");
    await fireEvent.click(buttons[1]);
    expect(screen.getByText((content) => content.includes("Do you really delete"))).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    expect(get(tree_data).data.children[0].data.memo).toEqual([]);
    expect(screen.getByText("Tabs here")).toBeInTheDocument();
  });

  test("resets the selected memo tab when the selected task changes", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      { title: "draft", content: "" },
      { title: "notes", content: "" },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByDisplayValue("notes").closest("button"));
    expect(screen.getByDisplayValue("notes").closest("button")).toHaveClass("selected");

    table_selected_id.set("task-2");
    await tick();

    expect(screen.getByDisplayValue("review").closest("button")).toHaveClass("selected");
  });
});
