import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("@features/tasks/components/TreeTableHeader.svelte", async () => {
  const mod = await import("../mocks/TreeTableHeaderTestStub.svelte");
  return { default: mod.default };
});

vi.mock("@features/tasks/components/TreeTableRow.svelte", async () => {
  const mod = await import("../mocks/TreeTableRowTestStub.svelte");
  return { default: mod.default };
});

vi.mock("@lib/primitives/Dialog.svelte", async () => {
  const mod = await import("../mocks/DialogStub.svelte");
  return { default: mod.default };
});

import TreeTable from "@features/tasks/components/TreeTable.svelte";
import {
  closed_row_paths,
  column_settings,
  filtered_data,
  selected_id,
  selected_type,
  table_selected_id,
  theme,
  tree_data,
} from "@stores";
import { clearSelection, copied_task, copied_tasks, selected_ids } from "@stores/ui";
import { workspace_store } from "@features/workspace/stores/workspace";

function createProjectData() {
  return {
    headers: [
      { name: "name", default_ratio: 10 },
      { name: "status", default_ratio: 4 },
      { name: "due date", default_ratio: 4 },
      { name: "memo", default_ratio: 2 },
      { name: "attachments", default_ratio: 2 },
    ],
    data: {
      id: "project-1",
      data: {
        name: "Sample Project",
        status: "Open",
        "due date": undefined,
        memo: [],
        attachments: [],
      },
      children: [
        {
          id: "task-1",
          data: {
            name: "Parent Task",
            status: "In Progress",
            "due date": undefined,
            memo: [],
            attachments: [
              {
                id: "./attachments/spec.pdf",
                name: "spec.pdf",
                relativePath: "./attachments/spec.pdf",
                size: 4,
              },
            ],
          },
          children: [
            {
              id: "task-1-1",
              data: {
                name: "Nested Task",
                status: "Open",
                "due date": undefined,
                memo: [],
                attachments: [],
              },
              children: [],
            },
          ],
        },
      ],
    },
  };
}

