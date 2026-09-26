import { fireEvent, screen } from "@testing-library/svelte";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import TreeTableRow from "@features/tasks/components/TreeTableRow.svelte";
import { renderWithApplicationStub } from "../helpers/application_stub.js";

describe("TreeTableRow", () => {
  function createProps() {
    return {
      row: {
        id: "task-1",
        depth: 1,
        parentId: "project-1",
        siblingIndex: 0,
        siblingCount: 1,
        node: {
          id: "task-1",
          data: {
            name: "Task with files",
            status: "Open",
            "start date": undefined,
            "due date": undefined,
            memo: [],
            attachments: [
              {
                id: "./attachments/a.txt",
                name: "a.txt",
                relativePath: "./attachments/a.txt",
                size: 1,
              },
              {
                id: "./attachments/b.txt",
                name: "b.txt",
                relativePath: "./attachments/b.txt",
                size: 1,
              },
            ],
          },
          children: [],
        },
        hasChildren: false,
        expanded: true,
        canMoveUp: false,
        canMoveDown: false,
        canIndent: false,
        canOutdent: false,
      },
      headers: [
        { name: "name", default_ratio: 10 },
        { name: "attachments", default_ratio: 2 },
      ],
    };
  }

  test("passes the name-menu actions up as row operations with the row path", async () => {
    const onaddchild = vi.fn();
    const onaddbelow = vi.fn();
    const props = createProps();
    renderWithApplicationStub(TreeTableRow, {
      ...props,
      row: { ...props.row, path: "project-1/task-1" },
      onaddchild,
      onaddbelow,
    });

    await fireEvent.click(screen.getByRole("button", { name: "ノード操作を開く" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "子ノードを追加" }));
    expect(onaddchild).toHaveBeenCalledWith({ id: "task-1", path: "project-1/task-1" });

    await fireEvent.click(screen.getByRole("button", { name: "ノード操作を開く" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "下にノードを追加" }));
    expect(onaddbelow).toHaveBeenCalledWith({ id: "task-1", path: "project-1/task-1" });
  });

  test("renders array-valued columns as a count badge", () => {
    renderWithApplicationStub(TreeTableRow, createProps());

    expect(screen.getByRole("textbox")).toHaveValue("Task with files");
    expect(screen.getByLabelText("添付 2件")).toHaveTextContent("2");
  });

  // 0 件は「0」ではなく控えめなダッシュで出す。件数は 0 のほうが普通なので、
  // 全行に "0" を並べると中身のある行がかえって見つけにくくなる。
  // 読み上げには件数なしと分かるラベルを残す。
  test("renders missing attachments as a muted placeholder, not a zero", () => {
    const props = createProps();
    delete props.row.node.data.attachments;

    renderWithApplicationStub(TreeTableRow, props);

    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByLabelText("添付 なし")).toBeInTheDocument();
  });

  // プロジェクトのルートと子ノードの差が、これまでインデントとアイコンだけ
  // だった。木の頂点がどこかを一目で分かるようにする。
  test("marks the project root row so it can be emphasised", () => {
    const props = createProps();
    props.row.depth = 0;

    const { container } = renderWithApplicationStub(TreeTableRow, props);

    expect(container.querySelector('[role="row"]')).toHaveClass("RootRow");
  });

  test("does not mark a child row as the root", () => {
    const { container } = renderWithApplicationStub(TreeTableRow, createProps());

    expect(container.querySelector('[role="row"]')).not.toHaveClass("RootRow");
  });

  test("does not check the bulk-selection box for an ordinary focused row", () => {
    renderWithApplicationStub(TreeTableRow, { ...createProps(), selected: true });

    expect(screen.getByRole("checkbox", { name: "一括操作の対象として選択" })).not.toBeChecked();
  });

  test("checks the box after bulk selection is explicitly activated", () => {
    renderWithApplicationStub(TreeTableRow, {
      ...createProps(),
      selected: true,
      bulkSelectionActive: true,
    });

    expect(screen.getByRole("checkbox", { name: "一括操作の対象として選択" })).toBeChecked();
  });

  test("uses border-box sizing for the selection checkbox column", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/features/tasks/components/TreeTableRow.svelte"),
      "utf8"
    );
    const checkboxCellRule = source.match(/\.CheckboxCell\s*\{[^}]+}/)?.[0] ?? "";

    expect(checkboxCellRule).toContain("box-sizing: border-box;");
  });
});
