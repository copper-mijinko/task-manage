// Cross-cutting stores barrel
// 機能横断的なストアのみを export。各 feature 固有のストアは
// @features/<feature>/stores から直接 import すること。

export * from "./theme";
export * from "./ui";
export * from "./panel_coordinator";
export * from "./preferences";
export * from "./navigation_history";

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

import { get } from "svelte/store";
import { tree_data } from "@features/tasks/stores/tree";
import { project_ids } from "@features/projects/stores/project";
import { selected_id, selected_type, closed_node_ids, show_archived } from "./ui";
import { filter } from "@features/search/stores/search";
import { theme } from "./theme";
import { column_settings } from "@features/tasks/stores/column_settings";
import { workspace_store } from "@features/workspace/stores/workspace";
import { workspace_conflict_policy } from "@features/workspace/stores/policy";
import { active_tag } from "@features/memos/stores/tags";
import { sort_state } from "@features/tasks/stores/sort";
import { inbox_store } from "@features/inbox/stores/inbox";
import { date_time_format } from "./preferences";
import { navigation_history } from "./navigation_history";

let initStoreReady: Promise<void> | null = null;

export function init_store(): Promise<void> {
  if (initStoreReady) return initStoreReady;

  const isTaskDetailWindow =
    typeof window !== "undefined" && window.location.hash === "#task-detail-window";

  tree_data.init();
  const projectIdsReady = project_ids.init();
  if (!isTaskDetailWindow) {
    selected_id.init();
  }
  sort_state.init();
  filter.init();
  theme.init();
  closed_node_ids.init();
  show_archived.init();
  column_settings.init();
  const workspaceReady = workspace_store.init();
  workspace_conflict_policy.init();
  inbox_store.init();
  date_time_format.init();

  // 履歴記録は selected_type / selected_id への subscribe を張る。
  // タスク詳細サブウィンドウ (`#task-detail-window`) では戻る/進むの概念が
  // 不要なため、メインウィンドウのときだけ初期化する。
  if (!isTaskDetailWindow) {
    navigation_history.init();
  }

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

  initStoreReady = Promise.all([projectIdsReady, workspaceReady]).then(() => undefined);
  return initStoreReady;
}

/**
 * After init_store() resolves, pick the top-most project to land on:
 * Workspace projects take precedence over InApp (db.json) projects.
 * No-op when a project is already selected (e.g. task-detail window).
 */
export async function autoSelectInitialProject(): Promise<void> {
  await init_store();

  if (get(selected_type) !== undefined) return;

  const workspaceProjects = get(workspace_store).projects ?? [];
  if (workspaceProjects.length > 0) {
    const first = workspaceProjects[0];
    workspace_store.setActiveProject(first.projectDir);
    selected_type.set("WorkspaceProject");
    selected_id.set(first.rootId);
    return;
  }

  const inAppProjects = get(project_ids) ?? [];
  if (inAppProjects.length > 0) {
    selected_type.set("Projects");
    selected_id.set(inAppProjects[0].id);
  }
}
