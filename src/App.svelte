<script>
  import {
    selected_type,
    selected_id,
    table_selected_id,
    tree_data,
    setTaskDetailWindowTarget,
    init_store,
    autoSelectInitialProject,
    showPageSearch,
    theme,
    undoHistory,
    redoHistory,
    saveStatus,
    projectLoading,
    workspace_store,
    workspace_tasks_cache,
    navigation_history,
  } from "@stores";
  import { onMount, onDestroy } from "svelte";
  import * as platform from "@lib/ipc/platform";
  import { workspaceToProjectData } from "@features/workspace/utils/workspace_tree";
  import ProjectPage from "@pages/MainPage.svelte";
  import Header from "@features/navigation/components/Header.svelte";
  import MenuList from "@features/navigation/components/MenuList.svelte";
  import InboxPanel from "@features/inbox/components/InboxPanel.svelte";
  import QuickCapture from "@features/inbox/components/QuickCapture.svelte";
  import { showQuickCapture } from "@stores/ui";
  import Loading from "@lib/primitives/Loading.svelte";
  import PageSearchBox from "@features/search/components/PageSearchBox.svelte";
  import TaskDetailWindow from "@pages/TaskDetailPage.svelte";
  import { sidebarCollapsed } from "@stores";
  import { startAutoRescan, stopAutoRescan } from "@features/search/utils/page_search_highlighter";
  import { registerDateTimeShortcuts } from "@lib/utils/datetime_shortcuts";
  let saveErrorMessage = null;
  let workspaceConflict = null;
  let workspaceNoticeMessage = null;
  let flushingOnShutdown = false;
  let unregisterDateTimeShortcuts = null;

  const currentHash = typeof window !== "undefined" ? window.location.hash : "";
  const currentSearch =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

  ////////////// Initial Settings //////////////
  init_store();

  // ページ内検索ショートカットキー設定
  let searchBox;
  let isTaskDetailWindow = currentHash === "#task-detail-window";
  let detailWindowReady = false;
  let detailWindowProjectId = currentSearch.get("projectId") || "";
  let detailWindowTaskId = currentSearch.get("taskId") || "";
  let detailWindowTaskName = currentSearch.get("taskName") || "Task Detail";
  let detailWindowSelectedType =
    currentSearch.get("selectedType") === "WorkspaceProject" ? "WorkspaceProject" : "Projects";
  let detailWindowProjectDir = currentSearch.get("projectDir") || "";

  async function initTaskDetailWindow() {
    try {
      if (!detailWindowProjectId || !detailWindowTaskId) return;

      document.title = `${detailWindowTaskName} | Task Detail`;
      setTaskDetailWindowTarget(detailWindowProjectId, detailWindowTaskId, {
        selectedType: detailWindowSelectedType,
        projectDir: detailWindowProjectDir || null,
      });

      if (detailWindowSelectedType === "WorkspaceProject") {
        if (!detailWindowProjectDir) return;

        workspace_store.update((state) => ({
          ...state,
          activeProjectDir: detailWindowProjectDir,
          projects: state.projects.some((project) => project.projectDir === detailWindowProjectDir)
            ? state.projects
            : [
                ...state.projects,
                {
                  name: detailWindowTaskName,
                  rootId: detailWindowProjectId,
                  dirName: detailWindowProjectDir.split(/[/\\]/).pop() || detailWindowTaskName,
                  projectDir: detailWindowProjectDir,
                },
              ],
        }));

        const workspaceProject = await platform.wsReadProject(detailWindowProjectDir);
        if (workspaceProject) {
          workspace_tasks_cache.set(workspaceProject.tasks);
          tree_data.setFromSource(
            workspaceToProjectData(workspaceProject.tasks, detailWindowProjectId)
          );
          selected_type.set("WorkspaceProject");
          selected_id.set(detailWindowProjectId);
          table_selected_id.set(detailWindowTaskId);
        }
        return;
      }

      const result = await platform.getTreeData(detailWindowProjectId);
      if (result) {
        tree_data.setFromSource(result);
        selected_type.set("Projects");
        selected_id.set(detailWindowProjectId);
        table_selected_id.set(detailWindowTaskId);
      }
    } catch {
      // ignore initialization error
    } finally {
      detailWindowReady = true;
    }
  }

  // 検索ウィンドウでのテーマ初期化処理
  async function initSearchWindowTheme() {
    try {
      const currentTheme = await platform.getCurrentTheme();
      if (currentTheme) {
        theme.set(currentTheme);
      }
    } catch {
      // ignore theme initialization error
    }
  }

  // capture-phase で window keydown を捕まえているため、CodeMirror や Quill、
  // ネイティブの input / textarea / contenteditable にフォーカスがある状態で
  // Ctrl+Z / Ctrl+Y を叩くと、エディタの undo/redo より先にタスクツリー側の
  // 履歴が動いてしまう。フォーカスがそれらの編集面の中にある間はグローバルの
  // undo/redo をスキップし、エディタ自身のキーマップに処理を委ねる。
  function isInsideEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(".cm-editor")) return true;
    if (target.closest(".ql-editor")) return true;
    if (target.closest('[contenteditable=""], [contenteditable="true"]')) return true;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return false;
  }

  function handleKeyDown(event) {
    // Ctrl+F is handled by Header.svelte (focuses the inline search input)

    // Ctrl+Shift+I opens the Inbox Quick Capture overlay from anywhere.
    // We accept this even when an editable element has focus so the user
    // can capture an idea mid-edit without losing it. The browser's
    // devtools shortcut is normally Ctrl+Shift+I too, but Electron's
    // packaged windows do not expose it to the renderer in production —
    // and our dev builds open devtools via F12 anyway, so no conflict.
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      (event.key === "I" || event.key === "i")
    ) {
      if (workspace_store && !$workspace_store.activeWorkspacePath) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      $showQuickCapture = true;
      return;
    }

    if (isInsideEditableTarget(event.target)) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === "z") {
      event.preventDefault();
      event.stopPropagation();
      undoHistory();
      return;
    }

    if (
      ((event.ctrlKey || event.metaKey) && event.key === "y") ||
      ((event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        (event.key === "z" || event.key === "Z"))
    ) {
      event.preventDefault();
      event.stopPropagation();
      redoHistory();
      return;
    }

    // Browser-style "back / forward" through the visited-page history.
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigation_history.back();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        navigation_history.forward();
        return;
      }
    }
  }

  // Mouse XButtons (back / forward thumb buttons on most mice).
  // Browsers fire `mouseup` with `button === 3` (back) / `4` (forward).
  // Some browsers also dispatch a native browser-back via `auxclick`, but
  // since this is an Electron renderer with no navigation, we own the gesture.
  function handleMouseUp(event) {
    if (isTaskDetailWindow) return;
    if (event.button === 3) {
      event.preventDefault();
      navigation_history.back();
    } else if (event.button === 4) {
      event.preventDefault();
      navigation_history.forward();
    }
  }

  async function resolveWorkspaceConflict(action) {
    if (!workspaceConflict?.projectDir) return;
    const result = await platform.wsResolveConflict(workspaceConflict.projectDir, action);
    if (result?.success) {
      workspaceConflict = null;
      if (action === "keep-local") {
        saveStatus.set("queued");
      }
    } else {
      saveErrorMessage = result?.error ?? "Failed to resolve workspace conflict";
      saveStatus.set("error");
    }
  }

  onMount(async () => {
    try {
      performance.mark("app-mounted");
      performance.measure("renderer-to-mount", "renderer-start", "app-mounted");
    } catch {
      // renderer-start not set (e.g. test environment)
    }

    if (isTaskDetailWindow) {
      await initTaskDetailWindow();
    } else {
      detailWindowReady = true;
      // 起動時の自動選択: Workspace を優先、なければ InApp の先頭プロジェクト。
      // 既に何か選択されている (例: タスク詳細ウィンドウ) 場合は no-op。
      autoSelectInitialProject();
    }

    // テーマ初期化
    await initSearchWindowTheme();

    // テーマ変更通知のリスナー登録
    platform.onThemeChanged((newTheme) => {
      theme.set(newTheme);
    });

    window.addEventListener("keydown", handleKeyDown, true);
    if (!isTaskDetailWindow) {
      window.addEventListener("mouseup", handleMouseUp);
    }

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
        return;
      }
      // "workspace-updated" はヘッダーの保存状態表示と意味が被るので非表示
      // ("conflicted-copy" 等のユーザ操作が必要な通知のみバナー表示)
      if (event.kind === "workspace-updated") {
        return;
      }
      workspaceNoticeMessage = event.message;
      setTimeout(() => {
        if (workspaceNoticeMessage === event.message) {
          workspaceNoticeMessage = null;
        }
      }, 4000);
    });

    platform.onWorkspaceFlushStart(() => {
      flushingOnShutdown = true;
    });

    platform.onWorkspaceFlushComplete(() => {
      // The main process destroys the window shortly after this fires; the
      // overlay being removed here is a no-op in the normal path. Resetting
      // it covers the (rare) case where force-quit was chosen and the
      // window survived for any reason.
      flushingOnShutdown = false;
    });

    // Start the document-wide page-search highlighter. It watches the whole
    // document for changes and re-applies CSS Custom Highlight ranges.
    startAutoRescan();

    unregisterDateTimeShortcuts = registerDateTimeShortcuts();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("mouseup", handleMouseUp);
    stopAutoRescan();
    unregisterDateTimeShortcuts?.();
  });
