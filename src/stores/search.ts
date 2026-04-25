import { debounce } from "lodash";
import { get, writable, type Writable } from "svelte/store";
import { filterTree, getNode, type ProjectData, type TreeData } from "../common/tree_control";
import type { FilterState } from "../types/app";
import { tree_data } from "./tree";
import { table_selected_id } from "./ui";

export interface FilterStore extends Writable<FilterState> {
  init: () => void;
}

function createFilter(initialValue: FilterState): FilterStore {
  const { subscribe, set, update } = writable<FilterState>(initialValue);

  const syncFilteredData = (current: FilterState, currentTreeData: ProjectData | undefined) => {
    if (!currentTreeData) {
      applyFilteredData.cancel();
      filtered_data.set(undefined);
      table_selected_id.set(undefined);
      return;
    }

    if (!hasActiveFilters(current)) {
      applyFilteredData.cancel();
      const nextTree = currentTreeData.data;
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

    applyFilteredData(current, currentTreeData);
  };

  const applyFilteredData = debounce((current: FilterState, currentTreeData: ProjectData) => {
    const filtered = filterTree(currentTreeData.data, current);
    if (
      !get(table_selected_id) ||
      !filtered ||
      !getNode(get(table_selected_id) as string, filtered)
    ) {
      table_selected_id.set(undefined);
    }

    filtered_data.set(filtered);
  }, 300);

  const hasActiveFilters = (current: FilterState) =>
    Object.keys(current || {}).some((key) => current[key] && current[key].length > 0);

  return {
    subscribe,
    set,
    update,
    init: () => {
      subscribe((current) => {
        syncFilteredData(current, get(tree_data));
      });

      tree_data.subscribe((currentTreeData) => {
        syncFilteredData(get({ subscribe } as Writable<FilterState>), currentTreeData);
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let filter: FilterStore = createFilter({});
export const filtered_data = writable<TreeData | null | undefined>(undefined);
export const pageSearchQuery = writable<string>("");
