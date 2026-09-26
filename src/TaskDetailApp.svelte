<script>
  import { onDestroy, onMount } from "svelte";
  import { init_detail_store, saveStatus, theme } from "@stores";
  import * as platform from "@lib/ipc/platform";
  import { registerDateTimeShortcuts } from "@lib/utils/datetime_shortcuts";
  import WorkspaceTaskDetail from "@features/workspace/components/WorkspaceTaskDetail.svelte";

  // ノード詳細ウィンドウ。開く対象は main プロセスが URL に載せてくる。
  const search = new URLSearchParams(window.location.search);
  const workspacePath = search.get("workspacePath") || "";
  const projectId = search.get("projectId") || "";
  const taskId = search.get("taskId") || "";
  const taskName = search.get("taskName") || "Task Detail";
  const occurrencePath = search.get("occurrencePath") || "";
  const performanceRunId = search.get("performanceRunId") || undefined;

  let saveErrorMessage = null;
  let unregisterDateTimeShortcuts = null;

  init_detail_store();
  document.title = `${taskName} | Task Detail`;

  onMount(async () => {
    const currentTheme = await platform.getCurrentTheme().catch(() => undefined);
    if (currentTheme) theme.applyExternal(currentTheme);
    platform.onThemeChanged((nextTheme) => theme.applyExternal(nextTheme));
    platform.onSaveError((message) => {
      saveErrorMessage = message;
      saveStatus.set("error");
    });
    unregisterDateTimeShortcuts = registerDateTimeShortcuts();
  });

  onDestroy(() => {
    unregisterDateTimeShortcuts?.();
  });
</script>

<div class="detail-app">
  {#if saveErrorMessage}
    <div class="banner error" role="alert">
      <span>{saveErrorMessage}</span>
      <button type="button" on:click={() => (saveErrorMessage = null)}>×</button>
    </div>
  {/if}

  <main>
    <WorkspaceTaskDetail
      {workspacePath}
      {taskId}
      {taskName}
      {projectId}
      {occurrencePath}
      {performanceRunId}
    />
  </main>
</div>

<style>
  :global(html) {
    overflow: hidden;
  }
  :global(body) {
    margin: 0;
    overflow: hidden;
    font-family: "Roboto", "Helvetica", "Arial", sans-serif;
  }
  .detail-app {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--theme-color-Main-dark);
  }
  main {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .banner {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp2);
    padding: var(--sp1) var(--sp3);
    color: #fff;
    font-size: var(--font-body-sm);
    z-index: 10000;
  }
  .banner.error {
    background: var(--theme-color-Error-main);
  }
  .banner button {
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: var(--shape-xs);
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    cursor: pointer;
  }
</style>
