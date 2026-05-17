import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("@lib/layouts/SplitPanes.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});

vi.mock("@features/tasks/components/TreeTable.svelte", async () => {
  const mod = await import("../mocks/TreeTableStub.svelte");
  return { default: mod.default };
});

vi.mock("@features/tasks/components/TaskDetail.svelte", async () => {
  const mod = await import("../mocks/TaskDetailStub.svelte");
  return { default: mod.default };
});

vi.mock("@features/gantt/components/GanttPanel.svelte", async () => {
  const mod = await import("../mocks/GanttPanelStub.svelte");
  return { default: mod.default };
});

import ProjectPage from "@pages/MainPage.svelte";
import { closed_node_ids, ganttVisible, selected_id, table_selected_id, tree_data } from "@stores";

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
      ],
    },
  };
}

describe("ProjectPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        setMetaData: vi.fn(),
      },
    });
    tree_data.set(createProjectData());
    selected_id.set("project-1");
    table_selected_id.set("task-1");
    closed_node_ids.set(new Set());
    ganttVisible.set(false);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  test("adds a sibling task and selects it", async () => {
    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[0]);
    await vi.runAllTimersAsync();
    await tick();

    expect(get(tree_data).data.children).toHaveLength(2);
    expect(get(tree_data).data.children[1].data.name).toBe("new_task");
    expect(get(table_selected_id)).toBe(get(tree_data).data.children[1].id);
  });

  test("adds the first task under the project root when nothing is selected", async () => {
    const data = createProjectData();
    data.data.children = [];
    tree_data.set(data);
    table_selected_id.set(undefined);

    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[0]);
    await vi.runAllTimersAsync();
    await tick();

    expect(get(tree_data).data.children).toHaveLength(1);
    expect(get(tree_data).data.children[0].data.name).toBe("new_task");
    expect(get(table_selected_id)).toBe(get(tree_data).data.children[0].id);
  });

  test("shows an alert when adding a sibling next to the project root", async () => {
    // Pressing the toolbar "insert after current" button while the user has
    // explicitly selected the root row is meaningless — the root has no
    // parent to receive a sibling. We surface that as a Dialog alert rather
    // than silently re-routing the add. The "add child" button (buttons[1])
    // remains the correct way to add a top-level task.
    const data = createProjectData();
    data.data.children = [];
    tree_data.set(data);
    table_selected_id.set("project-1");

    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[0]);
    await vi.runAllTimersAsync();
    await tick();

    // No task added — alert dialog shown instead.
    expect(get(tree_data).data.children).toHaveLength(0);
    expect(document.body.textContent).toMatch(/Cannot insert a sibling/);
  });

  test("adds a task under the project root via 子タスク追加 when the root is selected", async () => {
    const data = createProjectData();
    data.data.children = [];
    tree_data.set(data);
    table_selected_id.set("project-1");

    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    // buttons[1] is "子タスク追加" (append as child) which is the correct
    // way to add a child task to the root.
    await fireEvent.click(buttons[1]);
    await vi.runAllTimersAsync();
    await tick();

    expect(get(tree_data).data.children).toHaveLength(1);
    expect(get(tree_data).data.children[0].data.name).toBe("new_task");
    expect(get(table_selected_id)).toBe(get(tree_data).data.children[0].id);
  });

  test("adds a child task and expands the parent when it was collapsed", async () => {
    closed_node_ids.set(new Set(["task-1"]));

    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[1]);
    await vi.runAllTimersAsync();
    await tick();

    expect(get(tree_data).data.children[0].children).toHaveLength(1);
    expect(get(tree_data).data.children[0].children[0].data.name).toBe("new_task");
    expect(get(closed_node_ids).has("task-1")).toBe(false);
    expect(get(table_selected_id)).toBe(get(tree_data).data.children[0].children[0].id);
  });

  test("shows an alert when trying to delete the root node", async () => {
    table_selected_id.set("project-1");
    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[2]);

    expect(screen.getByText("Cannot delete the root node.")).toBeInTheDocument();
    expect(get(tree_data).data.children).toHaveLength(1);
  });

  test("removes the selected task after confirmation", async () => {
    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[2]);
    expect(
      screen.getByText((content) => content.includes("Do you really delete"))
    ).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    expect(get(tree_data).data.children).toHaveLength(0);
    expect(get(table_selected_id)).toBeUndefined();
  });

  test("toggles the right detail pane", async () => {
    render(ProjectPage);

    expect(screen.getByTestId("task-detail-stub")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Hide detail pane" }));

    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Show detail pane" }));

    expect(screen.getByTestId("task-detail-stub")).toBeInTheDocument();
  });

  test("bulk converts current project memos to Markdown after confirmation", async () => {
    const data = createProjectData();
    data.data.children[0].data.memo = [
      {
        id: "memo-quill",
        title: "Quill memo",
        content: { ops: [{ insert: "launch\n" }] },
        tags: [],
        format: "quill",
      },
    ];
    tree_data.set(data);

    render(ProjectPage);

    await fireEvent.click(screen.getByRole("button", { name: "全メモをMarkdownへ変換" }));
    expect(screen.getByText("Memos to convert (1)")).toBeInTheDocument();
    expect(screen.getByText("First Task / Quill memo")).toBeInTheDocument();
    expect(screen.getByText(/情報が損なわれる可能性/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await tick();

    const memo = get(tree_data).data.children[0].data.memo[0];
    expect(memo.format).toBe("markdown");
    expect(memo.content).toBe("launch");
    expect(screen.getByText("Converted (1)")).toBeInTheDocument();
    expect(screen.getByText(/OK: First Task \/ Quill memo/)).toBeInTheDocument();
    expect(screen.getByText("Conversion completed.")).toBeInTheDocument();
  });

  test("closes the right detail pane while the gantt panel remains visible", async () => {
    ganttVisible.set(true);

    render(ProjectPage);

    expect(screen.getByTestId("gantt-panel-stub")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Hide detail pane" }));

    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();
    expect(screen.getByTestId("gantt-panel-stub")).toBeInTheDocument();
  });
});
