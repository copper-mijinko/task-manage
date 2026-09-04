import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

vi.mock("@features/tasks/components/StatusSelect.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@lib/primitives/DateInput.svelte", async () => {
  const mod = await import("../mocks/PassThroughStub.svelte");
  return { default: mod.default };
});
vi.mock("@features/memos/components/Memo.svelte", async () => {
  const mod = await import("../mocks/MemoStub.svelte");
  return { default: mod.default };
});

import InboxDetailPanel from "@features/inbox/components/InboxDetailPanel.svelte";
import { ui_density } from "@stores/preferences";

const item = {
  id: "inbox-item-1",
  name: "Inbox item",
  status: "Open",
  parents: [{ id: "inbox-root" }],
};

afterEach(() => {
  ui_density.set("comfortable");
});

describe("InboxDetailPanel", () => {
  test("uses the same memo-first detail collapse in compact mode", async () => {
    ui_density.set("compact");
    render(InboxDetailPanel, { props: { item } });

    expect(screen.queryByRole("textbox", { name: "タスク名" })).toBeNull();
    const showDetail = screen.getByRole("button", { name: "詳細欄を表示" });
    expect(showDetail).toHaveAttribute("aria-pressed", "true");

    await fireEvent.click(showDetail);
    await tick();

    expect(screen.getByRole("textbox", { name: "タスク名" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "詳細欄をたたんでメモを広げる" })
    ).toBeInTheDocument();
  });

  test("keeps task fields visible in comfortable mode", () => {
    ui_density.set("comfortable");
    render(InboxDetailPanel, { props: { item } });

    expect(screen.getByRole("textbox", { name: "タスク名" })).toBeInTheDocument();
  });
});
