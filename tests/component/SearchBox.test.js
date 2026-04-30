import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import SearchBox from "../../src/components/SearchBox.svelte";
import { filter } from "../../src/stores.ts";

describe("SearchBox", () => {
  beforeEach(() => {
    filter.set({});
  });

  test("updates the full-text filter as the user types", async () => {
    render(SearchBox);

    const input = screen.getByPlaceholderText("filter tasks...");
    await fireEvent.input(input, { target: { value: "release" } });

    expect(get(filter)).toEqual({
      full_text: ["release"],
    });
  });

  test("clears the filter on Escape and keeps focus in the input", async () => {
    filter.set({ full_text: ["release"] });
    render(SearchBox);

    const input = screen.getByPlaceholderText("filter tasks...");
    input.focus();

    await fireEvent.keyDown(input, { key: "Escape" });

    expect(get(filter)).toEqual({
      full_text: null,
    });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  test("reflects store updates when the input is not focused", async () => {
    render(SearchBox);

    filter.set({ full_text: ["backlog"] });
    await tick();

    expect(screen.getByPlaceholderText("filter tasks...")).toHaveValue("backlog");
  });
});
