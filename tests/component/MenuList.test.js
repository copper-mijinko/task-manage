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
import {
  active_tag,
  project_ids,
  selected_id,
  selected_type,
  sidebarCollapsed,
  tag_index,
} from "@stores";
import { workspace_store } from "@features/workspace/stores/workspace";

function seedProjects() {
  workspace_store.set({
    workspaces: [{ path: "C:/workspace", label: "Workspace" }],
    activeWorkspacePath: "C:/workspace",
    activeProjectDir: null,
    projects: [
      {
        name: "Workspace Alpha",
        rootId: "workspace-alpha",
        dirName: "workspace-alpha",
        projectDir: "C:/workspace/workspace-alpha",
        order: 0,
      },
    ],
  });
  project_ids.set([{ id: "in-app-alpha", name: "InApp Alpha" }]);
  selected_type.set(undefined);
  selected_id.set(undefined);
  sidebarCollapsed.set(false);
  tag_index.set(new Map());
  active_tag.set(null);
}

describe("MenuList project subsections", () => {
  afterEach(() => {
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
    project_ids.set(undefined);
    selected_type.set(undefined);
    selected_id.set(undefined);
    tag_index.set(new Map());
    active_tag.set(null);
    sidebarCollapsed.set(true);
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  test("collapses Workspace and InApp project lists independently", async () => {
    seedProjects();
    render(MenuList);

    expect(screen.getByText("Workspace Alpha")).toBeInTheDocument();
    expect(screen.getByText("InApp Alpha")).toBeInTheDocument();

    const workspaceToggle = screen.getByRole("button", {
      name: "Workspaceプロジェクトを折りたたむ",
    });
    expect(workspaceToggle).toHaveAttribute("aria-expanded", "true");

    await fireEvent.click(workspaceToggle);
    expect(screen.queryByText("Workspace Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("InApp Alpha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspaceプロジェクトを展開" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    const inAppToggle = screen.getByRole("button", {
      name: "アプリ内プロジェクトを折りたたむ",
    });
    await fireEvent.click(inAppToggle);
    expect(screen.queryByText("Workspace Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("InApp Alpha")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Workspaceプロジェクトを展開" }));
    expect(screen.getByText("Workspace Alpha")).toBeInTheDocument();
    expect(screen.queryByText("InApp Alpha")).not.toBeInTheDocument();
  });

  test("opens the active workspace from the sidebar", async () => {
    const wsOpenWorkspace = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { wsOpenWorkspace },
    });
    seedProjects();
    render(MenuList);

    await fireEvent.click(
      screen.getByRole("button", { name: "Workspaceをファイルエクスプローラーで開く" })
    );

    expect(wsOpenWorkspace).toHaveBeenCalledWith("C:/workspace");
  });

  test("keeps project selection and deletion as separate accessible actions", () => {
    seedProjects();
    render(MenuList);

    const workspaceProject = screen.getByRole("button", { name: "Workspace Alpha" });
    const inAppProject = screen.getByRole("button", { name: "InApp Alpha" });

    expect(within(workspaceProject).queryByRole("button")).toBeNull();
    expect(within(inAppProject).queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("button", { name: "プロジェクト「Workspace Alpha」を削除" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "プロジェクト「InApp Alpha」を削除" })
    ).toBeInTheDocument();
  });

  test("closes the drawer after selecting a project", async () => {
    seedProjects();
    render(MenuList);

    await fireEvent.click(screen.getByRole("button", { name: "InApp Alpha" }));

    expect(get(selected_id)).toBe("in-app-alpha");
    expect(get(sidebarCollapsed)).toBe(true);
  });

  test("opens a newly created InApp project immediately", async () => {
    seedProjects();
    vi.spyOn(project_ids, "addProject").mockResolvedValue("new-project-id");
    render(MenuList);

    await fireEvent.click(screen.getByRole("button", { name: "アプリ内プロジェクトを追加" }));

    await waitFor(() => expect(get(selected_id)).toBe("new-project-id"));
    expect(get(selected_type)).toBe("Projects");
    expect(get(sidebarCollapsed)).toBe(true);
  });

  test("keeps the drawer open and reports an InApp project creation failure", async () => {
    seedProjects();
    vi.spyOn(project_ids, "addProject").mockRejectedValue(new Error("保存に失敗しました"));
    render(MenuList);

    await fireEvent.click(screen.getByRole("button", { name: "アプリ内プロジェクトを追加" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存に失敗しました");
    expect(get(selected_id)).toBeUndefined();
    expect(get(sidebarCollapsed)).toBe(false);
  });
});
