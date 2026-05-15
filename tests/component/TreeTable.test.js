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
  filtered_data,
  selected_id,
  table_selected_id,
  theme,
  tree_data,
} from "@stores";

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
            name: "Parent Task",
            status: "In Progress",
            "due date": undefined,
            memo: [],
          },
          children: [
            {
              id: "task-1-1",
              data: {
                name: "Nested Task",
                status: "Open",
                "due date": undefined,
                memo: [],
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
  beforeEach(() => {
    const projectData = createProjectData();

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
    table_selected_id.set(undefined);
    closed_node_ids.set(new Set());
    theme.set("dark");
  });

  test("selects a row and reflects the selected state", async () => {
    render(TreeTable);

    await fireEvent.click(screen.getByTestId("select-task-1"));
    await tick();

    expect(get(table_selected_id)).toBe("task-1");
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
});
