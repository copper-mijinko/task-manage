import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("@features/memos/components/Memo.svelte", async () => {
  const mod = await import("../mocks/MemoStub.svelte");
  return { default: mod.default };
});

import TaskDetail from "@features/tasks/components/TaskDetail.svelte";
import { selected_id, selected_type, table_selected_id, tree_data, workspace_store } from "@stores";
import { clearSelection } from "@stores/ui";

function createProjectData() {
  return {
    headers: [
      { name: "name", default_ratio: 10 },
      { name: "status", default_ratio: 4 },
      { name: "due date", default_ratio: 4 },
    ],
    data: {
      id: "project-1",
      data: {
        name: "Sample Project",
        status: "Open",
        "due date": undefined,
      },
      children: [
        {
          id: "task-1",
          data: {
            name: "First Task",
            status: "Open",
            "due date": undefined,
          },
          children: [],
        },
        {
          id: "task-2",
          data: {
            name: "Second Task",
            status: "Pending",
            "due date": undefined,
            body: "",
            format: "markdown",
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
    vi.restoreAllMocks();
    delete window.__memoStubSaveOnDestroy;
    delete window.electronAPI;
  });

  test("shows a placeholder when no task is selected", () => {
    render(TaskDetail);

    expect(screen.getByText("タスクを選択してください")).toBeInTheDocument();
  });

  // タブが無くなったので「メモはまだありません」という空状態も無くなった。
  // ノードは常に本文を 1 つ持ち、いつでも書き始められる。
  test("選択したノードには常に本文エディタが出る", () => {
    table_selected_id.set("task-1");
    render(TaskDetail);

    expect(screen.getByTestId("memo-stub")).toBeInTheDocument();
    expect(screen.getByText("本文")).toBeInTheDocument();
    expect(screen.getByText("First Task")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "メモを追加" })).not.toBeInTheDocument();
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
        requestedAtEpochMs: expect.any(Number),
      })
    );
  });

  test("collapses task fields to keep the memo pane wide", async () => {
    table_selected_id.set("task-1");
    const { container } = render(TaskDetail);

    const body = container.querySelector(".task-detail-card-body");
    const collapseButton = screen.getByRole("button", {
      name: "詳細欄をたたんでメモを広げる",
    });
    expect(collapseButton).toHaveAttribute("aria-pressed", "false");

    await fireEvent.click(collapseButton);
    await tick();

    expect(body).toHaveClass("detail-mini");
    expect(screen.getByRole("button", { name: "詳細欄を表示" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    table_selected_id.set("task-2");
    await tick();

    expect(body).toHaveClass("detail-mini");

    await fireEvent.click(screen.getByRole("button", { name: "詳細欄を表示" }));
    await tick();

    expect(body).not.toHaveClass("detail-mini");
    expect(screen.getByRole("button", { name: "詳細欄をたたんでメモを広げる" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  test("keeps the split boundary available while details are collapsed", async () => {
    table_selected_id.set("task-1");
    const { container } = render(TaskDetail);
    const body = container.querySelector(".task-detail-card-body");

    await fireEvent.click(screen.getByRole("button", { name: "詳細欄をたたんでメモを広げる" }));
    await tick();

    const separator = screen.getByRole("separator", {
      name: "タスク詳細とメモの高さを変更",
    });
    expect(body).toHaveClass("detail-mini");
    expect(separator).toHaveAttribute("aria-valuenow", "0");
    expect(separator).toHaveAttribute(
      "aria-valuetext",
      "詳細欄をたたんでいます。下へドラッグすると表示できます"
    );
    expect(getComputedStyle(separator).display).not.toBe("none");

    await fireEvent.keyDown(separator, { key: "Enter" });
    await tick();

    expect(body).not.toHaveClass("detail-mini");
    expect(separator).toHaveAttribute(
      "aria-valuetext",
      "ドラッグして詳細欄とメモ欄の高さを変更できます"
    );
  });

  test("uses a path title and hides the open-window action in the dedicated detail window layout", async () => {
    table_selected_id.set("task-1");
    const { container } = render(TaskDetail, {
      props: {
        titleOverride: "Sample Project / First Task",
        showOpenWindowAction: false,
      },
    });

    expect(screen.getByText("Sample Project / First Task")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "詳細欄をたたんでメモを広げる" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "タスク詳細を別ウィンドウで開く" })).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "詳細欄をたたんでメモを広げる" }));
    await tick();

    expect(container.querySelector(".task-detail-card-body")).toHaveClass("detail-mini");
  });

  test("選択したノードの本文だけを読みに行く", async () => {
    const project = createProjectData();
    project.data.children[1].data.body = "";
    project.data.children[1].data.bodyLoaded = false;
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
      wsReadTaskBody: vi.fn().mockResolvedValue({
        body: "Loaded node body",
        format: "markdown",
      }),
    };

    render(TaskDetail);

    await waitFor(() => {
      expect(window.electronAPI.wsReadTaskBody).toHaveBeenCalledWith(
        "C:\\workspace\\project-1",
        "task-2"
      );
      expect(screen.getByTestId("memo-stub")).toHaveTextContent("Loaded node body");
    });
    expect(get(tree_data).data.children[1].data.bodyLoaded).toBe(true);
  });

  test("adds a file attachment to a workspace task", async () => {
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:\\workspace",
      activeProjectDir: "C:\\workspace\\project-1",
      projects: [],
    });
    selected_type.set("WorkspaceProject");
    table_selected_id.set("task-1");
    window.electronAPI = {
      wsSaveTaskAttachment: vi.fn().mockResolvedValue({
        success: true,
        attachment: {
          id: "./attachments/spec.pdf",
          name: "spec.pdf",
          relativePath: "./attachments/spec.pdf",
          size: 4,
        },
      }),
    };

    const { container } = render(TaskDetail);
    const input = container.querySelector('[data-testid="attachment-file-input"]');
    const file = new File(["spec"], "spec.pdf", { type: "application/pdf" });

    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(window.electronAPI.wsSaveTaskAttachment).toHaveBeenCalledWith(
        "C:\\workspace\\project-1",
        "task-1",
        "spec.pdf",
        expect.any(Uint8Array)
      );
      expect(get(tree_data).data.children[0].data.attachments).toEqual([
        expect.objectContaining({ name: "spec.pdf", relativePath: "./attachments/spec.pdf" }),
      ]);
    });
  });

  test("opens the file picker from the attachment button", async () => {
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:\\workspace",
      activeProjectDir: "C:\\workspace\\project-1",
      projects: [],
    });
    selected_type.set("WorkspaceProject");
    table_selected_id.set("task-1");
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "添付を追加" }));

    expect(clickSpy).toHaveBeenCalled();
  });

  test("adds attachments by drag and drop", async () => {
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:\\workspace",
      activeProjectDir: "C:\\workspace\\project-1",
      projects: [],
    });
    selected_type.set("WorkspaceProject");
    table_selected_id.set("task-1");
    window.electronAPI = {
      wsSaveTaskAttachment: vi.fn().mockResolvedValue({
        success: true,
        attachment: {
          id: "./attachments/drop.txt",
          name: "drop.txt",
          relativePath: "./attachments/drop.txt",
          size: 4,
        },
      }),
    };

    render(TaskDetail);
    const file = new File(["drop"], "drop.txt", { type: "text/plain" });

    await fireEvent.drop(screen.getByTestId("task-attachments"), {
      dataTransfer: {
        files: [file],
        types: ["Files"],
        dropEffect: "",
      },
    });

    await waitFor(() => {
      expect(window.electronAPI.wsSaveTaskAttachment).toHaveBeenCalledWith(
        "C:\\workspace\\project-1",
        "task-1",
        "drop.txt",
        expect.any(Uint8Array)
      );
      expect(get(tree_data).data.children[0].data.attachments).toEqual([
        expect.objectContaining({ name: "drop.txt", relativePath: "./attachments/drop.txt" }),
      ]);
    });
  });

  test("opens attachment actions from the context menu", async () => {
    const project = createProjectData();
    project.data.children[0].data.attachments = [
      {
        id: "./attachments/spec.pdf",
        name: "spec.pdf",
        relativePath: "./attachments/spec.pdf",
        size: 4,
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
    table_selected_id.set("task-1");
    window.electronAPI = {
      wsOpenTaskAttachment: vi.fn().mockResolvedValue({ success: true }),
      wsOpenTaskAttachmentWith: vi.fn().mockResolvedValue({ success: true }),
    };

    render(TaskDetail);

    await fireEvent.contextMenu(screen.getByTitle("spec.pdf"), { clientX: 24, clientY: 32 });
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: /^開く$/ }));

    expect(window.electronAPI.wsOpenTaskAttachment).toHaveBeenCalledWith(
      "C:\\workspace\\project-1",
      "task-1",
      "./attachments/spec.pdf"
    );

    await fireEvent.contextMenu(screen.getByTitle("spec.pdf"), { clientX: 24, clientY: 32 });
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: "プログラムから開く" }));

    expect(window.electronAPI.wsOpenTaskAttachmentWith).toHaveBeenCalledWith(
      "C:\\workspace\\project-1",
      "task-1",
      "./attachments/spec.pdf"
    );
  });

  test("opens and deletes a workspace task attachment", async () => {
    const project = createProjectData();
    project.data.children[0].data.attachments = [
      {
        id: "./attachments/spec.pdf",
        name: "spec.pdf",
        relativePath: "./attachments/spec.pdf",
        size: 4,
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
    table_selected_id.set("task-1");
    window.electronAPI = {
      wsOpenTaskAttachment: vi.fn().mockResolvedValue({ success: true }),
      wsDeleteTaskAttachment: vi.fn().mockResolvedValue({ success: true, attachments: [] }),
    };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(TaskDetail);

    await fireEvent.click(screen.getByTitle("spec.pdf"));
    expect(window.electronAPI.wsOpenTaskAttachment).toHaveBeenCalledWith(
      "C:\\workspace\\project-1",
      "task-1",
      "./attachments/spec.pdf"
    );

    await fireEvent.click(screen.getByRole("button", { name: "添付を削除 spec.pdf" }));

    await waitFor(() => {
      expect(window.electronAPI.wsDeleteTaskAttachment).toHaveBeenCalledWith(
        "C:\\workspace\\project-1",
        "task-1",
        "./attachments/spec.pdf"
      );
      expect(get(tree_data).data.children[0].data.attachments).toEqual([]);
    });
    confirmSpy.mockRestore();
  });

  test("edits task detail fields independent of visible table columns", async () => {
    table_selected_id.set("task-1");
    render(TaskDetail);

    await fireEvent.input(screen.getByLabelText("タスク名"), {
      target: { value: "Updated Task" },
    });
    await fireEvent.blur(screen.getByLabelText("タスク名"));
    await tick();

    await fireEvent.click(screen.getByLabelText("ステータス"));
    await fireEvent.click(screen.getByRole("option", { name: /進行中/ }));
    await fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-06-01" },
    });
    await fireEvent.change(screen.getByLabelText("期限日"), {
      target: { value: "2026-06-10" },
    });
    await tick();

    const task = get(tree_data).data.children[0].data;
    expect(task.name).toBe("Updated Task");
    expect(task.status).toBe("In Progress");
    expect(task["start date"]).toBe("2026-06-01");
    expect(task["due date"]).toBe("2026-06-10");
    // メモ数の欄は撤去した（メモは子ノードになり、ツリーで見える）。
    expect(screen.queryByLabelText("メモ数")).not.toBeInTheDocument();
  });

  // ── 本文（旧メモタブ）──────────────────────────────────────────────
  // タブ・複製・並べ替え・タブごとのタグは、メモがノードになったことで
  // 「子ノードを足す / 動かす / タグを付ける」に置き換わった。ここで確かめる
  // のは、ノードが 1 つの本文を持ち、それが保存され、形式を変えられること。

  test("本文を編集するとノードの body に入る", async () => {
    const project = createProjectData();
    project.data.children[0].data.format = "markdown";
    tree_data.set(project);
    table_selected_id.set("task-1");
    render(TaskDetail);

    await fireEvent.click(screen.getByTestId("memo-save"));
    await tick();

    expect(get(tree_data).data.children[0].data.body).toBe("edited");
  });

  test("本文の形式を変えるときは、情報が落ちうることを確認する", async () => {
    const project = createProjectData();
    project.data.children[0].data.body = { ops: [{ insert: "hello\n" }] };
    project.data.children[0].data.format = "quill";
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "Markdown形式を使用" }));

    expect(screen.getByText(/情報が損なわれる可能性/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    const data = get(tree_data).data.children[0].data;
    expect(data.format).toBe("markdown");
    expect(data.body).toBe("hello");
    expect(screen.getByTestId("memo-stub")).toHaveAttribute("data-format", "markdown");
  });

  test("本文が空なら、確認を出さずにそのまま形式を変える", async () => {
    const project = createProjectData();
    project.data.children[0].data.body = "";
    project.data.children[0].data.format = "markdown";
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "Quill形式を使用" }));
    await tick();

    expect(screen.queryByText(/情報が損なわれる可能性/)).not.toBeInTheDocument();
    expect(get(tree_data).data.children[0].data.format).toBe("quill");
  });

  // 実際にあったバグの型。形式を変えた直後、前のエディタが破棄されるときに
  // 遅れて保存してくると、変換後の形式を古い中身で踏み潰してしまう。
  test("形式を変えた直後に前のエディタが保存しても、変換後の形式が残る", async () => {
    const project = createProjectData();
    project.data.children[0].data.body = "before";
    project.data.children[0].data.format = "markdown";
    tree_data.set(project);
    table_selected_id.set("task-1");
    window.__memoStubSaveOnDestroy = "stale markdown save";

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "Quill形式を使用" }));
    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    const data = get(tree_data).data.children[0].data;
    expect(data.format).toBe("quill");
    expect(screen.getByTestId("memo-stub")).toHaveAttribute("data-format", "quill");
  });

  // 保存先を切り替えた直後に、前の保存先向けの保存が遅れて届くことがある。
  // id が同じでも、別の保存先の内容を書き換えてはいけない。
  test("保存先を切り替えたあとに、前の保存先の本文保存を適用しない", async () => {
    const workspaceProject = createProjectData();
    workspaceProject.data.children[0].data.body = "workspace old";

    const projectsProject = createProjectData();
    projectsProject.data.children[0].data.body = "project old";

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
    await tick();
    expect(get(tree_data).data.children[0].data.body).toBe("edited");

    selected_type.set("Projects");
    selected_id.set("project-1");
    tree_data.set(projectsProject);
    table_selected_id.set("task-1");

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(get(tree_data).data.children[0].data.body).toBe("project old");
  });
});
