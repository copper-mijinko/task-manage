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
  $: if (navigation && $selected_id === AGENDA_SELECTED_ID) {
    $ganttVisible = true;
    $selected_id = navigation.rootId;
  }
  $: if (navigation && $selected_id === INBOX_SELECTED_ID) {
    $selected_id =
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
  $: scopes = navigation?.scopes ?? [];
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
    <nav class="scope-bar" aria-label="表示範囲">
      <button
        class:active={rootId === navigation.rootId}
        on:click={() => ($selected_id = navigation.rootId)}>Workspace Root</button
      >
      <label
        >Project
        <select
          aria-label="Project scope"
          value={rootId}
          on:change={(e) => ($selected_id = e.currentTarget.value)}
        >
          <option value={navigation.rootId}>Workspace 全体</option>
          {#each scopes as scope}<option value={scope.rootId}>{scope.name}</option>{/each}
          {#if rootId !== navigation.rootId && !scopes.some((scope) => scope.rootId === rootId)}<option
              value={rootId}>{navigation.names[rootId]}</option
            >{/if}
        </select>
      </label>
      <span>検索・絞り込みは現在の範囲が対象です</span>
    </nav>
  {/if}
  {#if $error}<div role="alert">{$error}</div>{/if}
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
  .scope-bar label {
    display: flex;
    gap: var(--sp2);
    align-items: center;
    min-width: 0;
  }
  button,
  select {
    background: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-light);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-sm);
    padding: 0.25rem 0.5rem;
    max-width: 20rem;
  }
  button.active {
    border-color: var(--theme-color-Primary-main);
  }
  [role="alert"] {
    color: var(--theme-color-Error-main);
    padding: var(--sp2);
  }
  @media (max-width: 850px) {
    .scope-bar > span {
      display: none;
    }
  }
</style>
