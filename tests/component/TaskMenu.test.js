import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";

import TaskMenuHarness from "../mocks/TaskMenuHarness.svelte";

async function openMenu() {
  await fireEvent.click(screen.getByRole("button", { name: "タスクメニューを開く" }));
  await tick();
  expect(screen.getByRole("menu", { name: "Task actions" })).toBeInTheDocument();
}

describe("TaskMenu", () => {
  test("closes with Escape", async () => {
    render(TaskMenuHarness);
    await openMenu();

    await fireEvent.keyDown(window, { key: "Escape" });
    await tick();

    expect(screen.queryByRole("menu", { name: "Task actions" })).toBeNull();
  });

  test("window blur does not throw and closes the menu", async () => {
    render(TaskMenuHarness);
    await openMenu();

    expect(() => window.dispatchEvent(new Event("blur"))).not.toThrow();
    await tick();

    expect(screen.queryByRole("menu", { name: "Task actions" })).toBeNull();
  });

  test("opening a modal closes the menu", async () => {
    render(TaskMenuHarness);
    await openMenu();

    window.dispatchEvent(new CustomEvent("task-manage:modal-open"));
    await tick();

    expect(screen.queryByRole("menu", { name: "Task actions" })).toBeNull();
  });
});
