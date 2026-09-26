import { fireEvent, screen } from "@testing-library/svelte";
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
import { column_settings, table_selected_id, theme } from "@stores";
import { active_row_path, clearSelection, selected_ids } from "@stores/ui";
import { pageSearchCountIsPartial, pageSearchQuery } from "@features/search/stores/search";
import { renderWithGraph, settle } from "../helpers/render_with_graph.js";

let project;
let app;
let backend;
async function renderTree(tree = project) {
  const result = await renderWithGraph(TreeTable, { tree });
  app = result.application;
  backend = result.backend;
  return result;
}

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
    project = createProjectData();
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    }

    clearSelection();
    table_selected_id.set(undefined);
    active_row_path.set(undefined);
    column_settings.set([
      { id: "name", label: "ノード名", visible: true },
      { id: "status", label: "ステータス", visible: true },
      { id: "start date", label: "開始日", visible: true },
      { id: "due date", label: "期限日", visible: true },
      { id: "memo", label: "メモ数", visible: true },
      { id: "attachments", label: "添付数", visible: true },
    ]);
    theme.set("dark");
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  test("selects a row and reflects the selected state", async () => {
    await renderTree();

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
    await renderTree();

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
    const { container } = await renderTree();

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
    const { container } = await renderTree(projectData);
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
    const { container } = await renderTree(projectData);
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

    expect(get(app.closed)).toEqual(new Set(["project-1/task-1/task-1-1"]));
    expect(paths()).not.toContain("project-1/task-1/task-1-1/task-1-1-1");
    // もう片方の親の下は開いたまま。
    expect(paths()).toContain("project-1/task-2/task-1-1/task-1-1-1");
  });

  test("collapses and expands a branch by toggling the row", async () => {
    await renderTree();

    expect(screen.getByText("Nested Task")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("toggle-task-1"));
    await tick();

    expect(get(app.closed).has("project-1/task-1")).toBe(true);
    expect(screen.queryByText("Nested Task")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("toggle-task-1"));
    await tick();

    expect(get(app.closed).has("project-1/task-1")).toBe(false);
    expect(screen.getByText("Nested Task")).toBeInTheDocument();
  });

  test("shows the attachments count column", async () => {
    await renderTree();

    expect(screen.getByTestId("header-attachments")).toHaveTextContent("attachments");
    expect(screen.getByTestId("cell-task-1-attachments")).toHaveTextContent("1");
    expect(screen.getByTestId("cell-task-1-1-attachments")).toHaveTextContent("0");
  });

  test("lets selected text copy before the task copy shortcut", async () => {
    await renderTree();

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

      expect(get(app.copied)).toEqual([]);
    } finally {
      selection.removeAllRanges();
      memoHost.remove();
    }
  });

  test("copies the selected task when no document text is selected", async () => {
    await renderTree();

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();

    await fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    await tick();

    expect(get(app.copied)).toEqual(["task-1"]);
  });

  test("pastes a copied project-root subtree as an ordinary node under another node", async () => {
    await renderTree();

    // Ctrl+C on the selected root row grabs the entire project.
    await fireEvent.click(screen.getByTestId("select-project-1"));
    await tick();
    await fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    await tick();
    expect(get(app.copied)).toEqual(["project-1"]);

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();
    await fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await settle();

    const children = backend.childrenOf("task-1");
    expect(children).toHaveLength(2); // original "task-1-1" + the pasted copy
    const pastedRoot = children.find((id) => id !== "task-1-1");
    expect(backend.node(pastedRoot).name).toBe("Sample Project のコピー");
    // The whole subtree comes along, with fresh ids at every level.
    const [pastedParent] = backend.childrenOf(pastedRoot);
    expect(backend.node(pastedParent).name).toBe("Parent Task");
    expect(pastedParent).not.toBe("task-1");
    const [pastedNested] = backend.childrenOf(pastedParent);
    expect(backend.node(pastedNested).name).toBe("Nested Task");
    expect(pastedNested).not.toBe("task-1-1");
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

    const { container } = await renderTree();
    await tick();

    const firstResizer = container.querySelector(".Resizer");
    const nameRatio = 16;
    // グラフの射影は headers を持たないので BUILT_IN_HEADERS が使われる。
    // 列の設定で見えているもの（name 16 / status 3 / start 2.5 / due 2.5 /
    // attachments 1.2）の合計。
    const ratioSum = 16 + 3 + 2.5 + 2.5 + 1.2;
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
      await renderTree();
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
      await renderTree();
      await tick();

      await fireEvent.keyDown(rowOf("project-1"), { key: "End" });
      await tick();
      expect(get(table_selected_id)).toBe("task-1-1");

      await fireEvent.keyDown(rowOf("task-1-1"), { key: "Home" });
      await tick();
      expect(get(table_selected_id)).toBe("project-1");
    });

    test("ArrowLeft collapses an expanded row, then moves to the parent", async () => {
      await renderTree();
      await tick();

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowLeft" });
      await tick();
      expect(get(app.closed).has("project-1/task-1")).toBe(true);
      // 閉じただけで、まだ移動はしない。
      expect(get(table_selected_id)).toBeUndefined();

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowLeft" });
      await tick();
      expect(get(table_selected_id)).toBe("project-1");
    });

    test("ArrowRight expands a collapsed row, then steps into the first child", async () => {
      await renderTree();
      app.closed.add("project-1/task-1");
      await tick();

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowRight" });
      await tick();
      expect(get(app.closed).has("project-1/task-1")).toBe(false);

      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowRight" });
      await tick();
      expect(get(table_selected_id)).toBe("task-1-1");
    });

    test("Shift+ArrowDown extends the selection instead of replacing it", async () => {
      await renderTree();
      await tick();

      await fireEvent.keyDown(rowOf("project-1"), { key: "ArrowDown" });
      await tick();
      await fireEvent.keyDown(rowOf("task-1"), { key: "ArrowDown", shiftKey: true });
      await tick();

      expect([...get(selected_ids)].sort()).toEqual(["task-1", "task-1-1"]);
    });

    test("keeps exactly one row in the tab order", async () => {
      await renderTree();
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

  describe("virtual rows", () => {
    // 数千ノードでも起動と更新が重くならないよう、見えている行だけを描く。
    // jsdom にはレイアウトが無いので、表示の高さと行の高さを与える。
    let restoreLayout;

    beforeEach(() => {
      const define = (name, get) => {
        const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
        Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
        return () => {
          if (original) Object.defineProperty(HTMLElement.prototype, name, original);
          else delete HTMLElement.prototype[name];
        };
      };
      const restores = [
        define("clientHeight", function () {
          return this.classList.contains("TableRoot") ? 240 : 0;
        }),
        define("offsetHeight", function () {
          return this.classList.contains("RowHeightProbe") ? 24 : 0;
        }),
      ];
      restoreLayout = () => restores.forEach((restore) => restore());

      project.data.children = Array.from({ length: 500 }, (_, index) => ({
        id: `bulk-${index}`,
        data: { name: `Bulk ${index}`, status: "Open", memo: [], attachments: [] },
        children: [],
      }));
    });

    afterEach(() => restoreLayout());

    const renderedRows = (container) =>
      container.querySelectorAll('[role="row"][data-row-path]').length;

    test("renders only the rows around the viewport, but counts every row", async () => {
      const { container } = await renderTree();
      await tick();
      await tick();

      expect(renderedRows(container)).toBeGreaterThan(0);
      expect(renderedRows(container)).toBeLessThan(40);
      expect(container.querySelector('[role="treegrid"]').getAttribute("aria-rowcount")).toBe(
        "502"
      );
      expect(container.querySelector(".RowGap")).not.toBeNull();
    });

    test("marks the page-search count as partial only when matches are left unrendered", async () => {
      await renderTree();
      await tick();

      pageSearchQuery.set("Bulk");
      await tick();
      expect(get(pageSearchCountIsPartial)).toBe(true);

      pageSearchQuery.set("Bulk 499");
      await tick();
      expect(get(pageSearchCountIsPartial)).toBe(false);

      pageSearchQuery.set("");
    });

    test("End moves to the last row even though it was not rendered", async () => {
      const { container } = await renderTree();
      await tick();
      await tick();
      expect(container.querySelector('[data-node-id="bulk-499"]')).toBeNull();

      await fireEvent.keyDown(screen.getByTestId("row-project-1"), { key: "End" });
      await tick();
      await tick();

      expect(get(table_selected_id)).toBe("bulk-499");
      const last = container.querySelector('[data-node-id="bulk-499"]');
      expect(last).not.toBeNull();
      expect(document.activeElement).toBe(last);
    });
  });
});
