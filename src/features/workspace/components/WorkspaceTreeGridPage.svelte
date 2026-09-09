<script>
  import { setContext, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import MainPage from "@pages/MainPage.svelte";
  import { selected_id, selectOnly, clearSelection, active_row_path } from "@stores/ui";
  import { workspace_store } from "../stores/workspace";
  import { workspaceApplication, workspaceNavigation } from "../application/workspace";
  import { TREEGRID_APPLICATION, createTreeGridApplication } from "../application/treegrid";
  import { ganttVisible } from "@stores";
  import { INBOX_SELECTED_ID } from "@features/inbox/stores/inbox";
  import { AGENDA_SELECTED_ID } from "@features/agenda/stores/agenda";
  import { tag_index } from "@features/memos/stores/tags";
  const workspacePath = get(workspace_store).activeWorkspacePath;
  const application = createTreeGridApplication(workspacePath);
  setContext(TREEGRID_APPLICATION, application);
  const error = application.error;
  const projection = application.tree;
  let previousScope = "";
  void workspaceApplication.load(workspacePath).catch((e) => error.set(e.message));
  $: navigation = $workspaceNavigation;
  $: if (navigation && !$selected_id) $selected_id = navigation.rootId;
  $: if (navigation && $selected_id === AGENDA_SELECTED_ID) {
    $ganttVisible = true;
    $selected_id = navigation.rootId;
  }
  $: if (navigation && $selected_id === INBOX_SELECTED_ID) {
    $selected_id =
      navigation.inboxId ||
      Object.entries(navigation.names).find(([, name]) => name.toLowerCase() === "inbox")?.[0] ||
      navigation.rootId;
  }
  $: rootId = navigation?.names[$selected_id] !== undefined ? $selected_id : navigation?.rootId;
  $: if (rootId && previousScope !== rootId) {
    previousScope = rootId;
    application.scope.set(rootId);
    clearSelection();
    selectOnly(rootId);
    $active_row_path = rootId;
  }
  $: if ($projection) {
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
  onDestroy(() => {
    application.dispose();
    clearSelection();
  });
</script>

<main class="workspace-treegrid" aria-label="Workspace TreeGrid">
  {#if navigation}
    <nav class="scope-bar" aria-label="現在の表示範囲">
      <span>{navigation.names[rootId]}</span>
      <span>検索・列フィルタはこの範囲が対象です</span>
    </nav>
  {/if}
  {#if $error}<div class="operation-error" role="alert">
      <span>{$error}</span><button aria-label="通知を閉じる" on:click={() => error.set("")}
        >×</button
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
  .scope-bar {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2);
    flex-wrap: wrap;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
  }
  [role="alert"] {
    color: var(--theme-color-Error-main);
    padding: var(--sp2);
  }
  .operation-error {
    position: fixed;
    top: 3rem;
    right: 1rem;
    max-width: min(32rem, calc(100vw - 2rem));
    z-index: 10000;
    display: flex;
    gap: var(--sp2);
    background: var(--theme-color-Main-light);
    box-shadow: var(--elevation-3);
    border-radius: var(--shape-sm);
  }
  @media (max-width: 850px) {
    .scope-bar > span + span {
      display: none;
    }
  }
</style>
