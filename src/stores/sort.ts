import { writable, type Writable } from "svelte/store";
import type { SortState } from "../types/app";

export const SORTABLE_COLUMNS = new Set(["name", "status", "start date", "due date"]);

export interface SortStore extends Writable<SortState | null> {
  init: () => void;
  cycle: (column: string) => void;
  clear: () => void;
}

function createSort(): SortStore {
  const { subscribe, set, update } = writable<SortState | null>(null);

  return {
    subscribe,
    set,
    update,
    init: () => {},
    cycle: (column: string) => {
      if (!SORTABLE_COLUMNS.has(column)) return;
      update((current) => {
        if (!current || current.column !== column) return { column, direction: "asc" };
        if (current.direction === "asc") return { column, direction: "desc" };
        return null;
      });
    },
    clear: () => set(null),
  };
}

export const sort_state = createSort();
