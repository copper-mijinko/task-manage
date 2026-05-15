import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";

import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
import StatusSelectHarness from "../mocks/StatusSelectHarness.svelte";

describe("StatusSelect", () => {
  test("shows the current status text on the trigger button", () => {
    const { getByLabelText } = render(StatusSelect, { props: { status: "In Progress" } });

    const btn = getByLabelText("Status");
    expect(btn).toHaveTextContent("In Progress");
  });

  test("clicking the trigger opens the option listbox", async () => {
    const { getByLabelText } = render(StatusSelect, { props: { status: "Open" } });

    expect(screen.queryByRole("listbox")).toBeNull();

    await fireEvent.click(getByLabelText("Status"));
    await tick();

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // All status options are visible.
    expect(screen.getByRole("option", { name: /Open/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /In Progress/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Pending/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Completed/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Canceled/ })).toBeInTheDocument();
  });

  test("selecting a new option dispatches a `change` event with target.value", async () => {
    const { getByLabelText, getByTestId } = render(StatusSelectHarness, {
      props: { status: "Open" },
    });

    await fireEvent.click(getByLabelText("Status"));
    await tick();
    await fireEvent.click(screen.getByRole("option", { name: /In Progress/ }));
    await tick();

    expect(getByTestId("change-count")).toHaveTextContent("1");
    // Backwards-compatible payload: both `value` and `target.value` exist so
    // both the new (`event.detail.value`) and the legacy (`event.target.value`)
    // callers keep working.
    expect(getByTestId("last-value")).toHaveTextContent("In Progress");
    expect(getByTestId("last-target-value")).toHaveTextContent("In Progress");
  });

  test("selecting the same option does not dispatch a change event", async () => {
    const { getByLabelText, getByTestId } = render(StatusSelectHarness, {
      props: { status: "Pending" },
    });

    await fireEvent.click(getByLabelText("Status"));
    await tick();
    await fireEvent.click(screen.getByRole("option", { name: /Pending/ }));
    await tick();

    expect(getByTestId("change-count")).toHaveTextContent("0");
  });

  test("does NOT propagate the status colour to the option list (regression)", async () => {
    // Before refactor, the native <select> inherited `color` so every option
    // line in the dropdown took on the selected status's colour. The custom
    // popup must reset color on the listbox so options stay neutral.
    const { getByLabelText } = render(StatusSelect, { props: { status: "Completed" } });

    await fireEvent.click(getByLabelText("Status"));
    await tick();

    const listbox = screen.getByRole("listbox");
    // The popup's own `color` is the neutral Sub-main token, NOT
    // Success-main. We assert it's not the Success token, regardless of
    // whether the env can resolve CSS variables.
    expect(listbox.getAttribute("style") ?? "").not.toContain("Success-main");
  });

  test("clicking outside the panel closes it", async () => {
    const { getByLabelText } = render(StatusSelect, { props: { status: "Open" } });

    await fireEvent.click(getByLabelText("Status"));
    await tick();
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Outside click on a freshly created element appended to body.
    const sink = document.createElement("div");
    sink.setAttribute("data-outside", "1");
    document.body.appendChild(sink);
    await fireEvent.click(sink);
    await tick();

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
