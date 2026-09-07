import type { WorkspaceTask } from "@app-types/workspace";

export type ScheduleKind = "bar" | "point" | "status-only" | "invalid";

export interface NodeScheduleRow {
  id: string;
  task: WorkspaceTask;
  kind: ScheduleKind;
  startDate?: string;
  dueDate?: string;
  error?: string;
}

export interface NodeScheduleOptions {
  showArchived?: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Build one schedule row per node, independent of how many parents reference it. */
export function buildNodeSchedule(
  nodes: Record<string, WorkspaceTask>,
  rootId: string,
  options: NodeScheduleOptions = {}
): NodeScheduleRow[] {
  return Object.values(nodes)
    .filter((task) => task.id !== rootId && (options.showArchived || !task.archived))
    .filter((task) => {
      const hasStatus =
        Object.prototype.hasOwnProperty.call(task, "status") &&
        typeof task.status === "string" &&
        task.status.trim().length > 0;
      return hasStatus || hasValue(task.startDate) || hasValue(task.dueDate);
    })
    .map((task): NodeScheduleRow => {
      const start = hasValue(task.startDate) ? task.startDate : undefined;
      const due = hasValue(task.dueDate) ? task.dueDate : undefined;
      const invalidStart = start !== undefined && !isValidIsoDate(start);
      const invalidDue = due !== undefined && !isValidIsoDate(due);
      if (invalidStart || invalidDue) {
        return {
          id: task.id,
          task,
          kind: "invalid",
          startDate: start,
          dueDate: due,
          error: invalidStart
            ? "開始日は YYYY-MM-DD 形式で入力してください"
            : "期限日は YYYY-MM-DD 形式で入力してください",
        };
      }
      if (start && due && due < start) {
        return {
          id: task.id,
          task,
          kind: "invalid",
          startDate: start,
          dueDate: due,
          error: "期限日は開始日以降にしてください",
        };
      }
      if (start && due) return { id: task.id, task, kind: "bar", startDate: start, dueDate: due };
      if (start || due) return { id: task.id, task, kind: "point", startDate: start, dueDate: due };
      return { id: task.id, task, kind: "status-only" };
    })
    .sort((a, b) => a.task.name.localeCompare(b.task.name, "ja") || a.id.localeCompare(b.id));
}

export function scheduleDate(row: NodeScheduleRow): string | undefined {
  return row.startDate ?? row.dueDate;
}
