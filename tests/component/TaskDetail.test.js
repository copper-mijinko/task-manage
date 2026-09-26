import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("@features/memos/components/Memo.svelte", async () => {
  const mod = await import("../mocks/MemoStub.svelte");
  return { default: mod.default };
});

import TaskDetail from "@features/tasks/components/TaskDetail.svelte";
import { selected_id, table_selected_id } from "@stores";
import { clearSelection } from "@stores/ui";
import { renderWithGraph, settle } from "../helpers/render_with_graph.js";
import { TEST_WORKSPACE } from "../helpers/graph_backend.js";

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
        {
          id: "task-2",
          data: { name: "Second Task", status: "Pending", body: "", format: "markdown" },
          children: [],
        },
      ],
    },
  };
}

let project;
let backend;
async function renderDetail(props = {}, tree = project) {
  const result = await renderWithGraph(TaskDetail, { tree, props });
  backend = result.backend;
  return result;
}

const specAttachment = {
  id: "spec",
  name: "spec.pdf",
  relativePath: "assets/task-1/spec.pdf",
  size: 4,
};

describe("TaskDetail", () => {
  beforeEach(() => {
    delete window.__memoStubSaveOnDestroy;
    project = createProjectData();
    clearSelection();
    table_selected_id.set(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__memoStubSaveOnDestroy;
    delete window.electronAPI;
  });

  test("shows a placeholder when no task is selected", async () => {
    await renderDetail();

    expect(screen.getByText("ノードを選択してください")).toBeInTheDocument();
  });

  test("starts with a reading overview and loads the body on demand", async () => {
    table_selected_id.set("task-1");
    await renderDetail();
    expect(screen.getByRole("tab", { name: "概要" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("memo-stub")).toBeNull();
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));
    expect(screen.getByTestId("memo-stub")).toBeInTheDocument();
  });

  test("opens the selected task detail from the card header action", async () => {
    table_selected_id.set("task-2");
    await renderDetail();

    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "別Windowで開く" }));
    await tick();

    expect(backend.api.openTaskDetailWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: TEST_WORKSPACE,
        projectId: "project-1",
        taskId: "task-2",
        taskName: "Second Task",
        requestedAtEpochMs: expect.any(Number),
      })
    );
  });

  test("retains the active tab across node selections without changing node records", async () => {
    table_selected_id.set("task-1");
    await renderDetail();
    const before = JSON.stringify(backend.graph());
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));
    table_selected_id.set("task-2");
    await tick();
    expect(screen.getByRole("tab", { name: "本文" })).toHaveAttribute("aria-selected", "true");
    expect(JSON.stringify(backend.graph())).toBe(before);
    await fireEvent.click(screen.getByRole("tab", { name: "概要" }));
    expect(screen.getByRole("button", { name: "編集", exact: true })).toBeInTheDocument();
  });

  test("shows a contextual title and omits the separate-window action when requested", async () => {
    table_selected_id.set("task-1");
    await renderDetail({
      titleOverride: "Sample Project / First Task",
      showOpenWindowAction: false,
    });
    expect(
      screen.getByRole("heading", { name: "Sample Project / First Task" })
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    expect(screen.queryByRole("menuitem", { name: "別Windowで開く" })).toBeNull();
  });

  test("adds a file attachment to the node", async () => {
    table_selected_id.set("task-1");
    const { container } = await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));
    const input = container.querySelector('[data-testid="attachment-file-input"]');
    const file = new File(["spec"], "spec.pdf", { type: "application/pdf" });

    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(backend.api.wsSaveGraphAsset).toHaveBeenCalledWith(
        TEST_WORKSPACE,
        "task-1",
        "spec.pdf",
        expect.any(Uint8Array)
      );
      expect(backend.node("task-1").attachments).toEqual([
        expect.objectContaining({ name: "spec.pdf", relativePath: "assets/task-1/spec.pdf" }),
      ]);
    });
  });

  test("opens the file picker from the attachment button", async () => {
    table_selected_id.set("task-1");
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

    await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));

    await fireEvent.click(screen.getByRole("button", { name: "添付を追加" }));

    expect(clickSpy).toHaveBeenCalled();
  });

  test("adds attachments by drag and drop", async () => {
    table_selected_id.set("task-1");
    await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));
    const file = new File(["drop"], "drop.txt", { type: "text/plain" });

    await fireEvent.drop(screen.getByTestId("task-attachments"), {
      dataTransfer: { files: [file], types: ["Files"], dropEffect: "" },
    });

    await waitFor(() => {
      expect(backend.node("task-1").attachments).toEqual([
        expect.objectContaining({ name: "drop.txt", relativePath: "assets/task-1/drop.txt" }),
      ]);
    });
  });

  test("opens attachment actions from the context menu", async () => {
    project.data.children[0].data.attachments = [specAttachment];
    table_selected_id.set("task-1");
    await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));

    await fireEvent.contextMenu(screen.getByTitle("spec.pdf"), { clientX: 24, clientY: 32 });
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: /^開く$/ }));

    expect(backend.api.wsOpenGraphAsset).toHaveBeenCalledWith(
      TEST_WORKSPACE,
      "task-1",
      "assets/task-1/spec.pdf",
      false
    );

    await fireEvent.contextMenu(screen.getByTitle("spec.pdf"), { clientX: 24, clientY: 32 });
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: "プログラムから開く" }));

    expect(backend.api.wsOpenGraphAsset).toHaveBeenLastCalledWith(
      TEST_WORKSPACE,
      "task-1",
      "assets/task-1/spec.pdf",
      true
    );
  });

  test("removes an attachment from the node after confirmation", async () => {
    project.data.children[0].data.attachments = [specAttachment];
    table_selected_id.set("task-1");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));
    await fireEvent.click(screen.getByRole("button", { name: "添付を削除 spec.pdf" }));

    await waitFor(() => {
      expect(backend.node("task-1").attachments).toEqual([]);
    });
    confirmSpy.mockRestore();
  });

  test("edits task detail fields independent of visible table columns", async () => {
    table_selected_id.set("task-1");
    await renderDetail();
    await fireEvent.click(screen.getByRole("button", { name: "編集", exact: true }));

    await fireEvent.input(screen.getByLabelText("ノード名"), {
      target: { value: "Updated Task" },
    });
    await fireEvent.blur(screen.getByLabelText("ノード名"));
    await settle();

    await fireEvent.click(screen.getByLabelText("ステータス"));
    await fireEvent.click(screen.getByRole("option", { name: /進行中/ }));
    await settle();
    await fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-06-01" },
    });
    await settle();
    await fireEvent.change(screen.getByLabelText("期限日"), {
      target: { value: "2026-06-10" },
    });
    await settle();

    const task = backend.node("task-1");
    expect(task.name).toBe("Updated Task");
    expect(task.status).toBe("In Progress");
    expect(task.startDate).toBe("2026-06-01");
    expect(task.dueDate).toBe("2026-06-10");
    // メモ数の欄は撤去した（メモは子ノードになり、ツリーで見える）。
    expect(screen.queryByLabelText("メモ数")).not.toBeInTheDocument();
  });

  // ── 本文 ──────────────────────────────────────────────────────────
  // ノードは 1 つの本文を持ち、それが保存され、形式を変えられる。

  test("本文を編集するとノードの body に入る", async () => {
    project.data.children[0].data.format = "markdown";
    table_selected_id.set("task-1");
    await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

    await fireEvent.click(screen.getByTestId("memo-save"));
    await settle();

    expect(backend.node("task-1").body).toBe("edited");
  });

  test("本文の形式を変えるときは、情報が落ちうることを確認する", async () => {
    project.data.children[0].data.body = { ops: [{ insert: "hello\n" }] };
    project.data.children[0].data.format = "quill";
    table_selected_id.set("task-1");

    await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "形式を変換" }));

    expect(screen.getByText(/情報が損なわれる可能性/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "変換する" }));
    await settle();

    expect(backend.node("task-1").format).toBe("markdown");
    expect(backend.node("task-1").body).toBe("hello");
    expect(screen.getByTestId("memo-stub")).toHaveAttribute("data-format", "markdown");
  });

  test("本文が空なら、確認を出さずにそのまま形式を変える", async () => {
    project.data.children[0].data.body = "";
    project.data.children[0].data.format = "markdown";
    table_selected_id.set("task-1");

    await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "形式を変換" }));
    await settle();

    expect(screen.queryByText(/情報が損なわれる可能性/)).not.toBeInTheDocument();
    expect(backend.node("task-1").format).toBe("quill");
  });

  // 実際にあったバグの型。形式を変えた直後、前のエディタが破棄されるときに
  // 遅れて保存してくると、変換後の形式を古い中身で踏み潰してしまう。
  test("形式を変えた直後に前のエディタが保存しても、変換後の形式が残る", async () => {
    project.data.children[0].data.body = "before";
    project.data.children[0].data.format = "markdown";
    table_selected_id.set("task-1");
    window.__memoStubSaveOnDestroy = "stale markdown save";

    await renderDetail();
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "形式を変換" }));
    await fireEvent.click(screen.getByRole("button", { name: "変換する" }));
    await settle();

    expect(backend.node("task-1").format).toBe("quill");
    expect(backend.node("task-1").body).toEqual({ ops: [{ insert: "stale markdown save\n" }] });
    expect(screen.getByTestId("memo-stub")).toHaveAttribute("data-format", "quill");
  });

  // 開いているプロジェクトを切り替えた直後に、前のプロジェクトで編集した名前の
  // 保存が遅れて届いても、別のノードへ書き込まない。
  test("プロジェクトを切り替えたあとに、前のプロジェクトでの名前の変更を適用しない", async () => {
    table_selected_id.set("task-1");
    await renderDetail();
    await fireEvent.click(screen.getByRole("button", { name: "編集", exact: true }));
    await fireEvent.input(screen.getByLabelText("ノード名"), {
      target: { value: "Typed before switching" },
    });

    selected_id.set("task-2");
    await new Promise((resolve) => setTimeout(resolve, 600));
    await settle();

    expect(backend.node("task-1").name).toBe("First Task");
  });
});
