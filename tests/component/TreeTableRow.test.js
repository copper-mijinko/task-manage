import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

import TreeTableRow from "@features/tasks/components/TreeTableRow.svelte";
import { selected_id, selected_type, tree_data } from "@stores";
import { workspace_store } from "@features/workspace/stores/workspace";
import { clearSelection } from "@stores/ui";

function rowFixture() {
  const node = {
    id: "task-1",
    data: {
      name: "Workspace Task",
      status: "Open",
      memo: [],
    },
    children: [],
  };

  return {
    id: "task-1",
    node,
    depth: 1,
    hasChildren: false,
    expanded: false,
  };
}

describe("TreeTableRow", () => {
  beforeEach(() => {
    clearSelection();
    selected_type.set("WorkspaceProject");
    selected_id.set("root-1");
    tree_data.set({
      headers: [{ name: "name", default_ratio: 10 }],
      data: {
        id: "root-1",
        data: { name: "Workspace Project", status: "Open", memo: [] },
        children: [rowFixture().node],
      },
    });
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: "C:\\workspace",
      activeProjectDir: "C:\\workspace\\project",
      projects: [],
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        openTaskDetailWindow: vi.fn(),
      },
    });
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("passes workspace context when opening the detail window", async () => {
    const { container } = render(TreeTableRow, {
      props: {
        row: rowFixture(),
        headers: [{ name: "name" }],
      },
    });

    await fireEvent.contextMenu(container.querySelector(".TableRow"));
    await tick();

    await fireEvent.click(screen.getByText("show details"));
    await tick();

    expect(window.electronAPI.openTaskDetailWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "root-1",
        taskId: "task-1",
        taskName: "Workspace Task",
        selectedType: "WorkspaceProject",
        projectDir: "C:\\workspace\\project",
      })
    );
  });
});
