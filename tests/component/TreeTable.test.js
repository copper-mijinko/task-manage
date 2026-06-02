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
  closed_node_ids,
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
    closed_node_ids.set(new Set());
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

  test("collapses and expands a branch by toggling the row", async () => {
    render(TreeTable);

    expect(screen.getByText("Nested Task")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("toggle-task-1"));
    await tick();

    expect(get(closed_node_ids).has("task-1")).toBe(true);
    expect(screen.queryByText("Nested Task")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("toggle-task-1"));
    await tick();

    expect(get(closed_node_ids).has("task-1")).toBe(false);
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
});
