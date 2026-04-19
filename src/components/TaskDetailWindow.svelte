<script>
  import { getNode } from "../common/tree_control.ts";
  import { selected_id, tree_data } from "../stores.ts";
  import Button from "./Button.svelte";
  import Card from "./Card.svelte";
  import TaskDetail from "./TaskDetail.svelte";

  export let initialTaskName = "Task Detail";
  export let initialTaskId = "";
  export let initialProjectId = "";
  export let ready = false;

  $: node = initialTaskId && $tree_data ? getNode(initialTaskId, $tree_data.data) : undefined;
  $: taskName = node?.data?.name || initialTaskName;
  $: isProjectDeleted = ready && initialProjectId && $selected_id !== initialProjectId;
  $: isTaskDeleted =
    ready &&
    !isProjectDeleted &&
    !!initialTaskId &&
    !!$selected_id &&
    $selected_id === initialProjectId &&
    !node;
</script>

<div class="detail-window">
  <div class="detail-header">
    <div class="detail-meta">
      <p class="eyebrow">Task Detail</p>
      <h1>{taskName}</h1>
    </div>
    <Button
      content="閉じる"
      on:click={() => {
        window.close();
      }}
    />
  </div>

  <Card style={"width: 100%; height: 100%; padding: 0;"}>
    <div class="detail-body">
      {#if !ready}
        <div class="empty-state">
          <h2>Loading...</h2>
        </div>
      {:else if isProjectDeleted}
        <div class="empty-state">
          <h2>Project not found.</h2>
          <p>The project for this detail window was deleted.</p>
        </div>
      {:else if isTaskDeleted}
        <div class="empty-state">
          <h2>Task not found.</h2>
          <p>The target task was deleted. Rename is still tracked by task ID.</p>
        </div>
      {:else}
        <TaskDetail />
      {/if}
    </div>
  </Card>
</div>

<style>
  .detail-window {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 1rem;
    box-sizing: border-box;
    gap: 1rem;
    background: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-main);
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .detail-meta h1,
  .detail-meta p {
    margin: 0;
  }

  .eyebrow {
    color: var(--theme-color-Accent-main);
    font-size: 0.95rem;
    margin-bottom: 0.35rem;
  }

  .detail-body {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .empty-state {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 0.5rem;
    color: var(--theme-color-Sub-main);
  }

  .empty-state h2,
  .empty-state p {
    margin: 0;
  }
</style>
