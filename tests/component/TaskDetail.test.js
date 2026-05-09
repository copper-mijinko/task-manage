import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("../../src/components/Memo.svelte", async () => {
  const mod = await import("../mocks/MemoStub.svelte");
  return { default: mod.default };
});

import TaskDetail from "../../src/components/TaskDetail.svelte";
import {
  selected_id,
  selected_type,
  table_selected_id,
  tree_data,
  workspace_store,
} from "../../src/stores.ts";

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
            memo: [{ id: "memo-review", title: "review", content: "" }],
          },
          children: [],
        },
      ],
    },
  };
}

describe("TaskDetail", () => {
  beforeEach(() => {
    selected_type.set("Projects");
    selected_id.set("project-1");
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
    tree_data.set(createProjectData());
    table_selected_id.set(undefined);
  });

  test("shows a placeholder when no task is selected", () => {
    render(TaskDetail);

    expect(screen.getByText("No data.")).toBeInTheDocument();
  });

  test("shows the legacy memo tab placeholder when the selected task has no notes", () => {
    table_selected_id.set("task-1");
    render(TaskDetail);

    expect(screen.getByText("Tabs here")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("No page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a memo" })).toBeInTheDocument();
  });

  test("adds a memo tab to the selected task", async () => {
    table_selected_id.set("task-1");
    const { container } = render(TaskDetail);

    const buttons = container.querySelectorAll(".memotab-control button");
    await fireEvent.click(buttons[0]);
    await tick();

    expect(screen.getByRole("button", { name: "Select memo memo" })).toHaveClass("selected");
    expect(get(tree_data).data.children[0].data.memo).toEqual([
      expect.objectContaining({ title: "memo", content: "" }),
    ]);
  });

  test("deletes the selected memo after confirmation", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [{ id: "memo-draft", title: "draft", content: "" }];
    tree_data.set(project);
    table_selected_id.set("task-1");

    const { container } = render(TaskDetail);

    const buttons = container.querySelectorAll(".memotab-control button");
    await fireEvent.click(buttons[1]);
    expect(screen.getByText('Do you really delete "draft"?')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    expect(get(tree_data).data.children[0].data.memo).toEqual([]);
    expect(screen.getByText("Tabs here")).toBeInTheDocument();
  });

  test("creates the first memo from the tab add action", async () => {
    table_selected_id.set("task-1");
    const { container } = render(TaskDetail);

    const addButton = container.querySelectorAll(".memotab-control button")[0];
    await fireEvent.click(addButton);
    await tick();

    expect(screen.getByRole("button", { name: "Select memo memo" })).toHaveClass("selected");
    expect(get(tree_data).data.children[0].data.memo).toEqual([
      expect.objectContaining({ title: "memo", content: "" }),
    ]);
  });

  test("resets the selected memo tab when the selected task changes", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      { id: "memo-draft", title: "draft", content: "" },
      { id: "memo-notes", title: "notes", content: "" },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "Select memo notes" }));
    expect(screen.getByRole("button", { name: "Select memo notes" })).toHaveClass("selected");

    table_selected_id.set("task-2");
    await tick();

    expect(screen.getByRole("button", { name: "Select memo review" })).toHaveClass("selected");
  });

  test("shows empty content after switching from existing memo to new empty memo and back", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      { id: "memo-existing", title: "existing", content: "some content" },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    const { container } = render(TaskDetail);

    // Add a new empty memo
    const addButton = container.querySelectorAll(".memotab-control button")[0];
    await fireEvent.click(addButton);
    await tick();

    // Now on the new empty memo (index 1) - verify "memo" tab is selected
    expect(screen.getByRole("button", { name: "Select memo memo" })).toHaveClass("selected");

    // Switch to existing memo (index 0)
    await fireEvent.click(screen.getByRole("button", { name: "Select memo existing" }));
    await tick();
    expect(screen.getByRole("button", { name: "Select memo existing" })).toHaveClass("selected");

    // Switch back to the empty memo (index 1)
    await fireEvent.click(screen.getByRole("button", { name: "Select memo memo" }));
    await tick();

    expect(screen.getByRole("button", { name: "Select memo memo" })).toHaveClass("selected");
    // content should be empty string for the new empty memo
    expect(screen.getByTestId("memo-stub").textContent.trim()).toBe("");
  });

  test("does not apply a workspace memo save after switching to Projects with the same ids", async () => {
    const workspaceProject = createProjectData();
    workspaceProject.data.children[0].data.memo = [
      { id: "memo-shared", title: "shared", content: "workspace old" },
    ];

    const projectsProject = createProjectData();
    projectsProject.data.children[0].data.memo = [
      { id: "memo-shared", title: "shared", content: "project old" },
    ];

    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:\\workspace",
      activeProjectDir: "C:\\workspace\\project-1",
      projects: [],
    });
    selected_type.set("WorkspaceProject");
    selected_id.set("project-1");
    tree_data.set(workspaceProject);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByTestId("memo-save"));
    expect(get(tree_data).data.children[0].data.memo[0].content).toBe("edited");

    selected_type.set("Projects");
    selected_id.set("project-1");
    tree_data.set(projectsProject);
    table_selected_id.set("task-1");

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(get(tree_data).data.children[0].data.memo[0].content).toBe("project old");
  });
});
