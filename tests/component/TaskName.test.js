import { fireEvent, render, screen } from "@testing-library/svelte";

import TaskNameClickHarness from "../mocks/TaskNameClickHarness.svelte";

describe("TaskName", () => {
  test("allows click on read-only input to bubble to row selection handler", async () => {
    render(TaskNameClickHarness);

    const input = screen.getByDisplayValue("Task 1");
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute("readonly");

    await fireEvent.click(input);

    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
