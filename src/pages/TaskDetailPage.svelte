<script>
  import { getNode } from "@features/tasks/utils/tree_control";
  import { selected_id, tree_data } from "@stores";
  import Button from "@lib/primitives/Button.svelte";
  import TaskDetail from "@features/tasks/components/TaskDetail.svelte";

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
      <!--
        The dedicated TaskDetail window already shows the task name as its
        OS-level title and as the H1 below — repeating "Task Detail" as an
        eyebrow above it is redundant and adds vertical clutter. Keep only
        the task name. The inner panes likewise skip their card titles
        (see `hideDetailTitle` below).
      -->
      <h1>{taskName}</h1>
    </div>
    <Button
      content="閉じる"
      on:click={() => {
        window.close();
      }}
    />
  </div>

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
      <TaskDetail hideDetailTitle />
    {/if}
  </div>
</div>

<style>
  .detail-window {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: var(--sp4);
    box-sizing: border-box;
    gap: var(--sp4);
    background: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-main);
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--sp4);
  }

  .detail-meta h1 {
    margin: 0;
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
    gap: var(--sp2);
    color: var(--theme-color-Sub-main);
  }

  .empty-state h2,
  .empty-state p {
    margin: 0;
  }
</style>
