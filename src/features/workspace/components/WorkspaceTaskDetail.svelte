<script>
  import { setContext, onMount, onDestroy, tick, untrack } from "svelte";
  import * as platform from "@lib/ipc/platform";
  import { createTreeGridApplication, TREEGRID_APPLICATION } from "../application/treegrid";
  import { workspaceApplication } from "../application/workspace";
  import { selected_id, selected_type, selectOnly, active_row_path } from "@stores/ui";
  import TaskDetailPage from "@pages/TaskDetailPage.svelte";

  /**
   * @typedef {Object} Props
   * @property {any} workspacePath
   * @property {any} taskId
   * @property {any} taskName
   * @property {any} projectId
   * @property {any} occurrencePath
   * @property {any} [performanceRunId] - 起動時間の計測用（`TASK_MANAGE_PERF`）。main プロセスが URL に載せてくる。
   */

  /** @type {Props} */
  let {
    workspacePath,
    taskId,
    taskName,
    projectId,
    occurrencePath,
    performanceRunId = undefined,
  } = $props();
  // 詳細ウィンドウは 1 つのワークスペースを開いたまま使うので、作成時のパスで作る。
  const application = createTreeGridApplication(untrack(() => workspacePath));
  setContext(TREEGRID_APPLICATION, application);
  const error = application.error;
  let ready = $state(false);
  onMount(async () => {
    try {
      const graph = await workspaceApplication.load(workspacePath);
      // A detail window keeps its node visible even after its displayed edge moves.
      application.scope.set(graph.rootId);
      $selected_id = projectId;
      $selected_type = "WorkspaceProject";
      selectOnly(taskId);
      $active_row_path = occurrencePath;
      ready = true;
    } catch (e) {
      error.set(e.message);
    } finally {
      reportMilestone("detail.taskDataLoaded");
    }
    await tick();
    try {
      performance.mark("detail-ready");
      performance.measure("renderer-to-detail-ready", "renderer-start", "detail-ready");
    } catch {
      // renderer-start is absent in component tests
    }
    requestAnimationFrame(() => reportMilestone("detail.interactive"));
  });
  function reportMilestone(name) {
    platform.reportPerformanceMilestone({
      name,
      durationMs: performance.now(),
      runId: performanceRunId,
    });
  }
  function history(event) {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.target.closest("input,textarea,[contenteditable=true],.cm-editor,.ql-editor")
    )
      return;
    if (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y") {
      event.preventDefault();
      void application.history(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo");
    }
  }
  onDestroy(application.dispose);
</script>

<svelte:window onkeydown={history} />
{#if $error}<p role="alert">{$error}</p>{/if}
<TaskDetailPage
  initialTaskName={taskName}
  initialTaskId={taskId}
  initialProjectId={projectId}
  {ready}
/>
