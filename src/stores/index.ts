export * from "./theme";
export * from "./tree";
export * from "./project";
export * from "./search";
export * from "./ui";

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
