<script>
  import { setContext, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import MainPage from "@pages/MainPage.svelte";
  import { selected_id, selectOnly, clearSelection, active_row_path } from "@stores/ui";
  import { pendingTaskDetailSelection, clearPendingTaskDetailSelection } from "@stores/ui";
  import { workspace_store } from "../stores/workspace";
  import { workspaceApplication, workspaceNavigation } from "../application/workspace";
  import { TREEGRID_APPLICATION, createTreeGridApplication } from "../application/treegrid";
  import { ganttVisible } from "@stores";
  import { INBOX_SELECTED_ID, resolveInboxNodeId } from "@features/inbox/stores/inbox";
  import { AGENDA_SELECTED_ID } from "@features/agenda/stores/agenda";
  import { tag_index } from "@features/memos/stores/tags";
  const workspacePath = get(workspace_store).activeWorkspacePath;
  const application = createTreeGridApplication(workspacePath);
  setContext(TREEGRID_APPLICATION, application);
  const error = application.error;
  const projection = application.tree;
  let previousScope = "";
  void workspaceApplication.load(workspacePath).catch((e) => error.set(e.message));
  let navigation = $derived($workspaceNavigation);
  $effect.pre(() => {
    if (navigation && !$selected_id) $selected_id = navigation.rootId;
  });
  $effect.pre(() => {
    if (navigation && $selected_id === AGENDA_SELECTED_ID) {
      $ganttVisible = true;
      $selected_id = navigation.rootId;
    }
  });
  $effect.pre(() => {
    if (navigation && $selected_id === INBOX_SELECTED_ID) {
      // 解決規則はヘッダーの Inbox ボタンと共有する。ここだけで解決していたため、
      // ヘッダー側は「いま Inbox を開いているか」を判定できなかった。
      $selected_id = resolveInboxNodeId(navigation) ?? navigation.rootId;
    }
  });
  let rootId = $derived(
    navigation?.names[$selected_id] !== undefined ? $selected_id : navigation?.rootId
  );
  $effect.pre(() => {
    if (rootId && previousScope !== rootId) {
      previousScope = rootId;
      application.scope.set(rootId);
      clearSelection();
      selectOnly(rootId);
      $active_row_path = rootId;
      if (pendingTaskDetailSelection?.projectId === rootId) {
        selectOnly(pendingTaskDetailSelection.taskId);
        $active_row_path = pendingTaskDetailSelection.occurrencePath || rootId;
        const parts = ($active_row_path || "").split("/");
        for (let i = 1; i < parts.length; i++)
          application.closed.delete(parts.slice(0, i).join("/"));
        clearPendingTaskDetailSelection();
      }
    }
  });
  $effect.pre(() => {
    if ($projection) {
      const index = new Map();
      const visit = (node) => {
        for (const value of node.data.tags) {
          const tag = value.toLowerCase();
          if (!index.has(tag)) index.set(tag, new Set());
          index.get(tag).add(node.id);
        }
        node.children.forEach(visit);
      };
      visit($projection.data);
      tag_index.set(index);
    }
  });
  onDestroy(() => {
    application.dispose();
  });
</script>

<main class="workspace-treegrid" aria-label="ノード一覧と詳細">
  {#if $error}<div class="operation-error" role="alert">
      <span>{$error}</span><button aria-label="通知を閉じる" onclick={() => error.set("")}>×</button
      >
    </div>{/if}
  {#if $projection?.truncated}<div role="status">
      表示上限に達しました。Projectを選択して範囲を絞ってください。
    </div>{/if}
  {#if navigation}<MainPage />{:else}<p>Workspaceを読み込み中…</p>{/if}
</main>

<style>
  .workspace-treegrid {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  [role="alert"] {
    color: var(--theme-color-Error-main);
    padding: var(--sp2);
  }
  .operation-error {
    position: fixed;
    top: 2.25rem;
    right: 0.75rem;
    max-width: min(24rem, calc(100vw - 1.5rem));
    z-index: 10000;
    display: flex;
    gap: var(--sp2);
    background: var(--theme-color-Main-light);
    box-shadow: var(--elevation-3);
    border-radius: var(--shape-sm);
  }
</style>
