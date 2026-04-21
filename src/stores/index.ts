import { theme } from "./theme";
import {
  tree_data,
  cancelPendingOperations,
  clearHistory,
  undoHistory,
  redoHistory,
} from "./tree";
import { project_ids, info_ids } from "./project";
import { filter, filtered_data } from "./search";
import {
  selected_type,
  table_selected_id,
  closed_node_ids,
  selected_id,
  showPageSearch,
  setTaskDetailWindowTarget,
} from "./ui";

export type { ThemeStore } from "./theme";
export type { TreeDataStore } from "./tree";
export type { ProjectIdsStore } from "./project";
export type { FilterStore } from "./search";
export type { SelectedIdStore, ClosedNodeIdsStore } from "./ui";

export {
  theme,
  tree_data,
  cancelPendingOperations,
  clearHistory,
  undoHistory,
  redoHistory,
  project_ids,
  info_ids,
  filter,
  filtered_data,
  selected_type,
  table_selected_id,
  closed_node_ids,
  selected_id,
  showPageSearch,
  setTaskDetailWindowTarget,
};

export function init_store() {
  tree_data.init();
  project_ids.init();
  selected_id.init();
  filter.init();
  theme.init();
  closed_node_ids.init();
}
