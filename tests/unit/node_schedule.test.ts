import { describe, expect, it } from "vitest";
import { buildNodeSchedule, isValidIsoDate } from "@features/gantt/utils/node_schedule";
import type { WorkspaceTask } from "@app-types/workspace";

const task = (id: string, over: Partial<WorkspaceTask> = {}) =>
  ({ id, name: id, parents: [], createdAt: "2026-01-01", ...over }) as WorkspaceTask;

describe("node schedule", () => {
  it("classifies bars, points, status-only rows and excludes root/archived", () => {
    const rows = buildNodeSchedule(
      {
        root: task("root"),
        bar: task("bar", { startDate: "2026-01-02", dueDate: "2026-01-04" }),
        point: task("point", { dueDate: "2026-01-05" }),
        status: task("status", { status: "Undefined" as never }),
        archived: task("archived", { dueDate: "2026-01-06", archived: true }),
      },
      "root"
    );
    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      ["bar", "bar"],
      ["point", "point"],
      ["status", "status-only"],
    ]);
    expect(
      buildNodeSchedule(
        { archived: task("archived", { dueDate: "2026-01-02", archived: true }) },
        "root",
        { showArchived: true }
      )
    ).toHaveLength(1);
  });

  it("reports malformed dates and reversed ranges without fabricating dates", () => {
    const rows = buildNodeSchedule(
      {
        bad: task("bad", { startDate: "2026-02-31" }),
        reversed: task("reversed", { startDate: "2026-02-05", dueDate: "2026-02-01" }),
        none: task("none"),
      },
      "root"
    );
    expect(rows.find((row) => row.id === "bad")?.kind).toBe("invalid");
    expect(rows.find((row) => row.id === "reversed")?.error).toContain("以降");
    expect(rows.find((row) => row.id === "none")?.startDate).toBeUndefined();
    expect(rows.some((row) => row.id === "none")).toBe(false);
  });

  it("validates calendar dates strictly", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-2-1")).toBe(false);
  });

  it("does not treat omitted, empty, or null status as configured", () => {
    const rows = buildNodeSchedule(
      {
        omitted: task("omitted"),
        empty: task("empty", { status: "" as never }),
        nullable: task("nullable", { status: null as never }),
        explicit: task("explicit", { status: "Undefined" as never }),
      },
      "root"
    );
    expect(rows.map((row) => row.id)).toEqual(["explicit"]);
  });
});
