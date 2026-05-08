import { debounce } from "lodash";
import { get, writable, type Writable } from "svelte/store";
import {
  filterTree,
  getNode,
  sortTree,
  type ProjectData,
  type TreeData,
} from "../common/tree_control";
import type { FilterState, SortState } from "../types/app";
import { tree_data } from "./tree";
import { table_selected_id } from "./ui";
import { sort_state } from "./sort";

export interface FilterStore extends Writable<FilterState> {
  init: () => void;
}

function createFilter(initialValue: FilterState): FilterStore {
  const { subscribe, set, update } = writable<FilterState>(initialValue);

  const syncFilteredData = (
    current: FilterState,
    currentTreeData: ProjectData | undefined,
    currentSort: SortState | null
  ) => {
    if (!currentTreeData) {
      applyFilteredData.cancel();
      filtered_data.set(undefined);
      table_selected_id.set(undefined);
      return;
    }

    if (!hasActiveFilters(current)) {
      applyFilteredData.cancel();
      const nextTree = (sortTree(currentTreeData.data, currentSort) ??
        currentTreeData.data) as TreeData;
      if (
        !get(table_selected_id) ||
        !nextTree ||
        !getNode(get(table_selected_id) as string, nextTree)
      ) {
        table_selected_id.set(undefined);
      }

      filtered_data.set(nextTree);
      return;
    }

    applyFilteredData(current, currentTreeData, currentSort);
  };

  const applyFilteredData = debounce(
    (current: FilterState, currentTreeData: ProjectData, currentSort: SortState | null) => {
      const filtered = filterTree(currentTreeData.data, current);
      const sorted = (sortTree(filtered, currentSort) ?? filtered) as TreeData | null | undefined;
      if (
        !get(table_selected_id) ||
        !sorted ||
        !getNode(get(table_selected_id) as string, sorted)
      ) {
        table_selected_id.set(undefined);
      }

      filtered_data.set(sorted);
    },
    500
  );

  const hasActiveFilters = (current: FilterState) =>
    Object.keys(current || {}).some((key) => current[key] && current[key].length > 0);

  return {
    subscribe,
    set,
    update,
    init: () => {
      subscribe((current) => {
        syncFilteredData(current, get(tree_data), get(sort_state));
      });

      tree_data.subscribe((currentTreeData) => {
        syncFilteredData(
          get({ subscribe } as Writable<FilterState>),
          currentTreeData,
          get(sort_state)
        );
      });

      sort_state.subscribe((currentSort) => {
        syncFilteredData(get({ subscribe } as Writable<FilterState>), get(tree_data), currentSort);
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let filter: FilterStore = createFilter({});
export const filtered_data = writable<TreeData | null | undefined>(undefined);
export const pageSearchQuery = writable<string>("");
