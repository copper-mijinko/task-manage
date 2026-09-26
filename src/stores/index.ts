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
export * from "@features/tasks/stores/column_settings";
export * from "@features/tasks/stores/sort";
export * from "@features/memos/stores/tags";
export * from "@features/gantt/stores/gantt";
export * from "@features/workspace/stores/workspace";
export * from "@features/search/stores/search";
export * from "@features/inbox/stores/inbox";

import { get } from "svelte/store";
import { selected_id, selected_type, show_archived } from "./ui";
import { filter } from "@features/search/stores/search";
import { theme } from "./theme";
import { column_settings } from "@features/tasks/stores/column_settings";
import { workspace_store } from "@features/workspace/stores/workspace";
import { active_tag } from "@features/memos/stores/tags";
import { sort_state } from "@features/tasks/stores/sort";
import { date_time_format, ui_density } from "./preferences";
import { navigation_history } from "./navigation_history";

let initStoreReady: Promise<void> | null = null;
let initDetailStoreReady: Promise<void> | null = null;

/**
 * ノード詳細ウィンドウに要るストアだけを初期化する。ナビゲーションや
 * 絞り込み・列設定は本体ウィンドウだけのもの。
 */
export function init_detail_store(): Promise<void> {
  if (initDetailStoreReady) return initDetailStoreReady;
  theme.init();
  date_time_format.init();
  ui_density.init();
  initDetailStoreReady = Promise.resolve();
  return initDetailStoreReady;
}

export function init_store(): Promise<void> {
  if (initStoreReady) return initStoreReady;

  sort_state.init();
  theme.init();
  show_archived.init();
  column_settings.init();
  const workspaceReady = workspace_store.init();
  date_time_format.init();
  ui_density.init();
  navigation_history.init();

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

  initStoreReady = workspaceReady;
  return initStoreReady;
}

/**
 * 起動時、ワークスペースが登録済みならそれを開く。選ぶプロジェクトは
 * ページ（`WorkspaceTreeGridPage`）がグラフを読んでから決める。
 */
export async function autoSelectInitialProject(): Promise<void> {
  await init_store();
  if (get(selected_type) !== undefined) return;
  if (get(workspace_store).activeWorkspacePath) {
    selected_type.set("WorkspaceProject");
    selected_id.set(undefined);
  }
}
