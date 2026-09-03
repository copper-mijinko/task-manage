import { describe, expect, it } from "vitest";
import {
  bucketForDueDate,
  buildAgendaItemsForProject,
  daysBetweenIsoDates,
  sortAgendaItems,
  todayIsoDate,
} from "../../src/features/agenda/stores/agenda";
import type { WorkspaceTask } from "../../src/types/workspace";

const project = { name: "Proj", projectDir: "/ws/proj", rootId: "root" };

function task(overrides: Partial<WorkspaceTask> & { id: string }): WorkspaceTask {
  return {
    name: overrides.id,
    status: "Open",
    parents: ["root"],
    memos: [],
    createdAt: "2026-01-01",
    ...overrides,
  } as WorkspaceTask;
}

const root = task({ id: "root", name: "Proj", parents: [] });

describe("date helpers", () => {
  it("formats today in local time, not UTC", () => {
    // ローカル 23:30 の日付が UTC 変換で翌日にずれないこと。
    expect(todayIsoDate(new Date(2026, 8, 3, 23, 30))).toBe("2026-09-03");
  });

  it("counts whole days between ISO dates", () => {
    expect(daysBetweenIsoDates("2026-09-03", "2026-09-10")).toBe(7);
    expect(daysBetweenIsoDates("2026-09-03", "2026-09-01")).toBe(-2);
  });

  it("buckets due dates around today", () => {
    const today = "2026-09-03";
    expect(bucketForDueDate("2026-09-01", today)).toBe("overdue");
    expect(bucketForDueDate("2026-09-03", today)).toBe("today");
    expect(bucketForDueDate("2026-09-10", today)).toBe("soon");
    expect(bucketForDueDate("2026-09-11", today)).toBe("later");
    expect(bucketForDueDate(undefined, today)).toBe("someday");
  });
});

describe("buildAgendaItemsForProject", () => {
  const today = "2026-09-03";

  it("skips the project root, completed and cancelled tasks", () => {
    const tasks = {
      root,
      a: task({ id: "a", name: "A", dueDate: "2026-09-03" }),
      done: task({ id: "done", name: "Done", status: "Completed", dueDate: "2026-09-03" }),
      dropped: task({ id: "dropped", name: "Dropped", status: "Canceled" }),
    };

    const items = buildAgendaItemsForProject(tasks, project, today);
    expect(items.map((item) => item.name)).toEqual(["A"]);
    expect(items[0].bucket).toBe("today");
    expect(items[0].projectName).toBe("Proj");
  });

  it("drops archived tasks and their descendants", () => {
    const tasks = {
      root,
      archived: task({ id: "archived", name: "Archived", archived: true }),
      child: task({ id: "child", name: "Child", parents: ["archived"] }),
      grandchild: task({ id: "grandchild", name: "Grandchild", parents: ["child"] }),
      live: task({ id: "live", name: "Live" }),
    };

    expect(buildAgendaItemsForProject(tasks, project, today).map((item) => item.name)).toEqual([
      "Live",
    ]);
  });

  it("shows the parent task name as context but not the project root", () => {
    const tasks = {
      root,
      parent: task({ id: "parent", name: "Parent" }),
      child: task({ id: "child", name: "Child", parents: ["parent"] }),
    };

    const items = buildAgendaItemsForProject(tasks, project, today);
    expect(items.find((item) => item.name === "Child")?.parentPath).toBe("Parent");
    expect(items.find((item) => item.name === "Parent")?.parentPath).toBe("");
  });

  it("carries task tags through", () => {
    const tasks = { root, a: task({ id: "a", name: "A", tags: ["Frontend", "frontend"] }) };
    expect(buildAgendaItemsForProject(tasks, project, today)[0].tags).toEqual(["frontend"]);
  });
});

describe("sortAgendaItems", () => {
  it("orders by due date and puts undated tasks last", () => {
    const today = "2026-09-03";
    const items = buildAgendaItemsForProject(
      {
        root,
        late: task({ id: "late", name: "Late", dueDate: "2026-09-20" }),
        none: task({ id: "none", name: "None" }),
        soon: task({ id: "soon", name: "Soon", dueDate: "2026-09-04" }),
      },
      project,
      today
    );

    expect(sortAgendaItems(items).map((item) => item.name)).toEqual(["Soon", "Late", "None"]);
  });
});
