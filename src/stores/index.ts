export { theme } from "./theme";
export type { ThemeStore } from "./theme";

export {
  tree_data,
  cancelPendingOperations,
  clearHistory,
  undoHistory,
  redoHistory,
} from "./tree";
export type { TreeDataStore } from "./tree";

export { project_ids, info_ids } from "./project";
export type { ProjectIdsStore } from "./project";

export { filter, filtered_data } from "./search";
export type { FilterStore } from "./search";

export {
  selected_type,
  table_selected_id,
  closed_node_ids,
  selected_id,
  showPageSearch,
  setTaskDetailWindowTarget,
} from "./ui";
export type { SelectedIdStore, ClosedNodeIdsStore } from "./ui";

import { tree_data } from "./tree";
import { project_ids } from "./project";
import { selected_id, closed_node_ids } from "./ui";
import { filter } from "./search";
import { theme } from "./theme";

export function init_store() {
  tree_data.init();
  project_ids.init();
  selected_id.init();
  filter.init();
  theme.init();
  closed_node_ids.init();
}