</script>

<div class:Container={true}>
  {#if saveErrorMessage}
    <div class="save-error-banner" role="alert">
      <span>{saveErrorMessage}</span>
      <button
        on:click={() => {
          saveErrorMessage = null;
          $saveStatus = "idle";
        }}>×</button
      >
    </div>
  {/if}
  {#if workspaceConflict}
    <div class="workspace-conflict-banner" role="alert">
      <span>{workspaceConflict.message}</span>
      <div class="workspace-conflict-actions">
        <button type="button" on:click={() => resolveWorkspaceConflict("keep-local")}>
          維持
        </button>
        <button type="button" on:click={() => resolveWorkspaceConflict("reload")}> 再読込 </button>
      </div>
    </div>
  {:else if workspaceNoticeMessage}
    <div class="workspace-notice-banner" role="status">
      <span>{workspaceNoticeMessage}</span>
      <button type="button" on:click={() => (workspaceNoticeMessage = null)}>×</button>
    </div>
  {/if}
  {#if !isTaskDetailWindow}
    <div class="Header">
      <Header />
    </div>
  {/if}
  <div class="Body" class:DetailWindowBody={isTaskDetailWindow}>
    {#if !isTaskDetailWindow}
      <aside class="Sidebar" class:Collapsed={$sidebarCollapsed} aria-label="ナビゲーション">
        <MenuList />
      </aside>
    {/if}
    <div class="Main" class:DetailWindowMain={isTaskDetailWindow}>
      {#if isTaskDetailWindow}
        <TaskDetailWindow
          initialTaskName={detailWindowTaskName}
          initialTaskId={detailWindowTaskId}
          initialProjectId={detailWindowProjectId}
          ready={detailWindowReady}
        />
      {:else}
        {#if !($selected_type && $selected_id)}
          <h1 style="color:var(--theme-color-Sub-main); display:flex; justify-content:center">
            No data.
          </h1>
        {/if}
        {#if ($selected_type == "Projects" || $selected_type == "WorkspaceProject") && $projectLoading}
          <Loading variant="h1" />
        {:else if $selected_type == "Projects" || $selected_type == "WorkspaceProject"}
          <ProjectPage />
        {:else if $selected_type == "Inbox"}
          <InboxPanel />
        {/if}
      {/if}
      {#if !isTaskDetailWindow && !$sidebarCollapsed}
        <!-- Drawer 風マスク: サイドバー表示中はメイン領域への操作を遮断し、
             クリックでサイドバーを閉じる。これがないと SplitPane のリサイザを
             掴んだ瞬間にサイドバーが閉じて Main 幅が変わり、リサイザの初期計算
             がずれてしまう。 -->
        <button
          type="button"
          class="SidebarMask"
          aria-label="サイドバーを閉じる"
          on:click={() => ($sidebarCollapsed = true)}
        ></button>
      {/if}
    </div>
  </div>
</div>

<!-- 検索ボックスを直接body直下に配置（他の要素と独立して） -->
<PageSearchBox
  bind:this={searchBox}
  show={$showPageSearch}
  on:close={() => {
    $showPageSearch = false;
  }}
/>

<QuickCapture
  show={$showQuickCapture}
  on:close={() => {
    $showQuickCapture = false;
  }}
/>

{#if flushingOnShutdown}
  <div
    class="flush-overlay"
    role="alertdialog"
    aria-modal="true"
    aria-live="assertive"
    aria-label="保存中"
  >
    <div class="flush-overlay-card">
      <div class="flush-spinner" aria-hidden="true"></div>
      <div class="flush-overlay-text">
        <strong>保存中…</strong>
        <span
          >ワークスペースを安全に書き出しています。このウィンドウは保存完了後に自動で閉じます。</span
        >
      </div>
    </div>
  </div>
{/if}

<style>
  :global(html) {
    font-size: 75%;
    overflow: hidden;
  }
  :global(body) {
    font-family: "Roboto", "Helvetica", "Arial", sans-serif;
    padding: 0;
    margin: 0;
    overflow: hidden;
  }
  div.Container {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100vh;
    width: 100vw;
    max-width: 100vw;
    max-height: 100vh;
    background-color: var(--theme-color-Main-dark);
    margin: 0;
    padding: 0;
    overflow: hidden;
    position: relative;
  }
  div.Header {
    height: 3.5rem;
  }
  div.Body {
    display: flex;
    flex-direction: row;
    flex: 1;
    min-height: 0;
    width: 100%;
    height: calc(100% - 3.5rem);
    overflow: hidden;
  }
  div.Body.DetailWindowBody {
    height: 100%;
  }
  aside.Sidebar {
    flex: 0 0 18rem;
    width: 18rem;
    min-width: 18rem;
    height: 100%;
    background-color: var(--theme-color-Theme-main);
    box-shadow: var(--elevation-1);
    transition:
      flex-basis 0.18s ease,
      width 0.18s ease,
      min-width 0.18s ease;
    overflow: hidden;
    box-sizing: border-box;
  }
  aside.Sidebar.Collapsed {
    flex: 0 0 0;
    width: 0;
    min-width: 0;
    box-shadow: none;
  }
  div.Main {
    display: flex;
    justify-content: center;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    position: relative;
  }
  div.Main.DetailWindowMain {
    height: 100%;
    flex: 1;
  }
  /* SplitPanes 内の Resizer は z-index: 999。マスクはそれより上に置く。 */
  .SidebarMask {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background-color: rgba(0, 0, 0, 0.35);
    cursor: pointer;
    z-index: 1000;
  }
  .SidebarMask:focus {
    outline: none;
  }
  .save-error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp1) var(--sp3);
    background-color: var(--theme-color-Error-main);
    color: #fff;
    font-size: var(--font-body-sm);
    flex-shrink: 0;
    z-index: 10000;
  }
  .save-error-banner button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: var(--font-body-md);
    line-height: 1;
    padding: 0 var(--sp1);
  }
  .workspace-conflict-banner,
  .workspace-notice-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp2);
    padding: var(--sp1) var(--sp3);
    color: #fff;
    font-size: var(--font-body-sm);
    flex-shrink: 0;
    z-index: 10000;
  }
  .workspace-conflict-banner {
    background-color: var(--theme-color-Warning-main);
  }
  .workspace-notice-banner {
    background-color: var(--theme-color-Info-main, var(--theme-color-Theme-main));
  }
  .workspace-conflict-actions {
    display: flex;
    gap: var(--sp1);
  }
  .workspace-conflict-banner button,
  .workspace-notice-banner button {
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: var(--shape-xs);
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    cursor: pointer;
    font-size: var(--font-body-sm);
    padding: 0 var(--sp2);
  }
  .flush-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
    pointer-events: all;
  }
  .flush-overlay-card {
    display: flex;
    align-items: center;
    gap: var(--sp3);
    padding: var(--sp4) var(--sp4);
    border-radius: var(--shape-sm);
    background: var(--theme-color-Theme-main);
    color: #fff;
    box-shadow: var(--elevation-2);
    max-width: 32rem;
    min-width: 22rem;
  }
  .flush-overlay-text {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
    font-size: var(--font-body-sm);
  }
  .flush-overlay-text strong {
    font-size: var(--font-body-md);
  }
  .flush-spinner {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    animation: flush-spin 0.9s linear infinite;
    flex-shrink: 0;
  }
  @keyframes flush-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
