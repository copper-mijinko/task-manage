import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";

import TaskNameClickHarness from "../mocks/TaskNameClickHarness.svelte";
import TaskNameCommitHarness from "../mocks/TaskNameCommitHarness.svelte";

async function openRenameEditor() {
  const menuButton = screen.getByRole("button", { name: /open task actions/i });
  await fireEvent.click(menuButton);
  const renameItem = await screen.findByRole("menuitem", { name: /rename/i });
  await fireEvent.click(renameItem);
}

describe("TaskName", () => {
  test("keeps the task name disabled until editing while row clicks still select", async () => {
    render(TaskNameClickHarness);

    const input = screen.getByDisplayValue("Task 1");
    expect(input).toBeDisabled();
    expect(input).not.toHaveAttribute("readonly");

    await fireEvent.click(screen.getByTestId("row"));

    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  describe("empty/whitespace validation", () => {
    async function enterEditingMode() {
      // Rename now lives only inside the actions menu (the inline edit-pencil
      // button was removed). Open the menu and click "rename" to start editing.
      const menuButton = screen.getByRole("button", { name: /open task actions/i });
      await fireEvent.click(menuButton);
      const renameItem = await screen.findByRole("menuitem", { name: /rename/i });
      await fireEvent.click(renameItem);
      expect(screen.getByDisplayValue("Original")).not.toBeDisabled();
    }

    test("does not commit empty string on blur", async () => {
      render(TaskNameCommitHarness, { initialText: "Original" });
      await enterEditingMode();

      const input = screen.getByDisplayValue("Original");
      await fireEvent.input(input, { target: { value: "" } });
      await fireEvent.blur(input);

      expect(screen.getByTestId("committed-count")).toHaveTextContent("0");
      expect(screen.getByTestId("current-text")).toHaveTextContent("Original");
    });

    test("does not commit whitespace-only string on blur", async () => {
      render(TaskNameCommitHarness, { initialText: "Original" });
      await enterEditingMode();

      const input = screen.getByDisplayValue("Original");
      await fireEvent.input(input, { target: { value: "   " } });
      await fireEvent.blur(input);

      expect(screen.getByTestId("committed-count")).toHaveTextContent("0");
      expect(screen.getByTestId("current-text")).toHaveTextContent("Original");
    });

    test("restores original text when empty string submitted with Enter", async () => {
      render(TaskNameCommitHarness, { initialText: "Original" });
      await enterEditingMode();

      const input = screen.getByDisplayValue("Original");
      await fireEvent.input(input, { target: { value: "" } });
      await fireEvent.keyDown(input, { key: "Enter" });

      expect(screen.getByTestId("committed-count")).toHaveTextContent("0");
      expect(input).toHaveValue("Original");
    });

    test("commits valid non-empty text normally", async () => {
      render(TaskNameCommitHarness, { initialText: "Original" });
      await enterEditingMode();

      const input = screen.getByDisplayValue("Original");
      await fireEvent.input(input, { target: { value: "Updated" } });
      await fireEvent.blur(input);

      expect(screen.getByTestId("committed-count")).toHaveTextContent("1");
      expect(screen.getByTestId("last-committed")).toHaveTextContent("Updated");
    });
  });

  describe("no auto-commit while typing", () => {
    // Regression: previously typing into the input fired a debounced commit
    // (~300ms after the last keystroke), so a pause in typing committed the
    // partial value before the user pressed Enter. The fix removes the
    // debounced commit entirely; commit only happens on Enter or blur.

    test("typing alone does not fire commit, even after a pause", async () => {
      vi.useFakeTimers();
      try {
        render(TaskNameCommitHarness, { initialText: "Original" });
        await openRenameEditor();

        const input = screen.getByDisplayValue("Original");
        await fireEvent.input(input, { target: { value: "U" } });
        await fireEvent.input(input, { target: { value: "Up" } });
        await fireEvent.input(input, { target: { value: "Updat" } });

        // Advance far past any plausible debounce window.
        vi.advanceTimersByTime(5000);
        await tick();

        expect(screen.getByTestId("committed-count")).toHaveTextContent("0");
        expect(screen.getByTestId("current-text")).toHaveTextContent("Original");
      } finally {
        vi.useRealTimers();
      }
    });

    test("Enter commits the typed value", async () => {
      render(TaskNameCommitHarness, { initialText: "Original" });
      await openRenameEditor();

      const input = screen.getByDisplayValue("Original");
      await fireEvent.input(input, { target: { value: "Updated" } });
      await fireEvent.keyDown(input, { key: "Enter" });

      expect(screen.getByTestId("committed-count")).toHaveTextContent("1");
      expect(screen.getByTestId("last-committed")).toHaveTextContent("Updated");
    });
  });

  describe("three-dot menu toggle", () => {
    test("clicking the trigger button a second time closes the menu", async () => {
      // Regression: previously the menu's outside-click handler closed the
      // menu on the same pointerdown that the trigger's click then re-opened,
      // resulting in a "stuck open" state. The trigger now has
      // `data-task-menu-trigger` so the outside-click guard skips it, AND
      // openMenu toggles directly on re-click.
      render(TaskNameCommitHarness, { initialText: "Original" });

      const menuButton = screen.getByRole("button", { name: /open task actions/i });

      // First click opens.
      await fireEvent.click(menuButton);
      expect(await screen.findByRole("menuitem", { name: /rename/i })).toBeInTheDocument();

      // Second click on the SAME trigger closes (toggle behaviour).
      await fireEvent.click(menuButton);
      expect(screen.queryByRole("menuitem", { name: /rename/i })).toBeNull();
    });

    test("clicking a disabled-looking outside element still closes the menu", async () => {
      // Disabled buttons in Chromium suppress click + mousedown to themselves,
      // but pointerdown still bubbles. The menu's outside-handler listens for
      // pointerdown at capture phase precisely for this case.
      render(TaskNameCommitHarness, { initialText: "Original" });

      const menuButton = screen.getByRole("button", { name: /open task actions/i });
      await fireEvent.click(menuButton);
      expect(await screen.findByRole("menuitem", { name: /rename/i })).toBeInTheDocument();

      // Add a disabled button outside the menu and click it.
      const outsideDisabled = document.createElement("button");
      outsideDisabled.disabled = true;
      outsideDisabled.textContent = "outside disabled";
      document.body.appendChild(outsideDisabled);
      outsideDisabled.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await tick();

      expect(screen.queryByRole("menuitem", { name: /rename/i })).toBeNull();
    });
  });
});
