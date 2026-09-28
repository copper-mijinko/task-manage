import { describe, expect, test } from "vitest";
import {
  SELECTABLE_STATUS_VALUES,
  statusChoices,
  statusLabel,
} from "../../src/lib/utils/status_labels";
import { sortTree } from "../../src/features/tasks/utils/tree_control";

describe("status choices", () => {
  test("hides the legacy Undefined status unless the node already has it", () => {
    expect(SELECTABLE_STATUS_VALUES).not.toContain("Undefined");
    expect(statusChoices("Open")).toEqual(SELECTABLE_STATUS_VALUES);
    expect(statusChoices("Undefined")).toContain("Undefined");
    expect(statusLabel("Undefined")).toBe("未定義");
  });

  test("sorts Undefined after the real statuses and before no status", () => {
    const child = (id: string, status: string) => ({
      id,
      data: { name: id, status },
      children: [],
    });
    const tree = {
      id: "root",
      data: { name: "root", status: "" },
      children: [child("none", ""), child("legacy", "Undefined"), child("open", "Open")],
    };
    const sorted = sortTree(tree as never, { column: "status", direction: "asc" }) as unknown as {
      children: { id: string }[];
    };
    expect(sorted.children.map((node) => node.id)).toEqual(["open", "legacy", "none"]);
  });
});
