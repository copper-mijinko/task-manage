import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("@lib/layouts/SplitPanes.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@lib/layouts/Pane.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/tasks/components/StatusSelect.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@lib/primitives/DateInput.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/inbox/components/InboxDetailPanel.svelte", async () => {
  const mod = await import("../mocks/InboxDetailStub.svelte");
  return { default: mod.default };
});

import InboxPanel from "@features/inbox/components/InboxPanel.svelte";
import { inbox_store } from "@features/inbox/stores/inbox";
import { workspace_store } from "@features/workspace/stores/workspace";
import { showQuickCapture } from "@stores/ui";

const workspacePath = "C:\\workspace";
const projectDir = "C:\\workspace\\_inbox";
const rootId = "inbox-root";

function makeTasks(items = []) {
  return Object.fromEntries([
    [
      rootId,
      {
        id: rootId,
        name: "Inbox",
        status: "Open",
        parents: [],
        memos: [],
      },
    ],
    ...items.map((item, order) => [
      item.id,
      {
        status: "Open",
        parents: [{ id: rootId }],
        memos: [],
        order,
        ...item,
      },
    ]),
  ]);
}

async function prepareInbox(items = []) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      wsReadInbox: vi.fn().mockResolvedValue({
        success: true,
        projectDir,
        rootId,
        tasks: makeTasks(items),
      }),
    },
  });
  workspace_store.set({
    workspaces: [{ path: workspacePath, label: "Workspace" }],
    activeWorkspacePath: workspacePath,
    activeProjectDir: null,
    projects: [],
  });
  showQuickCapture.set(false);
  await inbox_store.reload();
  await tick();
}

afterEach(() => {
  showQuickCapture.set(false);
  workspace_store.set({
    workspaces: [],
    activeWorkspacePath: null,
    activeProjectDir: null,
    projects: [],
  });
  delete window.electronAPI;
});

describe("InboxPanel", () => {
  test("opening an empty Inbox does not force open Quick Capture", async () => {
    await prepareInbox();
    render(InboxPanel);

    expect(screen.getByTestId("inbox-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-list")).toBeNull();
    expect(get(showQuickCapture)).toBe(false);
  });

  test("the empty-state primary action opens Quick Capture", async () => {
    await prepareInbox();
    render(InboxPanel);

    await fireEvent.click(screen.getByTestId("inbox-add"));

    expect(get(showQuickCapture)).toBe(true);
  });

  test("items use the triage layout and reveal actions only after selection", async () => {
    await prepareInbox([{ id: "item-1", name: "整理するタスク" }]);
    render(InboxPanel);
    await tick();

    expect(screen.getByTestId("inbox-list")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-detail-stub")).toHaveTextContent("整理するタスク");
    expect(screen.queryByRole("button", { name: "プロジェクトへ整理" })).toBeNull();

    await fireEvent.click(screen.getByRole("option"));
    await tick();

    expect(screen.queryByText("1件選択中")).toBeNull();
    expect(screen.queryByRole("button", { name: "プロジェクトへ整理" })).toBeNull();

    await fireEvent.click(
      screen.getByRole("checkbox", { name: "整理するタスクを一括操作の対象にする" })
    );
    await tick();

    expect(screen.getByText("1件選択中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "プロジェクトへ整理" })).toBeInTheDocument();
    expect(screen.getByLabelText("1件を削除")).toBeInTheDocument();
  });

  // ノードは本文を 1 つだけ持つので、件数ではなく有無を出す。列そのものは
  // 全行に置いて、フィールドの位置が揃うようにする。
  test("本文の有無の列は全行にあり、Inbox の項目がずれない", async () => {
    await prepareInbox([
      { id: "item-with-body", name: "本文あり", body: "書いた" },
      { id: "item-without-body", name: "本文なし", body: "" },
    ]);
    const { container } = render(InboxPanel);
    await tick();

    const badges = container.querySelectorAll(".MemoBadge");
    expect(badges).toHaveLength(2);
    expect(badges[0]).not.toHaveClass("MemoBadgeEmpty");
    expect(badges[1]).toHaveClass("MemoBadgeEmpty");
  });

  test("keeps detail, count, and batch selection inside the filtered result set", async () => {
    await prepareInbox([
      { id: "item-first", name: "First item" },
      { id: "item-second", name: "Second item" },
    ]);
    render(InboxPanel);
    await tick();

    await fireEvent.click(
      screen.getByRole("checkbox", { name: "First itemを一括操作の対象にする" })
    );
    expect(screen.getByText("1件選択中")).toBeInTheDocument();

    await fireEvent.input(screen.getByRole("textbox", { name: "Inboxを絞り込み" }), {
      target: { value: "Second" },
    });
    await tick();

    expect(screen.getByTestId("inbox-detail-stub")).toHaveTextContent("Second item");
    expect(screen.getByText("1/2件")).toBeInTheDocument();
    expect(screen.queryByText("1件選択中")).toBeNull();
    expect(screen.queryByRole("button", { name: "プロジェクトへ整理" })).toBeNull();
  });
});
