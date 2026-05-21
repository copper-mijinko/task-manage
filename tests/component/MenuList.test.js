import { fireEvent, render, screen } from "@testing-library/svelte";
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
import { active_tag, project_ids, selected_id, selected_type, tag_index } from "@stores";
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
    delete window.electronAPI;
  });

  test("collapses Workspace and InApp project lists independently", async () => {
    seedProjects();
    render(MenuList);

    expect(screen.getByText("Workspace Alpha")).toBeInTheDocument();
    expect(screen.getByText("InApp Alpha")).toBeInTheDocument();

    const workspaceToggle = screen.getByRole("button", {
      name: "Workspace Projectsを折りたたむ",
    });
    expect(workspaceToggle).toHaveAttribute("aria-expanded", "true");

    await fireEvent.click(workspaceToggle);
    expect(screen.queryByText("Workspace Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("InApp Alpha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace Projectsを展開" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    const inAppToggle = screen.getByRole("button", {
      name: "InApp Projectsを折りたたむ",
    });
    await fireEvent.click(inAppToggle);
    expect(screen.queryByText("Workspace Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("InApp Alpha")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Workspace Projectsを展開" }));
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
});
