import { fireEvent, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import TreeTableHeader from "../../src/features/tasks/components/TreeTableHeader.svelte";
import { renderWithApplicationStub } from "../helpers/application_stub";

const headers = [{ name: "name" }, { name: "status" }];

describe("TreeTableHeader", () => {
  test("the header checkbox selects every row, then clears the selection", async () => {
    const onselectall = vi.fn();
    const onclearselection = vi.fn();
    const props = {
      headers,
      allHeaders: headers,
      selectableCount: 2,
      onselectall,
      onclearselection,
    };

    const { unmount } = renderWithApplicationStub(TreeTableHeader, { ...props, selectedCount: 0 });
    await fireEvent.click(screen.getByRole("checkbox", { name: "すべて選択" }));
    expect(onselectall).toHaveBeenCalledTimes(1);
    unmount();

    renderWithApplicationStub(TreeTableHeader, { ...props, selectedCount: 2 });
    await fireEvent.click(screen.getByRole("checkbox", { name: "選択を解除" }));
    expect(onclearselection).toHaveBeenCalledTimes(1);
  });
});
