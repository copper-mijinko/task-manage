import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { get } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@features/workspace/components/WorkspaceSetup.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});

vi.mock("@lib/primitives/Dialog.svelte", async () => {
  const mod = await import("../mocks/DialogStub.svelte");
  return { default: mod.default };
});

import MenuList from "../../src/features/navigation/components/MenuList.svelte";
import { active_tag, selected_id, selected_type, sidebarCollapsed, tag_index } from "@stores";
import { workspace_store } from "@features/workspace/stores/workspace";
import { workspace_graph_store } from "@features/workspace/stores/graph";
import { TEST_WORKSPACE, graphFromTree, installGraphBackend } from "../helpers/graph_backend.js";

let backend;
async function seedProjects() {
  backend = installGraphBackend(
    graphFromTree([
      { id: "workspace-alpha", data: { name: "Workspace Alpha" }, children: [] },
      { id: "workspace-beta", data: { name: "Workspace Beta" }, children: [] },
    ])
  );
  workspace_store.set({
    workspaces: [{ path: TEST_WORKSPACE, label: "Workspace" }],
    activeWorkspacePath: TEST_WORKSPACE,
  });
  await workspace_graph_store.load(TEST_WORKSPACE);
  selected_type.set(undefined);
  selected_id.set(undefined);
  sidebarCollapsed.set(false);
  tag_index.set(new Map());
  active_tag.set(null);
}

describe("MenuList project list", () => {
  afterEach(() => {
    workspace_store.set({ workspaces: [], activeWorkspacePath: null });
    selected_type.set(undefined);
    selected_id.set(undefined);
    tag_index.set(new Map());
    active_tag.set(null);
    sidebarCollapsed.set(true);
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  test("collapses and expands the workspace project list", async () => {
    await seedProjects();
    render(MenuList);

    expect(screen.getByText("Workspace Alpha")).toBeInTheDocument();

    const workspaceToggle = screen.getByRole("button", {
      name: "Workspaceプロジェクトを折りたたむ",
    });
    expect(workspaceToggle).toHaveAttribute("aria-expanded", "true");

    await fireEvent.click(workspaceToggle);
    expect(screen.queryByText("Workspace Alpha")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspaceプロジェクトを展開" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    await fireEvent.click(screen.getByRole("button", { name: "Workspaceプロジェクトを展開" }));
    expect(screen.getByText("Workspace Alpha")).toBeInTheDocument();
  });

  test("opens the active workspace from the sidebar", async () => {
    await seedProjects();
    backend.api.wsOpenWorkspace = vi.fn().mockResolvedValue({ success: true });
    render(MenuList);

    await fireEvent.click(
      screen.getByRole("button", { name: "Workspaceをファイルエクスプローラーで開く" })
    );

    expect(backend.api.wsOpenWorkspace).toHaveBeenCalledWith(TEST_WORKSPACE);
  });

  test("keeps project selection and deletion as separate accessible actions", async () => {
    await seedProjects();
    render(MenuList);

    const workspaceProject = screen.getByRole("button", { name: "Workspace Alpha" });

    expect(within(workspaceProject).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Workspace Alphaの操作" })).toBeInTheDocument();
  });

  test("closes the drawer after selecting a project", async () => {
    await seedProjects();
    render(MenuList);

    await fireEvent.click(screen.getByRole("button", { name: "Workspace Beta" }));

    expect(get(selected_type)).toBe("WorkspaceProject");
    expect(get(selected_id)).toBe("workspace-beta");
    expect(get(sidebarCollapsed)).toBe(true);
  });

  test("opens a newly created project immediately", async () => {
    await seedProjects();
    render(MenuList);

    await fireEvent.click(screen.getByRole("button", { name: "Workspaceプロジェクトを追加" }));

    await waitFor(() => expect(backend.childrenOf("workspace-root")).toHaveLength(3));
    const created = backend.childrenOf("workspace-root")[2];
    expect(backend.node(created).name).toBe("新しいプロジェクト");
    await waitFor(() => expect(get(selected_id)).toBe(created));
    expect(get(sidebarCollapsed)).toBe(true);
  });

  test("keeps the drawer open and reports a project creation failure", async () => {
    await seedProjects();
    backend.api.wsExecuteGraphCommand.mockRejectedValueOnce(new Error("保存に失敗しました"));
    render(MenuList);

    await fireEvent.click(screen.getByRole("button", { name: "Workspaceプロジェクトを追加" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存に失敗しました");
    expect(get(selected_id)).toBeUndefined();
    expect(get(sidebarCollapsed)).toBe(false);
  });
});
