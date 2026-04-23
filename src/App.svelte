<script>
  import {
    selected_type,
    selected_id,
    table_selected_id,
    tree_data,
    setTaskDetailWindowTarget,
    init_store,
    showPageSearch,
    theme,
    undoHistory,
    redoHistory,
    saveStatus,
  } from "./stores.ts";
  import { onMount, onDestroy } from "svelte";
  import ProjectPage from "./components/ProjectPage.svelte";
  import Header from "./components/Header.svelte";
  import InfoPage from "./components/InfoPage.svelte";
  import Modal from "./components/Modal.svelte";
  import Button from "./components/Button.svelte";
  import PageSearchBox from "./components/PageSearchBox.svelte";
  import TaskDetailWindow from "./components/TaskDetailWindow.svelte";
  let show = Array(4).fill(false);
  let saveErrorMessage = null;

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

  async function initTaskDetailWindow() {
    try {
      const detailData = await window.electronAPI?.getTaskDetailWindowData?.();
      if (!detailData?.projectId || !detailData?.taskId) {
        return;
      }

      detailWindowProjectId = detailData.projectId;
      detailWindowTaskId = detailData.taskId;
      detailWindowTaskName = detailData.taskName || detailWindowTaskName;
      document.title = `${detailWindowTaskName} | Task Detail`;

      setTaskDetailWindowTarget(detailData.projectId, detailData.taskId);

      const result = await window.electronAPI.getTreeData(detailData.projectId);
      if (result) {
        tree_data.set(result);
        selected_type.set("Projects");
        selected_id.set(detailData.projectId);
        table_selected_id.set(detailData.taskId);
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
      if (window.electronAPI && window.electronAPI.getCurrentTheme) {
        // メインウィンドウから現在のテーマを取得
        const currentTheme = await window.electronAPI.getCurrentTheme();
        if (currentTheme) {
          // テーマを設定
          theme.set(currentTheme);
        }
      }
    } catch {
      // ignore theme initialization error
    }
  }

  function handleKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "f") {
      event.preventDefault();
      $showPageSearch = true;
      searchBox?.focusInput();
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
  }

  onMount(async () => {
    if (isTaskDetailWindow) {
      await initTaskDetailWindow();
    } else {
      detailWindowReady = true;
    }

    // テーマ初期化
    await initSearchWindowTheme();

    // テーマ変更通知のリスナー登録
    if (window.electronAPI && window.electronAPI.onThemeChanged) {
      window.electronAPI.onThemeChanged((newTheme) => {
        theme.set(newTheme);
      });
    }

    window.addEventListener("keydown", handleKeyDown, true);

    if (window.electronAPI?.onSaveError) {
      window.electronAPI.onSaveError((message) => {
        saveErrorMessage = message;
        saveStatus.set("error");
      });
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown, true);
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
  {#if !saveErrorMessage && $saveStatus !== "idle"}
    <div
      class="save-status-indicator"
      data-testid="save-status-indicator"
      data-status={$saveStatus}
    >
      {#if $saveStatus === "saving"}
        保存中...
      {:else if $saveStatus === "saved"}
        保存済み
      {:else if $saveStatus === "error"}
        保存失敗
      {/if}
    </div>
  {/if}
  {#if !isTaskDetailWindow}
    <div class="Header">
      <Header />
    </div>
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
      {#if $selected_type == "Projects"}
        <ProjectPage />
      {/if}
      {#if $selected_type == "Info"}
        <div
          style="height:100%; display: flex; flex-direction: column; justify-content: center; align-items: center;"
        >
          {#each [1, 2, 3, 4] as i}
            <Button
              content="Setp{i}"
              on:click={() => {
                show[i - 1] = !show[i - 1];
              }}
            />
            <Modal
              show={show[i - 1]}
              toggle={() => {
                show[i - 1] = !show[i - 1];
              }}
            >
              <InfoPage index={i} />
            </Modal>
          {/each}
        </div>
      {/if}
    {/if}
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

<style>
  :global(html) {
    font-size: 75%;
  }
  :global(body) {
    font-family: "Roboto", "Helvetica", "Arial", sans-serif;
    padding: 0;
    margin: 0;
  }
  div.Container {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    width: 100%;
    background-color: var(--theme-color-Main-dark);
    margin: 0;
    padding: 0;
    overflow: auto;
    position: relative; /* 子要素のためのコンテキスト設定 */
  }
  div.Header {
    height: 3.5rem;
  }
  div.Main {
    display: flex;
    justify-content: center;
    align-items: center;
    height: calc(100% - 3.5rem);
    width: 100%;
    flex: 1;
  }
  div.Main.DetailWindowMain {
    height: 100%;
  }
  .save-error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.75rem;
    background-color: #c0392b;
    color: #fff;
    font-size: 0.875rem;
    flex-shrink: 0;
    z-index: 10000;
  }
  .save-error-banner button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.25rem;
  }
  .save-status-indicator {
    position: fixed;
    bottom: 0.75rem;
    right: 0.75rem;
    padding: 0.2rem 0.6rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    opacity: 0.85;
    pointer-events: none;
    z-index: 9999;
    background-color: rgba(0, 0, 0, 0.55);
    color: #fff;
  }
  .save-status-indicator[data-status="error"] {
    background-color: #c0392b;
  }
</style>
