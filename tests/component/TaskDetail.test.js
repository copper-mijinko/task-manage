import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("@features/memos/components/Memo.svelte", async () => {
  const mod = await import("../mocks/MemoStub.svelte");
  return { default: mod.default };
});

import TaskDetail from "@features/tasks/components/TaskDetail.svelte";
import {
  selected_id,
  selected_type,
  table_selected_id,
  tag_index,
  tree_data,
  workspace_store,
} from "@stores";
import { clearSelection } from "@stores/ui";

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
    delete window.__memoStubSaveOnDestroy;
    selected_type.set("Projects");
    selected_id.set("project-1");
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
    tree_data.set(createProjectData());
    clearSelection();
    table_selected_id.set(undefined);
  });

  afterEach(() => {
    delete window.__memoStubSaveOnDestroy;
    delete window.electronAPI;
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
    expect(screen.getByRole("button", { name: "メモを追加" })).toBeInTheDocument();
    expect(screen.getByText("First Task")).toBeInTheDocument();
    expect(screen.queryByLabelText("Storage mode")).not.toBeInTheDocument();
  });

  test("opens the selected task detail from the card header action", async () => {
    window.electronAPI = { openTaskDetailWindow: vi.fn() };
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:\\workspace",
      activeProjectDir: "C:\\workspace\\project-1",
      projects: [],
    });
    selected_type.set("WorkspaceProject");
    table_selected_id.set("task-2");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "タスク詳細を別ウィンドウで開く" }));
    await tick();

    expect(window.electronAPI.openTaskDetailWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        taskId: "task-2",
        taskName: "Second Task",
        selectedType: "WorkspaceProject",
        projectDir: "C:\\workspace\\project-1",
      })
    );
  });

  test("hydrates workspace memo bodies for the selected task", async () => {
    const project = createProjectData();
    project.data.children[1].data.memo = [
      {
        id: "memo-review",
        title: "review",
        content: "",
        tags: [],
        format: "markdown",
        bodyLoaded: false,
      },
    ];
    tree_data.set(project);
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:\\workspace",
      activeProjectDir: "C:\\workspace\\project-1",
      projects: [],
    });
    selected_type.set("WorkspaceProject");
    table_selected_id.set("task-2");
    window.electronAPI = {
      wsReadTaskMemos: vi.fn().mockResolvedValue({
        memos: [
          {
            id: "memo-review",
            title: "review",
            content: "Loaded memo body",
            tags: [],
            format: "markdown",
            bodyLoaded: true,
          },
        ],
      }),
    };

    render(TaskDetail);

    await waitFor(() => {
      expect(window.electronAPI.wsReadTaskMemos).toHaveBeenCalledWith(
        "C:\\workspace\\project-1",
        "task-2"
      );
      expect(screen.getByTestId("memo-stub")).toHaveTextContent("Loaded memo body");
    });
    expect(get(tree_data).data.children[1].data.memo[0].bodyLoaded).toBe(true);
  });

  test("edits task detail fields independent of visible table columns", async () => {
    table_selected_id.set("task-1");
    render(TaskDetail);

    await fireEvent.input(screen.getByLabelText("Task name"), {
      target: { value: "Updated Task" },
    });
    await fireEvent.blur(screen.getByLabelText("Task name"));
    await tick();

    await fireEvent.click(screen.getByLabelText("Status"));
    await fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
    await fireEvent.change(screen.getByLabelText("Start Date"), {
      target: { value: "2026-06-01" },
    });
    await fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: "2026-06-10" },
    });
    await tick();

    const task = get(tree_data).data.children[0].data;
    expect(task.name).toBe("Updated Task");
    expect(task.status).toBe("In Progress");
    expect(task["start date"]).toBe("2026-06-01");
    expect(task["due date"]).toBe("2026-06-10");
    expect(screen.getByLabelText("Memo count")).toHaveTextContent("0");
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

  test("reorders memo tabs and writes the new order into task data", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      { id: "memo-first", title: "first", content: "" },
      { id: "memo-second", title: "second", content: "" },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    const firstTab = screen.getByRole("button", { name: "Select memo first" });
    const secondTab = screen.getByRole("button", { name: "Select memo second" });
    const dataTransfer = { effectAllowed: "", dropEffect: "" };
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: 0 },
    });

    secondTab.dispatchEvent(dragStart);
    firstTab.dispatchEvent(drop);
    await tick();

    expect(get(tree_data).data.children[0].data.memo.map((memo) => memo.id)).toEqual([
      "memo-second",
      "memo-first",
    ]);
  });

  test("saves memo tags immediately and updates the tag index", async () => {
    table_selected_id.set("task-2");
    render(TaskDetail);

    const tagInput = document.querySelector(".tag-input");
    await fireEvent.input(tagInput, { target: { value: "Design " } });
    await fireEvent.keyDown(tagInput, { key: "Enter" });
    await tick();

    expect(get(tree_data).data.children[1].data.memo[0].tags).toEqual(["design"]);
    expect(get(tag_index).get("design")).toEqual(new Set(["task-2"]));
    expect(screen.getByLabelText("Remove tag design")).toBeInTheDocument();
  });

  test("converts the selected memo format after warning", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      {
        id: "memo-quill",
        title: "quill",
        content: { ops: [{ insert: "hello\n" }] },
        tags: [],
        format: "quill",
      },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "Use Markdown memo format" }));

    expect(screen.getByText(/情報が損なわれる可能性/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    const memo = get(tree_data).data.children[0].data.memo[0];
    expect(memo.format).toBe("markdown");
    expect(memo.content).toBe("hello");
    expect(screen.getByRole("button", { name: "Use Markdown memo format" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByTestId("memo-stub")).toHaveAttribute("data-format", "markdown");
  });

  test("keeps the converted format when the previous editor saves during remount", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      {
        id: "memo-markdown",
        title: "markdown",
        content: "before",
        tags: [],
        format: "markdown",
      },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");
    window.__memoStubSaveOnDestroy = "stale markdown save";

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "Use Quill memo format" }));
    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    const memo = get(tree_data).data.children[0].data.memo[0];
    expect(memo.format).toBe("quill");
    expect(memo.content).toEqual({ ops: [{ insert: "stale markdown save\n" }] });
    expect(screen.getByRole("button", { name: "Use Quill memo format" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByTestId("memo-stub")).toHaveAttribute("data-format", "quill");
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
