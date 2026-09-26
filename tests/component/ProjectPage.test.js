import { fireEvent, screen } from "@testing-library/svelte";
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
import { active_row_path, ganttVisible, table_selected_id, ui_density } from "@stores";
import { clearSelection, selectOnly, selected_ids } from "@stores/ui";
import { renderWithGraph, settle } from "../helpers/render_with_graph.js";

function createProjectData() {
  return {
    data: {
      id: "project-1",
      data: { name: "Sample Project", status: "Open" },
      children: [
        {
          id: "task-1",
          data: { name: "First Task", status: "Open" },
          children: [],
        },
      ],
    },
  };
}

let project;
let backend;
let app;
async function renderPage(tree = project) {
  const result = await renderWithGraph(ProjectPage, { tree });
  backend = result.backend;
  app = result.application;
  return result;
}

/** 行を選んだのと同じ状態にする（選択と、操作中の行の経路）。 */
function selectRow(id, path) {
  selectOnly(id);
  active_row_path.set(path);
}

describe("ProjectPage", () => {
  beforeEach(() => {
    project = createProjectData();
    clearSelection();
    table_selected_id.set(undefined);
    active_row_path.set(undefined);
    ganttVisible.set(false);
    ui_density.set("comfortable");
  });

  test("adds a sibling node and selects it", async () => {
    selectRow("task-1", "project-1/task-1");
    const { container } = await renderPage();
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[0]);
    await settle();

    const children = backend.childrenOf("project-1");
    expect(children).toHaveLength(2);
    expect(backend.node(children[1]).name).toBe("新しいノード");
    expect(get(table_selected_id)).toBe(children[1]);
    expect(get(selected_ids)).toEqual(new Set([children[1]]));
  });

  test("adds the first node under the project root when nothing is selected", async () => {
    project.data.children = [];
    const { container } = await renderPage();
    clearSelection();
    await tick();
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[0]);
    await settle();

    const children = backend.childrenOf("project-1");
    expect(children).toHaveLength(1);
    expect(get(table_selected_id)).toBe(children[0]);
  });

  test("adds a top-level node from the primary add button when the root is selected", async () => {
    project.data.children = [];
    const { container } = await renderPage();
    selectRow("project-1", "project-1");
    await tick();
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[0]);
    await settle();

    const children = backend.childrenOf("project-1");
    expect(children).toHaveLength(1);
    expect(get(table_selected_id)).toBe(children[0]);
    expect(document.body.textContent).not.toMatch(/Cannot insert a sibling/);
  });

  test("adds a child node and expands the parent when it was collapsed", async () => {
    selectRow("task-1", "project-1/task-1");
    const { container } = await renderPage();
    app.closed.add("project-1/task-1");
    await tick();
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[1]);
    await settle();

    const children = backend.childrenOf("task-1");
    expect(children).toHaveLength(1);
    expect(backend.node(children[0]).name).toBe("新しいノード");
    expect(get(app.closed).has("project-1/task-1")).toBe(false);
    expect(get(table_selected_id)).toBe(children[0]);
  });

  test("disables archive when the project root is selected", async () => {
    await renderPage();
    selectRow("project-1", "project-1");
    await tick();

    // aria-label は「なぜ押せないか」ではなくボタンの名前を持つ。
    // 押せない理由は tooltip 側に出す。
    expect(screen.getByRole("button", { name: "アーカイブ" })).toBeDisabled();
  });

  test("disables tree operations that cannot change the selected node", async () => {
    project.data.children.push({
      id: "task-2",
      data: { name: "Last Task", status: "Open" },
      children: [],
    });
    await renderPage();
    selectRow("task-1", "project-1/task-1");
    await tick();

    expect(screen.getByRole("button", { name: "上に移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下に移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "インデント" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "アウトデント" })).toBeDisabled();

    selectRow("task-2", "project-1/task-2");
    await tick();

    expect(screen.getByRole("button", { name: "上に移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下に移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "インデント" })).toBeEnabled();
  });

  test("keeps common tree operations visible and usable in compact mode", async () => {
    project.data.children.push({
      id: "task-2",
      data: { name: "Last Task", status: "Open" },
      children: [],
    });
    ui_density.set("compact");
    await renderPage();
    selectRow("task-1", "project-1/task-1");
    await tick();

    expect(screen.getByRole("button", { name: "上に移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下に移動" })).toBeEnabled();

    await fireEvent.click(screen.getByRole("button", { name: "下に移動" }));
    await settle();

    expect(backend.childrenOf("project-1")).toEqual(["task-2", "task-1"]);
    expect(screen.getByRole("button", { name: "上に移動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下に移動" })).toBeDisabled();
  });

  test("archives the selected node after confirmation (delete button = archive)", async () => {
    const { container } = await renderPage();
    selectRow("task-1", "project-1/task-1");
    await tick();
    const buttons = container.querySelectorAll(".TbGroup button");

    await fireEvent.click(buttons[2]);
    expect(
      screen.getByText((content) => content.includes("アーカイブしますか"))
    ).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "アーカイブする" }));
    await settle();

    // ノードは物理削除されず archived フラグだけが立つ（論理削除）。
    expect(backend.node("task-1").archived).toBe(true);
    expect(get(table_selected_id)).toBeUndefined();
  });

  test("toggles the right detail pane", async () => {
    await renderPage();

    expect(screen.getByTestId("task-detail-stub")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "表示と操作" }));
    await fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "詳細欄", checked: true }));

    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "表示と操作" }));
    await fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "詳細欄", checked: false }));

    expect(screen.getByTestId("task-detail-stub")).toBeInTheDocument();
  });

  // 一括変換の対象は「本文を持つノード」。多親ノードは 1 回だけ数える。
  test("プロジェクト全体の本文を、確認のあと Markdown へ一括変換する", async () => {
    project.data.children[0].data.body = { ops: [{ insert: "launch\n" }] };
    project.data.children[0].data.format = "quill";
    project.data.children.push({
      id: "task-2",
      data: { name: "Other", status: "Open" },
      children: [project.data.children[0]],
    });

    await renderPage();

    await fireEvent.click(screen.getByRole("button", { name: "表示と操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "全メモをMarkdownへ変換" }));
    expect(screen.getByText("変換対象（1件）")).toBeInTheDocument();
    expect(screen.getByText("First Task")).toBeInTheDocument();
    expect(screen.getByText(/情報が損なわれる可能性/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "変換", exact: true }));
    await settle();

    expect(backend.node("task-1").format).toBe("markdown");
    expect(backend.node("task-1").body).toBe("launch");
    expect(screen.getByText("変換済み（1件）")).toBeInTheDocument();
    expect(screen.getByText(/OK: First Task/)).toBeInTheDocument();
    expect(screen.getByText("変換が完了しました。")).toBeInTheDocument();
  });

  test("reports a failed bulk conversion", async () => {
    project.data.children[0].data.body = { ops: [{ insert: "launch\n" }] };
    project.data.children[0].data.format = "quill";
    await renderPage();
    backend.api.wsExecuteGraphCommand.mockRejectedValueOnce(new Error("Write failed"));

    await fireEvent.click(screen.getByRole("button", { name: "表示と操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "全メモをMarkdownへ変換" }));
    await fireEvent.click(screen.getByRole("button", { name: "変換", exact: true }));
    await settle();

    expect(screen.getByText(/Error: First Task/)).toBeInTheDocument();
    expect(backend.node("task-1").format).toBe("quill");
  });

  test("closes the right detail pane while the gantt panel remains visible", async () => {
    ganttVisible.set(true);

    await renderPage();

    expect(screen.getByTestId("gantt-panel-stub")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "表示と操作" }));
    await fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "詳細欄", checked: true }));

    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();
    expect(screen.getByTestId("gantt-panel-stub")).toBeInTheDocument();
  });
});
