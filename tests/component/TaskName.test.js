import { fireEvent, render, screen } from "@testing-library/svelte";

import TaskNameClickHarness from "../mocks/TaskNameClickHarness.svelte";

describe("TaskName", () => {
  test("allows click on disabled input to bubble to row selection handler", async () => {
    render(TaskNameClickHarness);

    await fireEvent.click(screen.getByDisplayValue("Task 1"));

    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
