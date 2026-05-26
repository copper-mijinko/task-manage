// Cross-cutting stores barrel
// 機能横断的なストアのみを export。各 feature 固有のストアは
// @features/<feature>/stores から直接 import すること。

export * from "./theme";
export * from "./ui";
export * from "./panel_coordinator";
export * from "./preferences";

// Feature stores も互換性のため再エクスポート
// 新規コードは @features/* から直接 import を推奨
export * from "@features/tasks/stores/tree";
export * from "@features/tasks/stores/column_settings";
export * from "@features/tasks/stores/sort";
export * from "@features/memos/stores/tags";
export * from "@features/gantt/stores/gantt";
export * from "@features/workspace/stores/workspace";
export * from "@features/workspace/stores/policy";
export * from "@features/projects/stores/project";
export * from "@features/search/stores/search";
export * from "@features/inbox/stores/inbox";

import { tree_data } from "@features/tasks/stores/tree";
import { project_ids } from "@features/projects/stores/project";
import { selected_id, closed_node_ids } from "./ui";
import { filter } from "@features/search/stores/search";
import { theme } from "./theme";
import { column_settings } from "@features/tasks/stores/column_settings";
import { workspace_store } from "@features/workspace/stores/workspace";
import { workspace_conflict_policy } from "@features/workspace/stores/policy";
import { active_tag } from "@features/memos/stores/tags";
import { sort_state } from "@features/tasks/stores/sort";
import { inbox_store } from "@features/inbox/stores/inbox";
import { date_time_format } from "./preferences";

export function init_store() {
  tree_data.init();
  project_ids.init();
  selected_id.init();
  sort_state.init();
  filter.init();
  theme.init();
  closed_node_ids.init();
  column_settings.init();
  workspace_store.init();
  workspace_conflict_policy.init();
  inbox_store.init();
  date_time_format.init();

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
