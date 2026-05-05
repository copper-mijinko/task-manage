export * from "./theme";
export * from "./tree";
export * from "./gantt";
export * from "./project";
export * from "./search";
export * from "./ui";
export * from "./column_settings";
export * from "./workspace";
export * from "./tags";

import { tree_data } from "./tree";
import { project_ids } from "./project";
import { selected_id, closed_node_ids } from "./ui";
import { filter } from "./search";
import { theme } from "./theme";
import { column_settings } from "./column_settings";
import { workspace_store } from "./workspace";
import { active_tag } from "./tags";

export function init_store() {
  tree_data.init();
  project_ids.init();
  selected_id.init();
  filter.init();
  theme.init();
  closed_node_ids.init();
  column_settings.init();
  workspace_store.init();

  active_tag.subscribe((tag) => {
    filter.update((f) => {
      const next = { ...f };
      if (tag) {
        next["tags"] = [tag];
      } else {
        delete next["tags"];
      }
      return next;
    });
  });
}
