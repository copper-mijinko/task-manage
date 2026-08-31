import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import SearchBox from "@lib/primitives/SearchBox.svelte";
import { filter } from "@stores";

describe("SearchBox", () => {
  beforeEach(() => {
    filter.set({});
  });

  test("updates the full-text filter as the user types", async () => {
    render(SearchBox);

    const input = screen.getByLabelText("タスク一覧を絞り込み");
    await fireEvent.input(input, { target: { value: "release" } });

    expect(get(filter)).toEqual({
      full_text: ["release"],
    });
  });

  test("confirms a chip on Enter and keeps typing further AND terms", async () => {
    render(SearchBox);

    const input = screen.getByLabelText("タスク一覧を絞り込み");
    await fireEvent.input(input, { target: { value: "release" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();

    // Chip confirmed, input cleared, filter still reflects the single term.
    expect(input).toHaveValue("");
    expect(get(filter)).toEqual({
      full_text: ["release"],
    });
    expect(screen.getByText("release")).toBeInTheDocument();

    // Typing a second term narrows further (AND) before it's confirmed.
    await fireEvent.input(input, { target: { value: "urgent" } });
    expect(get(filter)).toEqual({
      full_text: ["release", "urgent"],
    });

    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();
    expect(input).toHaveValue("");
    expect(get(filter)).toEqual({
      full_text: ["release", "urgent"],
    });
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  test("confirming a duplicate chip (case-insensitive) is ignored and just clears the input", async () => {
    render(SearchBox);

    const input = screen.getByLabelText("タスク一覧を絞り込み");
    await fireEvent.input(input, { target: { value: "release" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();

    expect(get(filter)).toEqual({
      full_text: ["release"],
    });

    // Re-typing the same term (different casing) and confirming again should
    // not add a second chip.
    await fireEvent.input(input, { target: { value: "Release" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();

    expect(input).toHaveValue("");
    expect(get(filter)).toEqual({
      full_text: ["release"],
    });
    expect(screen.getAllByText(/release/i)).toHaveLength(1);
  });

  test("external store updates with a duplicate full_text entry collapse to a single chip", async () => {
    render(SearchBox);

    filter.set({ full_text: ["backlog", "Backlog", "urgent"] });
    await tick();

    expect(screen.getAllByText(/backlog/i)).toHaveLength(1);
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  test("removes the last chip with Backspace when input is empty", async () => {
    render(SearchBox);

    const input = screen.getByLabelText("タスク一覧を絞り込み");
    await fireEvent.input(input, { target: { value: "release" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();
    await fireEvent.input(input, { target: { value: "urgent" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();

    expect(get(filter)).toEqual({
      full_text: ["release", "urgent"],
    });

    await fireEvent.keyDown(input, { key: "Backspace" });
    await tick();

    expect(get(filter)).toEqual({
      full_text: ["release"],
    });
    expect(screen.queryByText("urgent")).not.toBeInTheDocument();
  });

  test("removes an individual chip via its x button", async () => {
    render(SearchBox);

    const input = screen.getByLabelText("タスク一覧を絞り込み");
    await fireEvent.input(input, { target: { value: "release" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();
    await fireEvent.input(input, { target: { value: "urgent" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();

    const removeButton = screen.getByRole("button", { name: /「release」を削除/ });
    await fireEvent.click(removeButton);
    await tick();

    expect(get(filter)).toEqual({
      full_text: ["urgent"],
    });
    expect(screen.queryByText("release")).not.toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  test("clears the filter on Escape and keeps focus in the input", async () => {
    filter.set({ full_text: ["release"] });
    render(SearchBox);

    const input = screen.getByRole("textbox");
    input.focus();
    await tick();

    await fireEvent.keyDown(input, { key: "Escape" });

    expect(get(filter)).toEqual({
      full_text: null,
    });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  test("Escape also clears already-confirmed chips, not just typed text", async () => {
    render(SearchBox);

    const input = screen.getByLabelText("タスク一覧を絞り込み");
    await fireEvent.input(input, { target: { value: "release" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await tick();
    await fireEvent.input(input, { target: { value: "urgent" } });

    input.focus();
    await fireEvent.keyDown(input, { key: "Escape" });
    await tick();

    expect(get(filter)).toEqual({
      full_text: null,
    });
    expect(input).toHaveValue("");
    expect(screen.queryByText("release")).not.toBeInTheDocument();
  });

  test("reflects store updates when the input is not focused", async () => {
    render(SearchBox);

    filter.set({ full_text: ["backlog"] });
    await tick();

    expect(screen.getByText("backlog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  test("reflects multiple store entries as chips when not focused", async () => {
    render(SearchBox);

    filter.set({ full_text: ["backlog", "urgent"] });
    await tick();

    expect(screen.getByText("backlog")).toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });
});
