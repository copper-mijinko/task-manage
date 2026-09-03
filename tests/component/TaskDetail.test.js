import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
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
    vi.restoreAllMocks();
    delete window.__memoStubSaveOnDestroy;
    delete window.electronAPI;
  });

  test("shows a placeholder when no task is selected", () => {
    render(TaskDetail);

    expect(screen.getByText("タスクを選択してください")).toBeInTheDocument();
  });

  test("shows an actionable empty state when the selected task has no notes", () => {
    table_selected_id.set("task-1");
    render(TaskDetail);

    expect(screen.getByText("メモはまだありません")).toBeInTheDocument();
    expect(screen.getByText("補足や記録を残すためのメモを追加できます。")).toBeInTheDocument();
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
    expect(screen.getByLabelText("メモ数")).toHaveTextContent("0");
  });

  test("adds a memo tab to the selected task", async () => {
    table_selected_id.set("task-1");
    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "メモを追加" }));
    await tick();

    expect(screen.getByRole("button", { name: "メモ「memo」を選択" })).toHaveClass("selected");
    expect(get(tree_data).data.children[0].data.memo).toEqual([
      expect.objectContaining({ title: "memo", content: "" }),
    ]);
  });

  test("duplicates the selected memo with a copy title and inserts it right after the original", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      {
        id: "memo-draft",
        title: "draft",
        content: "hello",
        tags: ["design"],
        format: "markdown",
      },
      { id: "memo-notes", title: "notes", content: "" },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "メモ「draft」を選択" }));
    await fireEvent.click(screen.getByRole("button", { name: "このメモを複製" }));
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: "このタスク内に複製" }));
    await tick();

    const memo = get(tree_data).data.children[0].data.memo;
    expect(memo).toHaveLength(3);
    expect(memo[0]).toEqual(expect.objectContaining({ id: "memo-draft", title: "draft" }));
    expect(memo[1]).toEqual(
      expect.objectContaining({
        title: "draft のコピー",
        content: "hello",
        tags: ["design"],
        format: "markdown",
      })
    );
    expect(memo[1].id).not.toBe("memo-draft");
    expect(memo[2]).toEqual(expect.objectContaining({ id: "memo-notes", title: "notes" }));

    expect(screen.getByRole("button", { name: "メモ「draft のコピー」を選択" })).toHaveClass(
      "selected"
    );
  });

  test("appends a numeric suffix when duplicating a memo whose copy title already exists", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      { id: "memo-draft", title: "draft", content: "" },
      { id: "memo-draft-copy", title: "draft のコピー", content: "" },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "メモ「draft」を選択" }));
    await fireEvent.click(screen.getByRole("button", { name: "このメモを複製" }));
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: "このタスク内に複製" }));
    await tick();

    const memo = get(tree_data).data.children[0].data.memo;
    expect(memo.map((entry) => entry.title)).toEqual([
      "draft",
      "draft のコピー 2",
      "draft のコピー",
    ]);
  });

  test("hides memo actions when there are no memos", () => {
    table_selected_id.set("task-1");
    render(TaskDetail);

    expect(screen.queryByRole("button", { name: "このメモを複製" })).not.toBeInTheDocument();
  });

  test("deletes the selected memo after confirmation", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [{ id: "memo-draft", title: "draft", content: "" }];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "このメモを削除" }));
    expect(screen.getByText('Do you really delete "draft"?')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    expect(get(tree_data).data.children[0].data.memo).toEqual([]);
    expect(screen.getByText("メモはまだありません")).toBeInTheDocument();
  });

  test("creates the first memo from the tab add action", async () => {
    table_selected_id.set("task-1");
    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "メモを追加" }));
    await tick();

    expect(screen.getByRole("button", { name: "メモ「memo」を選択" })).toHaveClass("selected");
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

    const firstTab = screen.getByRole("button", { name: "メモ「first」を選択" });
    const secondTab = screen.getByRole("button", { name: "メモ「second」を選択" });
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

    // タスク自身のタグ欄とメモのタグ欄が同居するので、メモ側を明示的に選ぶ。
    const tagInput = document.querySelector('.tag-input[aria-label="メモタグ"]');
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

    await fireEvent.click(screen.getByRole("button", { name: "Markdown形式を使用" }));

    expect(screen.getByText(/情報が損なわれる可能性/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    const memo = get(tree_data).data.children[0].data.memo[0];
    expect(memo.format).toBe("markdown");
    expect(memo.content).toBe("hello");
    expect(screen.getByRole("button", { name: "Markdown形式を使用" })).toHaveAttribute(
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

    await fireEvent.click(screen.getByRole("button", { name: "Quill形式を使用" }));
    await fireEvent.click(screen.getByRole("button", { name: "ok" }));
    await tick();

    const memo = get(tree_data).data.children[0].data.memo[0];
    expect(memo.format).toBe("quill");
    expect(memo.content).toEqual({ ops: [{ insert: "stale markdown save\n" }] });
    expect(screen.getByRole("button", { name: "Quill形式を使用" })).toHaveAttribute(
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

    await fireEvent.click(screen.getByRole("button", { name: "メモ「notes」を選択" }));
    expect(screen.getByRole("button", { name: "メモ「notes」を選択" })).toHaveClass("selected");

    table_selected_id.set("task-2");
    await tick();

    expect(screen.getByRole("button", { name: "メモ「review」を選択" })).toHaveClass("selected");
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
    expect(screen.getByRole("button", { name: "メモ「memo」を選択" })).toHaveClass("selected");

    // Switch to existing memo (index 0)
    await fireEvent.click(screen.getByRole("button", { name: "メモ「existing」を選択" }));
    await tick();
    expect(screen.getByRole("button", { name: "メモ「existing」を選択" })).toHaveClass("selected");

    // Switch back to the empty memo (index 1)
    await fireEvent.click(screen.getByRole("button", { name: "メモ「memo」を選択" }));
    await tick();

    expect(screen.getByRole("button", { name: "メモ「memo」を選択" })).toHaveClass("selected");
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

  test("duplicates a memo into another task via the cross-task picker", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      {
        id: "memo-draft",
        title: "draft",
        content: "hello",
        tags: ["design"],
        format: "markdown",
      },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "メモ「draft」を選択" }));
    await fireEvent.click(screen.getByRole("button", { name: "このメモを複製" }));
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: "別のタスクへ複製…" }));
    await tick();

    await fireEvent.click(within(screen.getByRole("dialog")).getByText("Second Task"));
    await fireEvent.click(screen.getByRole("button", { name: "複製" }));
    await tick();

    // Source task is untouched — no in-place insert happened.
    expect(get(tree_data).data.children[0].data.memo).toEqual([
      expect.objectContaining({ id: "memo-draft", title: "draft" }),
    ]);

    // Target task gets an appended copy with a fresh id, the same title
    // (no collision), and copied content/format/tags.
    const targetMemo = get(tree_data).data.children[1].data.memo;
    expect(targetMemo).toHaveLength(2);
    expect(targetMemo[1]).toEqual(
      expect.objectContaining({
        title: "draft",
        content: "hello",
        tags: ["design"],
        format: "markdown",
      })
    );
    expect(targetMemo[1].id).not.toBe("memo-draft");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("resolves title collisions against the target task's memos when duplicating across tasks", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [
      { id: "memo-draft", title: "draft", content: "hello", tags: [] },
    ];
    project.data.children[1].data.memo = [
      { id: "memo-review", title: "review", content: "" },
      { id: "memo-existing-draft", title: "draft", content: "existing" },
    ];
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "メモ「draft」を選択" }));
    await fireEvent.click(screen.getByRole("button", { name: "このメモを複製" }));
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: "別のタスクへ複製…" }));
    await tick();

    await fireEvent.click(within(screen.getByRole("dialog")).getByText("Second Task"));
    await fireEvent.click(screen.getByRole("button", { name: "複製" }));
    await tick();

    const targetMemo = get(tree_data).data.children[1].data.memo;
    expect(targetMemo.map((entry) => entry.title)).toEqual(["review", "draft", "draft のコピー"]);
  });

  test("hides archived tasks from the cross-task duplicate picker", async () => {
    const project = createProjectData();
    project.data.children[0].data.memo = [{ id: "memo-draft", title: "draft", content: "" }];
    project.data.children.push({
      id: "task-archived",
      data: { name: "Archived Task", status: "Open", "due date": undefined, memo: [] },
      children: [],
      archived: true,
      archivedAt: new Date().toISOString(),
    });
    tree_data.set(project);
    table_selected_id.set("task-1");

    render(TaskDetail);

    await fireEvent.click(screen.getByRole("button", { name: "メモ「draft」を選択" }));
    await fireEvent.click(screen.getByRole("button", { name: "このメモを複製" }));
    await tick();
    await fireEvent.click(screen.getByRole("menuitem", { name: "別のタスクへ複製…" }));
    await tick();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Second Task")).toBeInTheDocument();
    expect(within(dialog).queryByText("Archived Task")).not.toBeInTheDocument();
  });

  test("disables memo duplication while workspace memo bodies are still hydrating", async () => {
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
      // Never resolves — simulates hydration still in flight.
      wsReadTaskMemos: vi.fn().mockReturnValue(new Promise(() => {})),
    };

    render(TaskDetail);

    await waitFor(() => {
      expect(window.electronAPI.wsReadTaskMemos).toHaveBeenCalled();
    });

    expect(screen.getByRole("button", { name: "このメモを複製" })).toBeDisabled();
  });
});
