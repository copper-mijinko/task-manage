<script>
  import { getNode } from "@features/tasks/utils/tree_control";
  import { selected_id, tree_data } from "@stores";
  import Loading from "@lib/primitives/Loading.svelte";
  import TaskDetail from "@features/tasks/components/TaskDetail.svelte";

  export let initialTaskName = "Task Detail";
  export let initialTaskId = "";
  export let initialProjectId = "";
  export let ready = false;

  function getNodePathName(targetId, root) {
    const names = [];

    function visit(node) {
      names.push(node?.data?.name || "");
      if (node?.id === targetId) return true;

      for (const child of node?.children ?? []) {
        if (visit(child)) return true;
      }

      names.pop();
      return false;
    }

    return root && visit(root) ? names.filter(Boolean).join(" / ") : "";
  }

  $: node = initialTaskId && $tree_data ? getNode(initialTaskId, $tree_data.data) : undefined;
  $: taskPathName =
    initialTaskId && $tree_data ? getNodePathName(initialTaskId, $tree_data.data) : "";
  $: taskName = taskPathName || node?.data?.name || initialTaskName;
  $: if (ready && taskName && typeof document !== "undefined") {
    document.title = `${taskName} | Task Detail`;
  }
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
  <div class="detail-body">
    {#if !ready}
      <div class="empty-state">
        <Loading variant="h2" />
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
      <TaskDetail titleOverride={taskName} showOpenWindowAction={false} />
    {/if}
  </div>
</div>

<style>
  .detail-window {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: var(--sp2);
    box-sizing: border-box;
    background: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-main);
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
