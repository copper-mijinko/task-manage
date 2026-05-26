import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";

import TreeTableRow from "@features/tasks/components/TreeTableRow.svelte";

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

  test("renders array-valued columns as counts", () => {
    render(TreeTableRow, { props: createProps() });

    expect(screen.getByRole("textbox")).toHaveValue("Task with files");
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  test("renders missing attachments as zero", () => {
    const props = createProps();
    delete props.row.node.data.attachments;

    render(TreeTableRow, { props });

    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
