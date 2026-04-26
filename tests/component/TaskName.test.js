import { fireEvent, render, screen } from "@testing-library/svelte";

import TaskNameClickHarness from "../mocks/TaskNameClickHarness.svelte";
import TaskNameCommitHarness from "../mocks/TaskNameCommitHarness.svelte";

describe("TaskName", () => {
  test("allows click on read-only input to bubble to row selection handler", async () => {
    render(TaskNameClickHarness);

    const input = screen.getByDisplayValue("Task 1");
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute("readonly");

    await fireEvent.click(input);

    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  describe("empty/whitespace validation", () => {
    async function enterEditingMode() {
      const editButton = screen.getByRole("button", { name: /edit task name/i });
      await fireEvent.click(editButton);
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
});