describe("TreeTable", () => {
  let originalGetBoundingClientRect;

  beforeEach(() => {
    const projectData = createProjectData();
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    }

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        setMetaData: vi.fn(),
      },
    });

    tree_data.set(projectData);
    filtered_data.set(projectData.data);
    selected_id.set("project-1");
    clearSelection();
    selected_type.set("Projects");
    table_selected_id.set(undefined);
    copied_task.set(null);
    copied_tasks.set([]);
    closed_row_paths.set(new Set());
    column_settings.set([
      { id: "name", label: "タスク名", visible: true },
      { id: "status", label: "ステータス", visible: true },
      { id: "start date", label: "開始日", visible: true },
      { id: "due date", label: "期限日", visible: true },
      { id: "memo", label: "メモ数", visible: true },
      { id: "attachments", label: "添付数", visible: true },
    ]);
    theme.set("dark");
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  test("selects a row and reflects the selected state", async () => {
    render(TreeTable);

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();

    expect(get(table_selected_id)).toBe("task-1");
    expect(screen.getByTestId("row-task-1")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("bulk-select-task-1")).not.toBeChecked();
    expect(screen.getByTestId("tree-table-header-stub")).toHaveAttribute(
      "data-selected-count",
      "0"
    );
  });

  test("checks the bulk-selection control only after it is explicitly clicked", async () => {
    render(TreeTable);

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await fireEvent.click(screen.getByTestId("bulk-select-task-1"));
    await tick();

    expect(get(table_selected_id)).toBe("task-1");
    expect(screen.getByTestId("bulk-select-task-1")).toBeChecked();
    expect(screen.getByTestId("tree-table-header-stub")).toHaveAttribute(
      "data-selected-count",
      "1"
    );
  });

  test("keeps the current row selected when the tree background is clicked", async () => {
    const { container } = render(TreeTable);

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();

    await fireEvent.click(container.querySelector(".TableRoot"));
    await tick();

    expect(get(table_selected_id)).toBe("task-1");
    expect(get(selected_ids)).toEqual(new Set(["task-1"]));
    expect(screen.getByTestId("row-task-1")).toHaveAttribute("data-selected", "true");
  });

  test("多親ノードは全出現が選択色になり、操作中の行だけが強い表示になる", async () => {
    // 同じノードを 2 つの親の下に置く。表示上は 2 行だが実体は 1 つなので、
    // ツリーでも同じオブジェクトを共有する（workspaceToProjectData と同じ形）。
    const projectData = createProjectData();
    const shared = projectData.data.children[0].children[0];
    projectData.data.children.push({
      id: "task-2",
      data: {
        name: "Other Parent",
        status: "Open",
        "due date": undefined,
        memo: [],
        attachments: [],
      },
      children: [shared],
    });
    tree_data.set(projectData);
    filtered_data.set(projectData.data);
    const { container } = render(TreeTable);
    await tick();

    const rowAt = (path) => container.querySelector(`[data-row-path="${path}"]`);
    const first = "project-1/task-1/task-1-1";
    const second = "project-1/task-2/task-1-1";
    expect(rowAt(first)).not.toBeNull();
    expect(rowAt(second)).not.toBeNull();
    // DOM の id は最初の出現にだけ付く（重複 id を作らない）。
    expect(rowAt(first).id).toBe("task-1-1");
    expect(rowAt(second).id).toBe("");

    await fireEvent.click(rowAt(second).querySelector("button[data-testid^='select-']"));
    await tick();

    // 選択はノード単位なので両方に色が付く。
    expect(rowAt(first).dataset.selected).toBe("true");
    expect(rowAt(second).dataset.selected).toBe("true");
    // ただし操作中の行は「クリックした方」で、もう一方が弱い表示になる。
    expect(rowAt(second).dataset.echo).toBe("false");
    expect(rowAt(second).dataset.tabStop).toBe("true");
    expect(rowAt(first).dataset.echo).toBe("true");
    expect(rowAt(first).dataset.tabStop).toBe("false");
  });

  test("同じノードでも、別の親の下の行は別々に折りたためる", async () => {
    const projectData = createProjectData();
    const shared = projectData.data.children[0].children[0];
    shared.children = [
      {
        id: "task-1-1-1",
        data: {
          name: "Grandchild",
          status: "Open",
          "due date": undefined,
          memo: [],
          attachments: [],
        },
        children: [],
      },
    ];
    projectData.data.children.push({
      id: "task-2",
      data: {
        name: "Other Parent",
        status: "Open",
        "due date": undefined,
        memo: [],
        attachments: [],
      },
      children: [shared],
    });
    tree_data.set(projectData);
    filtered_data.set(projectData.data);
    const { container } = render(TreeTable);
    await tick();

    const paths = () =>
      [...container.querySelectorAll("[data-row-path]")].map((el) => el.dataset.rowPath);
    expect(paths()).toContain("project-1/task-1/task-1-1/task-1-1-1");
    expect(paths()).toContain("project-1/task-2/task-1-1/task-1-1-1");

    await fireEvent.click(
      container
        .querySelector('[data-row-path="project-1/task-1/task-1-1"]')
        .querySelector("button[data-testid^='toggle-']")
    );
    await tick();

    expect(get(closed_row_paths)).toEqual(new Set(["project-1/task-1/task-1-1"]));
    expect(paths()).not.toContain("project-1/task-1/task-1-1/task-1-1-1");
    // もう片方の親の下は開いたまま。
    expect(paths()).toContain("project-1/task-2/task-1-1/task-1-1-1");
  });

  test("collapses and expands a branch by toggling the row", async () => {
    render(TreeTable);

    expect(screen.getByText("Nested Task")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("toggle-task-1"));
    await tick();

    expect(get(closed_row_paths).has("project-1/task-1")).toBe(true);
    expect(screen.queryByText("Nested Task")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("toggle-task-1"));
    await tick();

    expect(get(closed_row_paths).has("project-1/task-1")).toBe(false);
    expect(screen.getByText("Nested Task")).toBeInTheDocument();
  });

  test("shows the attachments count column", () => {
    render(TreeTable);

    expect(screen.getByTestId("header-attachments")).toHaveTextContent("attachments");
    expect(screen.getByTestId("cell-task-1-attachments")).toHaveTextContent("1");
    expect(screen.getByTestId("cell-task-1-1-attachments")).toHaveTextContent("0");
  });

  test("opens a workspace task folder from the row action", async () => {
    const wsOpenTaskFolder = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        setMetaData: vi.fn(),
        wsOpenTaskFolder,
      },
    });
    selected_type.set("WorkspaceProject");
    workspace_store.set({
      workspaces: [{ path: "C:/workspace", label: "Workspace" }],
      activeWorkspacePath: "C:/workspace",
      activeProjectDir: "C:/workspace/project",
      projects: [],
    });
    render(TreeTable);

    await fireEvent.click(screen.getByTestId("open-folder-task-1"));

    expect(wsOpenTaskFolder).toHaveBeenCalledWith("C:/workspace/project", "task-1");
  });

  test("lets selected text copy before the task copy shortcut", async () => {
    render(TreeTable);

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();

    const memoHost = document.createElement("div");
    memoHost.className = "memo-host";
    const preview = document.createElement("div");
    preview.className = "preview";
    const paragraph = document.createElement("p");
    paragraph.textContent = "Selected markdown text";
    preview.appendChild(paragraph);
    memoHost.appendChild(preview);
    document.body.appendChild(memoHost);

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    try {
      await fireEvent.keyDown(window, { key: "c", ctrlKey: true });
      await tick();

      expect(get(copied_task)).toBeNull();
      expect(get(copied_tasks)).toEqual([]);
    } finally {
      selection.removeAllRanges();
      memoHost.remove();
    }
  });

  test("copies the selected task when no document text is selected", async () => {
    render(TreeTable);

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();

    await fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    await tick();

    expect(get(copied_task)?.id).toBe("task-1");
    expect(get(copied_tasks).map((task) => task.id)).toEqual(["task-1"]);
  });

  function countNodes(node) {
    return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
  }

  test("pastes a copied project-root subtree as an ordinary task under another node", async () => {
    render(TreeTable);

    // Copy the whole project (the root row itself, id === tree_data.data.id).
    // The context menu hides "copy" for the root row, but Ctrl+C on the
    // selected root row is the (intentional) way to grab the entire project.
    await fireEvent.click(screen.getByTestId("select-project-1"));
    await tick();
    await fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    await tick();

    expect(get(copied_task)?.id).toBe("project-1");

    // Paste it as a child of "task-1", an ordinary node inside the same tree.
    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();
    await fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await tick();

    const task1 = get(tree_data).data.children.find((c) => c.id === "task-1");
    expect(task1.children).toHaveLength(2); // original "task-1-1" + the pasted clone
    const pastedRoot = task1.children.find((c) => c.id !== "task-1-1");
    expect(pastedRoot).toBeDefined();
    // The pasted node is a plain task: nothing marks it as a project root, and
    // (per workspace_tree.ts) its `parents` on save is derived purely from
    // tree position, so it is written as a normal task, never as `_project.md`.
    expect(pastedRoot.data.name).toBe("Sample Project");
    expect(pastedRoot.id).not.toBe("project-1");
    // The whole copied subtree (project-1 -> task-1 "Parent Task" -> task-1-1
    // "Nested Task") comes along, with fresh ids at every level.
    expect(pastedRoot.children.map((c) => c.data.name)).toEqual(["Parent Task"]);
    expect(pastedRoot.children[0].children.map((c) => c.data.name)).toEqual(["Nested Task"]);
    expect(pastedRoot.id).not.toBe("project-1");
    expect(pastedRoot.children[0].id).not.toBe("task-1");
    expect(pastedRoot.children[0].children[0].id).not.toBe("task-1-1");
  });

  test("repeated pastes of a copied project root do not compound in size", async () => {
    // Regression test for the clipboard-aliasing bug: handleCopyTask stores a
    // *live* reference into $tree_data.data. Because the project root's only
    // possible paste targets are its own descendants, pasting it once used to
    // leave the clipboard aliasing an now-larger live tree, so a second paste
    // from the same clipboard entry re-cloned the already-grown tree instead
    // of the original — turning "copy a project, paste it twice" into an
    // ever-doubling write payload (a real-world save failure for big
    // projects). handlePasteTask now refreshes the clipboard to a fresh,
    // detached clone on every paste, so growth stays linear.
    render(TreeTable);

    await fireEvent.click(screen.getByTestId("select-project-1"));
    await tick();
    await fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    await tick();

    const sizeBefore = countNodes(get(tree_data).data);

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();
    await fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await tick();
    const sizeAfterFirstPaste = countNodes(get(tree_data).data);
    const growthPerPaste = sizeAfterFirstPaste - sizeBefore;
    expect(growthPerPaste).toBeGreaterThan(0);

    // Paste again from the same (still-populated) clipboard entry without
    // re-copying — a natural thing to do right after duplicating a project.
    await fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await tick();
    const sizeAfterSecondPaste = countNodes(get(tree_data).data);

    // Fixed behaviour: each paste adds the same, constant-size snapshot.
    expect(sizeAfterSecondPaste - sizeAfterFirstPaste).toBe(growthPerPaste);
  });

  test("positions resizers after the selection checkbox column", async () => {
    const rect = (width, height = 40) => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    });

    Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("TableRoot") || this.classList.contains("TableRow")) {
        return rect(1000, this.classList.contains("TableRow") ? 40 : 300);
      }
      if (
        this.classList.contains("CheckboxHeaderCell") ||
        this.classList.contains("CheckboxCell")
      ) {
        return rect(28, 40);
      }
      if (this.classList.contains("TableHeader") || this.classList.contains("TableData")) {
        const width = Number.parseFloat(this.style.width.match(/([\d.]+)px/)?.[1] ?? "100");
        return rect(width, 40);
      }
      return originalGetBoundingClientRect.call(this);
    };

    const { container } = render(TreeTable);
    await tick();

    const firstResizer = container.querySelector(".Resizer");
    const nameRatio = 10;
    const ratioSum = 10 + 4 + 3 + 4 + 2 + 2;
    const checkboxWidth = 28;
    const expectedNameWidth = ((1000 - checkboxWidth) * nameRatio) / ratioSum;

    expect(firstResizer).toBeInTheDocument();
    expect(Number.parseFloat(firstResizer.style.left)).toBeCloseTo(
      checkboxWidth + expectedNameWidth - 3,
      3
    );

    await fireEvent.mouseDown(firstResizer, { clientX: 500 });
    await fireEvent.mouseMove(document, { clientX: 510 });

    expect(Number.parseFloat(firstResizer.style.left)).toBeCloseTo(
      checkboxWidth + expectedNameWidth + 10 - 3,
      3
    );

    await fireEvent.mouseUp(document);
  });

  describe("treegrid keyboard navigation", () => {
    // ツリーの行は role="treegrid" を名乗るのに矢印キーが一切効かず、
    // ツリーを辿るには行内のコントロールを Tab で全部踏むしかなかった。
    const rowOf = (id) => screen.getByTestId(`row-${id}`);

    test("moves down and up through the visible rows", async () => {
      render(TreeTable);
      await tick();

      await fireEvent.keyDown(rowOf("project-1"), { key: "ArrowDown" });
      await tick();
      expect(get(table_selected_id)).toBe("task-1");

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowDown" });
      await tick();
      expect(get(table_selected_id)).toBe("task-1-1");

      await fireEvent.keyDown(rowOf("task-1-1"), { key: "ArrowUp" });
      await tick();
      expect(get(table_selected_id)).toBe("task-1");
    });

    test("jumps to the first and last visible row with Home and End", async () => {
      render(TreeTable);
      await tick();

      await fireEvent.keyDown(rowOf("project-1"), { key: "End" });
      await tick();
      expect(get(table_selected_id)).toBe("task-1-1");

      await fireEvent.keyDown(rowOf("task-1-1"), { key: "Home" });
      await tick();
      expect(get(table_selected_id)).toBe("project-1");
    });

    test("ArrowLeft collapses an expanded row, then moves to the parent", async () => {
      render(TreeTable);
      await tick();

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowLeft" });
      await tick();
      expect(get(closed_row_paths).has("project-1/task-1")).toBe(true);
      // 閉じただけで、まだ移動はしない。
      expect(get(table_selected_id)).toBeUndefined();

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowLeft" });
      await tick();
      expect(get(table_selected_id)).toBe("project-1");
    });

    test("ArrowRight expands a collapsed row, then steps into the first child", async () => {
      closed_row_paths.set(new Set(["project-1/task-1"]));
      render(TreeTable);
      await tick();

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowRight" });
      await tick();
      expect(get(closed_row_paths).has("project-1/task-1")).toBe(false);

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowRight" });
      await tick();
      expect(get(table_selected_id)).toBe("task-1-1");
    });

    test("Shift+ArrowDown extends the selection instead of replacing it", async () => {
      render(TreeTable);
      await tick();

      await fireEvent.keyDown(rowOf("project-1"), { key: "ArrowDown" });
      await tick();
      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowDown", shiftKey: true });
      await tick();

      expect([...get(selected_ids)].sort()).toEqual(["task-1", "task-1-1"]);
    });

    test("keeps exactly one row in the tab order", async () => {
      render(TreeTable);
      await tick();

      const tabStops = () =>
        document.querySelectorAll('[data-testid^="row-"][data-tab-stop="true"]');
      expect(tabStops()).toHaveLength(1);
      // 選択していないうちは先頭行が停留点。
      expect(tabStops()[0]).toBe(rowOf("project-1"));

      await fireEvent.keyDown(rowOf("project-1"), { key: "End" });
      await tick();
      expect(tabStops()).toHaveLength(1);
      expect(tabStops()[0]).toBe(rowOf("task-1-1"));
    });
  });
});
