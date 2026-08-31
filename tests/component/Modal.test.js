import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";

import ModalHarness from "../mocks/ModalHarness.svelte";

describe("Modal", () => {
  test("closed modal content is absent from the accessibility tree", () => {
    render(ModalHarness);

    expect(screen.queryByRole("dialog", { name: "テスト設定" })).toBeNull();
    expect(screen.queryByRole("button", { name: "設定内の操作" })).toBeNull();
  });

  test("opens, closes with Escape, and restores focus", async () => {
    render(ModalHarness);
    const trigger = screen.getByRole("button", { name: "設定を開く" });
    trigger.focus();

    await fireEvent.click(trigger);
    await tick();
    expect(screen.getByRole("dialog", { name: "テスト設定" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "設定を開く" })).toBeNull();
    expect(trigger.closest("div[inert]")).not.toBeNull();

    await fireEvent.keyDown(window, { key: "Escape" });
    await tick();

    expect(screen.queryByRole("dialog", { name: "テスト設定" })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
