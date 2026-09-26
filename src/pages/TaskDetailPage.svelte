<script>
  import { getNode } from "@features/tasks/utils/tree_control";
  import { selected_id, active_row_path } from "@stores";
  import { getContext } from "svelte";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  const tree_data = getContext(TREEGRID_APPLICATION).tree;
  import Loading from "@lib/primitives/Loading.svelte";
  import TaskDetail from "@features/tasks/components/TaskDetail.svelte";

  /**
   * @typedef {Object} Props
   * @property {string} [initialTaskName]
   * @property {string} [initialTaskId]
   * @property {string} [initialProjectId]
   * @property {boolean} [ready]
   */

  /** @type {Props} */
  let {
    initialTaskName = "Task Detail",
    initialTaskId = "",
    initialProjectId = "",
    ready = false,
  } = $props();

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

  let node = $derived(
    initialTaskId && $tree_data ? getNode(initialTaskId, $tree_data.data) : undefined
  );
  /**
   * 開いた行の経路（`a/b/c`）に沿った名前。複数の親の下に出るノードは、
   * id だけで探すと最初に見つかった場所の経路になり、Home の行から開いた
   * のに見出しが「Work / …」になっていた。経路がもう辿れないとき（移動した
   * など）は空を返し、id で探す方に任せる。
   */
  function getOccurrencePathName(path, targetId, root) {
    const segments = (path || "").split("/");
    if (!root || segments.at(-1) !== targetId) return "";
    let current = segments[0] === root.id ? root : getNode(segments[0], root);
    const prefix = getNodePathName(segments[0], root);
    if (!current || !prefix) return "";
    const names = [prefix];
    for (const id of segments.slice(1)) {
      current = current.children?.find((child) => child.id === id);
      if (!current) return "";
      names.push(current.data?.name || "");
    }
    return names.filter(Boolean).join(" / ");
  }

  let taskPathName = $derived(
    initialTaskId && $tree_data
      ? getOccurrencePathName($active_row_path, initialTaskId, $tree_data.data) ||
          getNodePathName(initialTaskId, $tree_data.data)
      : ""
  );
  let taskName = $derived(taskPathName || node?.data?.name || initialTaskName);
  $effect.pre(() => {
    if (ready && taskName && typeof document !== "undefined") {
      document.title = `${taskName} | Task Detail`;
    }
  });
  let isProjectDeleted = $derived(ready && initialProjectId && $selected_id !== initialProjectId);
  let isTaskDeleted = $derived(
    ready &&
      !isProjectDeleted &&
      !!initialTaskId &&
      !!$selected_id &&
      $selected_id === initialProjectId &&
      !node
  );
</script>

<div class="detail-window">
  <div class="detail-body">
    {#if !ready}
      <div class="empty-state">
        <Loading variant="h2" />
      </div>
    {:else if isProjectDeleted}
      <div class="empty-state">
        <h2>プロジェクトが見つかりません。</h2>
        <p>The project for this detail window was deleted.</p>
      </div>
    {:else if isTaskDeleted}
      <div class="empty-state">
        <h2>ノードが見つかりません。</h2>
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
    padding: var(--detail-window-pad);
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
