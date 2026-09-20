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

    expect(screen.getByText("ノードを選択してください")).toBeInTheDocument();
  });

  test("starts with a reading overview and loads the body on demand", async () => {
    table_selected_id.set("task-1");
    render(TaskDetail);
    expect(screen.getByRole("tab", { name: "概要" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("memo-stub")).toBeNull();
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));
    expect(screen.getByTestId("memo-stub")).toBeInTheDocument();
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

    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "別Windowで開く" }));
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

  test("retains the active tab across node selections without changing node records", async () => {
    table_selected_id.set("task-1");
    render(TaskDetail);
    const before = JSON.stringify(get(tree_data));
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));
    table_selected_id.set("task-2");
    await tick();
    expect(screen.getByRole("tab", { name: "本文" })).toHaveAttribute("aria-selected", "true");
    expect(JSON.stringify(get(tree_data))).toBe(before);
    await fireEvent.click(screen.getByRole("tab", { name: "概要" }));
    expect(screen.getByRole("button", { name: "編集", exact: true })).toBeInTheDocument();
  });
  test("shows a contextual title and omits the separate-window action when requested", async () => {
    table_selected_id.set("task-1");
    render(TaskDetail, {
      props: { titleOverride: "Sample Project / First Task", showOpenWindowAction: false },
    });
    expect(
      screen.getByRole("heading", { name: "Sample Project / First Task" })
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    expect(screen.queryByRole("menuitem", { name: "別Windowで開く" })).toBeNull();
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
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

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
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));
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
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));

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
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));
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
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));

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
    await fireEvent.click(screen.getByRole("tab", { name: /添付/ }));

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
    await fireEvent.click(screen.getByRole("button", { name: "編集", exact: true }));

    await fireEvent.input(screen.getByLabelText("ノード名"), {
      target: { value: "Updated Task" },
    });
    await fireEvent.blur(screen.getByLabelText("ノード名"));
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
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

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
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "形式を変換" }));

    expect(screen.getByText(/情報が損なわれる可能性/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "変換する" }));
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
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "形式を変換" }));
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
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

    await fireEvent.click(screen.getByRole("button", { name: "ノード詳細の操作" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "形式を変換" }));
    await fireEvent.click(screen.getByRole("button", { name: "変換する" }));
    await tick();

    const data = get(tree_data).data.children[0].data;
    expect(data.format).toBe("quill");
    expect(data.body).toEqual({ ops: [{ insert: "stale markdown save\n" }] });
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
    await fireEvent.click(screen.getByRole("tab", { name: "本文" }));

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
