<script>
  import { onDestroy, onMount, tick } from "svelte";
  import {
    init_detail_store,
    saveStatus,
    selected_id,
    selected_type,
    setTaskDetailWindowTarget,
    table_selected_id,
    theme,
    tree_data,
    undoHistory,
    redoHistory,
    workspace_store,
    workspace_tasks_cache,
  } from "@stores";
  import * as platform from "@lib/ipc/platform";
  import { workspaceToProjectData } from "@features/workspace/utils/workspace_tree";
  import { registerDateTimeShortcuts } from "@lib/utils/datetime_shortcuts";
  import TaskDetailPage from "@pages/TaskDetailPage.svelte";

  const search = new URLSearchParams(window.location.search);
  let projectId = search.get("projectId") || "";
  const taskId = search.get("taskId") || "";
  const taskName = search.get("taskName") || "Task Detail";
  const selectedType =
    search.get("selectedType") === "WorkspaceProject" ? "WorkspaceProject" : "Projects";
  const projectDir = search.get("projectDir") || "";
  const performanceRunId = search.get("performanceRunId") || undefined;

  let ready = false;
  let saveErrorMessage = null;
  let workspaceConflict = null;
  let workspaceNoticeMessage = null;
  let flushingOnShutdown = false;
  let unregisterDateTimeShortcuts = null;

  init_detail_store();

  async function initialiseDetail() {
    try {
      if (!projectId || !taskId) return;

      document.title = `${taskName} | Task Detail`;
      setTaskDetailWindowTarget(projectId, taskId, {
        selectedType,
        projectDir: projectDir || null,
      });

      if (selectedType === "WorkspaceProject") {
        if (!projectDir) return;

        workspace_store.update((state) => ({
          ...state,
          activeProjectDir: projectDir,
          projects: state.projects.some((project) => project.projectDir === projectDir)
            ? state.projects
            : [
                ...state.projects,
                {
                  name: taskName,
                  rootId: projectId,
                  dirName: projectDir.split(/[/\\]/).pop() || taskName,
                  projectDir,
                },
              ],
        }));

        // The main renderer primes this cache whenever a project is loaded or
        // edited. Falling back to disk only when it is absent avoids a complete
        // OneDrive directory scan for every detail window.
        const workspaceProject = await platform.wsReadProject(projectDir, {
          preferCache: true,
        });
        if (!workspaceProject) return;

        const rootTask = Object.values(workspaceProject.tasks ?? {}).find(
          (task) => task.parents.length === 0
        );
        projectId = rootTask?.id || projectId;
        setTaskDetailWindowTarget(projectId, taskId, {
          selectedType: "WorkspaceProject",
          projectDir,
        });
        workspace_store.syncProjectListItem(projectDir, {
          rootId: projectId,
          name: rootTask?.name || taskName,
          order: rootTask?.order,
        });
        workspace_tasks_cache.set(workspaceProject.tasks);
        tree_data.setFromSource(workspaceToProjectData(workspaceProject.tasks, projectId));
        selected_type.set("WorkspaceProject");
        selected_id.set(projectId);
        table_selected_id.set(taskId);
        return;
      }

      const result = await platform.getTreeData(projectId);
      if (result) {
        tree_data.setFromSource(result);
        selected_type.set("Projects");
        selected_id.set(projectId);
        table_selected_id.set(taskId);
      }
    } catch (error) {
      saveErrorMessage = error instanceof Error ? error.message : "Failed to load task detail";
    } finally {
      ready = true;
      platform.reportPerformanceMilestone({
        name: "detail.taskDataLoaded",
        durationMs: performance.now(),
        runId: performanceRunId,
      });
    }
  }

  async function reportInteractiveAfterPaint() {
    try {
      await tick();
      const report = () =>
        platform.reportPerformanceMilestone({
          name: "detail.interactive",
          durationMs: performance.now(),
          runId: performanceRunId,
        });
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(report);
      } else {
        report();
      }
    } catch {
      // Performance reporting must never affect detail-window startup.
    }
  }

  function isInsideEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(".cm-editor, .ql-editor")) return true;
    if (target.closest('[contenteditable=""], [contenteditable="true"]')) return true;
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
  }

  function handleKeyDown(event) {
    if (isInsideEditableTarget(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === "z") {
      event.preventDefault();
      undoHistory();
      return;
    }
    if (
      ((event.ctrlKey || event.metaKey) && event.key === "y") ||
      ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z")
    ) {
      event.preventDefault();
      redoHistory();
    }
  }

  async function resolveWorkspaceConflict(action) {
    if (!workspaceConflict?.projectDir) return;
    const result = await platform.wsResolveConflict(workspaceConflict.projectDir, action);
    if (result?.success) {
      workspaceConflict = null;
      if (action === "keep-local") saveStatus.set("queued");
    } else {
      saveErrorMessage = result?.error ?? "Failed to resolve workspace conflict";
      saveStatus.set("error");
    }
  }

  onMount(async () => {
    await initialiseDetail();
    void reportInteractiveAfterPaint();
    const currentTheme = await platform.getCurrentTheme().catch(() => undefined);
    if (currentTheme) theme.set(currentTheme);

    platform.onThemeChanged((nextTheme) => theme.set(nextTheme));
    platform.onProjectDeleted((deletedProjectId) => {
      if (selectedType === "Projects" && deletedProjectId === projectId) {
        selected_id.set(undefined);
        table_selected_id.set(undefined);
      }
    });
    platform.onWorkspaceProjectDeleted((event) => {
      if (selectedType === "WorkspaceProject" && event.projectDir === projectDir) {
        selected_id.set(undefined);
        table_selected_id.set(undefined);
      }
    });
    platform.onSaveError((message) => {
      saveErrorMessage = message;
      saveStatus.set("error");
    });
    platform.onWorkspaceConflict((event) => {
      workspaceConflict = event;
      saveStatus.set("conflict");
    });
    platform.onWorkspaceNotice((event) => {
      if (event.kind === "error") {
        saveErrorMessage = event.message;
        saveStatus.set("error");
      } else if (event.kind !== "workspace-updated") {
        workspaceNoticeMessage = event.message;
        setTimeout(() => {
          if (workspaceNoticeMessage === event.message) workspaceNoticeMessage = null;
        }, 4000);
      }
    });
    platform.onWorkspaceFlushStart(() => (flushingOnShutdown = true));
    platform.onWorkspaceFlushComplete(() => (flushingOnShutdown = false));

    unregisterDateTimeShortcuts = registerDateTimeShortcuts();
    window.addEventListener("keydown", handleKeyDown, true);

    try {
      performance.mark("detail-ready");
      performance.measure("renderer-to-detail-ready", "renderer-start", "detail-ready");
    } catch {
      // renderer-start is absent in component tests
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown, true);
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
  {#if workspaceConflict}
    <div class="banner conflict" role="alert">
      <span>{workspaceConflict.message}</span>
      <div class="actions">
        <button type="button" on:click={() => resolveWorkspaceConflict("keep-local")}>維持</button>
        <button type="button" on:click={() => resolveWorkspaceConflict("reload")}>再読込</button>
      </div>
    </div>
  {:else if workspaceNoticeMessage}
    <div class="banner notice" role="status">
      <span>{workspaceNoticeMessage}</span>
      <button type="button" on:click={() => (workspaceNoticeMessage = null)}>×</button>
    </div>
  {/if}

  <main>
    <TaskDetailPage
      initialTaskName={taskName}
      initialTaskId={taskId}
      initialProjectId={projectId}
      {ready}
    />
  </main>
</div>

{#if flushingOnShutdown}
  <div class="flush-overlay" role="alertdialog" aria-modal="true" aria-label="保存中">
    <div class="flush-card">
      <div class="spinner" aria-hidden="true"></div>
      <div><strong>保存中…</strong><br />保存完了後に自動で閉じます。</div>
    </div>
  </div>
{/if}

<style>
  :global(html) {
    font-size: 75%;
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
  .banner.conflict {
    background: var(--theme-color-Warning-main);
  }
  .banner.notice {
    background: var(--theme-color-Info-main, var(--theme-color-Theme-main));
  }
  .banner button {
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: var(--shape-xs);
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    cursor: pointer;
  }
  .actions {
    display: flex;
    gap: var(--sp1);
  }
  .flush-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    z-index: 2147483647;
  }
  .flush-card {
    display: flex;
    align-items: center;
    gap: var(--sp3);
    min-width: 22rem;
    padding: var(--sp4);
    border-radius: var(--shape-sm);
    background: var(--theme-color-Theme-main);
    color: #fff;
    box-shadow: var(--elevation-2);
  }
  .spinner {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border: 3px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
