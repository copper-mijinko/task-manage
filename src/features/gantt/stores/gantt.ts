import { writable } from "svelte/store";

export type GanttScale = "day" | "week" | "month";

export const ganttVisible = writable(false);
export const ganttScrollTop = writable(0);
export const ganttScale = writable<GanttScale>("day");
