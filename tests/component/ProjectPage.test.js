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
import {
  closed_row_paths,
  ganttVisible,
  selected_id,
  table_selected_id,
  tree_data,
  ui_density,
} from "@stores";
import { clearSelection, selected_ids } from "@stores/ui";

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
    clearSelection();
    table_selected_id.set("task-1");
    closed_row_paths.set(new Set());
    ganttVisible.set(false);
    ui_density.set("comfortable");
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
    expect(get(selected_ids)).toEqual(new Set([get(tree_data).data.children[1].id]));
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

  test("adds a top-level task from the primary add button when the root is selected", async () => {
    const data = createProjectData();
    data.data.children = [];
    tree_data.set(data);
    table_selected_id.set("project-1");

    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[0]);
    await vi.runAllTimersAsync();
    await tick();

    expect(get(tree_data).data.children).toHaveLength(1);
    expect(get(tree_data).data.children[0].data.name).toBe("new_task");
    expect(get(table_selected_id)).toBe(get(tree_data).data.children[0].id);
    expect(document.body.textContent).not.toMatch(/Cannot insert a sibling/);
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
    closed_row_paths.set(new Set(["task-1"]));

    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[1]);
    await vi.runAllTimersAsync();
    await tick();

    expect(get(tree_data).data.children[0].children).toHaveLength(1);
    expect(get(tree_data).data.children[0].children[0].data.name).toBe("new_task");
    expect(get(closed_row_paths).has("task-1")).toBe(false);
    expect(get(table_selected_id)).toBe(get(tree_data).data.children[0].children[0].id);
  });

  test("disables archive when the project root is selected", () => {
    table_selected_id.set("project-1");
    render(ProjectPage);

    expect(
      screen.getByRole("button", { name: "プロジェクトルートはアーカイブできません" })
    ).toBeDisabled();
    expect(get(tree_data).data.children).toHaveLength(1);
  });

  test("disables tree operations that cannot change the selected task", async () => {
    const data = createProjectData();
    data.data.children.push({
      id: "task-2",
      data: { name: "Last Task", status: "Open", "due date": undefined, memo: [] },
      children: [],
    });
    tree_data.set(data);
    render(ProjectPage);

    expect(screen.getByRole("button", { name: "上に移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下に移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "インデント" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "アウトデント" })).toBeDisabled();

    table_selected_id.set("task-2");
    await tick();

    expect(screen.getByRole("button", { name: "上に移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下に移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "インデント" })).toBeEnabled();
  });

  test("keeps common tree operations visible and usable in compact mode", async () => {
    const data = createProjectData();
    data.data.children.push({
      id: "task-2",
      data: { name: "Last Task", status: "Open", "due date": undefined, memo: [] },
      children: [],
    });
    tree_data.set(data);
    ui_density.set("compact");
    render(ProjectPage);

    expect(screen.getByRole("button", { name: "上に移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下に移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "インデント" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "アウトデント" })).toBeDisabled();

    await fireEvent.click(screen.getByRole("button", { name: "下に移動" }));
    await tick();

    expect(get(tree_data).data.children.map((task) => task.id)).toEqual(["task-2", "task-1"]);
    expect(screen.getByRole("button", { name: "上に移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下に移動" })).toBeDisabled();
  });

  test("archives the selected task after confirmation (delete button = archive)", async () => {
    const { container } = render(ProjectPage);
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[2]);
    expect(
      screen.getByText((content) => content.includes("アーカイブしますか"))
    ).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    // タスクは物理削除されず archived フラグだけが立つ（論理削除）。
    expect(get(tree_data).data.children).toHaveLength(1);
    expect(get(tree_data).data.children[0].archived).toBe(true);
    expect(get(table_selected_id)).toBeUndefined();
  });

  test("toggles the right detail pane", async () => {
    render(ProjectPage);

    expect(screen.getByTestId("task-detail-stub")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "詳細欄を隠す" }));

    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "詳細欄を表示" }));

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
    expect(screen.getByText("変換対象（1件）")).toBeInTheDocument();
    expect(screen.getByText("First Task / Quill memo")).toBeInTheDocument();
    expect(screen.getByText(/情報が損なわれる可能性/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "変換" }));
    await tick();

    const memo = get(tree_data).data.children[0].data.memo[0];
    expect(memo.format).toBe("markdown");
    expect(memo.content).toBe("launch");
    expect(screen.getByText("変換済み（1件）")).toBeInTheDocument();
    expect(screen.getByText(/OK: First Task \/ Quill memo/)).toBeInTheDocument();
    expect(screen.getByText("変換が完了しました。")).toBeInTheDocument();
  });

  test("closes the right detail pane while the gantt panel remains visible", async () => {
    ganttVisible.set(true);

    render(ProjectPage);

    expect(screen.getByTestId("gantt-panel-stub")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "詳細欄を隠す" }));

    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();
    expect(screen.getByTestId("gantt-panel-stub")).toBeInTheDocument();
  });
});
