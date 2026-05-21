<script>
  import { getNode, updateNodeDataById } from "@features/tasks/utils/tree_control";
  import { uuidV4 } from "@lib/utils/uuid";
  import {
    tree_data,
    table_selected_id,
    cancelPendingOperations,
    selected_type,
    selected_id,
    workspace_store,
    tag_index,
    theme,
  } from "@stores";
  import { selected_ids } from "@stores/ui";
  import { debounce } from "lodash";
  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import MemoTab from "@features/memos/components/MemoTab.svelte";
  import Card from "@lib/primitives/Card.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
  import DateInput from "@lib/primitives/DateInput.svelte";
  import * as platform from "@lib/ipc/platform";
  import {
    convertMemoContent,
    isQuillDelta,
    normalizeMemoFormat,
  } from "@features/memos/utils/memo_utils";

  /**
   * When TaskDetail is rendered inside its own dedicated window (TaskDetailPage),
   * the card title is redundant with the OS-level title bar. Callers pass
   * `hideDetailTitle` to suppress the local card header in that context.
   */
  export let hideDetailTitle = false;

  $: extraSelectedCount = Math.max(0, $selected_ids.size - 1);
  $: is_selected = $table_selected_id ? true : false;
  $: node =
    $table_selected_id && $tree_data ? getNode($table_selected_id, $tree_data.data) : undefined;
  $: name = node ? node.data["name"] : "Select Task";
  $: memo = node ? node.data["memo"] : [];
  $: isWorkspaceProject = $selected_type === "WorkspaceProject";
  $: workspaceProjectDir = isWorkspaceProject ? $workspace_store.activeProjectDir : null;
  $: defaultMemoFormat = isWorkspaceProject ? "markdown" : "quill";
  $: isDark = $theme === "dark";

  const detailDateStyle =
    "border: 0; padding: 0 var(--sp7) 0 var(--sp2); font-size: 1rem; background-color: transparent;";
  const RESIZER_SIZE = 5;
  const MINI_PANE_SIZE = 0;
  const SNAP_THRESHOLD = 80;
  const DETAIL_MIN_HEIGHT = 96;
  const MEMO_MIN_HEIGHT = 160;
  const SNAP_TRANSITION_MS = 180;

  let splitBody;
  let detailPane;
  let memoPane;
  let detailPanePercent = 40;
  let detailPaneSize = "40%";
  let splitState = "open";
  let splitSnapping = false;
  let previousTaskDetailId = "";
  let snapTimer;
  let resizeStartY = 0;
  let startDetailSize = 0;
  let startMemoSize = 0;
  let lastDesiredDetailSize = 0;
  let lastDesiredMemoSize = 0;

  const getEditContext = () => ({
    selectedType: $selected_type,
    selectedId: $selected_id,
    tableSelectedId: $table_selected_id,
    activeProjectDir: $workspace_store.activeProjectDir,
  });

  const contextMatches = (context) =>
    context &&
    context.selectedType === $selected_type &&
    context.selectedId === $selected_id &&
    context.tableSelectedId === $table_selected_id &&
    context.activeProjectDir === $workspace_store.activeProjectDir;

  const changeData = (node, key, value, editContext = getEditContext()) => {
    if (!contextMatches(editContext)) {
      return;
    }
    if (!node) {
      return;
    }
    const liveTreeData = get(tree_data);
    if (!liveTreeData?.data) {
      return;
    }
    const data = updateNodeDataById(liveTreeData.data, node.id, { [key]: value });
    if (data !== liveTreeData.data) {
      tree_data.set({ ...liveTreeData, data });
    }
  };
  const changeDataDebounce = debounce(changeData, 500);
  let previousEditContextKey = "";

  const getLiveNode = (editContext = getEditContext()) => {
    const liveTreeData = get(tree_data);
    if (!contextMatches(editContext) || !liveTreeData?.data || !editContext.tableSelectedId) {
      return undefined;
    }
    return getNode(editContext.tableSelectedId, liveTreeData.data);
  };

  const changeMemoAtIndex = (selectedMemoIndex, updater, editContext = getEditContext()) => {
    const liveNode = getLiveNode(editContext);
    if (!liveNode) return false;

    const updatedMemo = [...(liveNode.data["memo"] ?? [])];
    const currentMemo = updatedMemo[selectedMemoIndex];
    if (!currentMemo) return false;

    const nextMemo = updater(currentMemo);
    if (!nextMemo) return false;

    updatedMemo[selectedMemoIndex] = nextMemo;
    changeData(liveNode, "memo", updatedMemo, editContext);
    return true;
  };

  $: editContextKey = [
    $selected_type ?? "",
    $selected_id ?? "",
    $table_selected_id ?? "",
    $workspace_store.activeProjectDir ?? "",
  ].join(":");

  $: if (editContextKey !== previousEditContextKey) {
    changeDataDebounce.cancel();
    previousEditContextKey = editContextKey;
  }

  $: currentTaskDetailId = node?.id ?? "";
  $: if (currentTaskDetailId !== previousTaskDetailId) {
    previousTaskDetailId = currentTaskDetailId;
    resetCardSplit();
  }

  const unsubscribeCancelPending = cancelPendingOperations.subscribe(() => {
    changeDataDebounce.cancel();
  });

  onDestroy(() => {
    stopCardResize();
    clearTimeout(snapTimer);
    changeDataDebounce.cancel();
    unsubscribeCancelPending();
  });
  $: allTags = [...$tag_index.keys()].sort();

  const addMemo = (newMemoTitle) => {
    if (newMemoTitle) {
      const editContext = getEditContext();
      const liveNode = getLiveNode(editContext);
      if (!liveNode) return false;
      let newMemo = {
        id: uuidV4(),
        title: newMemoTitle,
        content: "",
        tags: [],
        format: defaultMemoFormat,
      };
      changeData(liveNode, "memo", [...(liveNode.data.memo ?? []), newMemo], editContext);
      return true;
    }
  };
  const deleteMemo = (index) => {
    const editContext = getEditContext();
    const liveNode = getLiveNode(editContext);
    if (!liveNode) return false;
    changeData(
      liveNode,
      "memo",
      (liveNode.data.memo ?? []).filter((_, i) => i !== index),
      editContext
    );
    return true;
  };
  const saveMemo = (editedContent, selectedMemoIndex) => {
    const editContext = getEditContext();
    return changeMemoAtIndex(
      selectedMemoIndex,
      (currentMemo) => {
        const targetFormat = normalizeMemoFormat(currentMemo.format, defaultMemoFormat);
        const sourceFormat = isQuillDelta(editedContent) ? "quill" : "markdown";
        return {
          ...currentMemo,
          content: convertMemoContent(editedContent, sourceFormat, targetFormat),
        };
      },
      editContext
    );
  };
  const renameMemo = (newMemoTitle, selectedMemoIndex) => {
    if (newMemoTitle) {
      const editContext = getEditContext();
      memo = [...node.data["memo"]];
      memo[selectedMemoIndex].title = newMemoTitle;
      changeDataDebounce(node, "memo", memo, editContext);
      return true;
    }
  };
  const reorderMemo = (fromIndex, toIndex) => {
    const editContext = getEditContext();
    const liveNode = getLiveNode(editContext);
    if (!liveNode) return false;
    const updatedMemo = [...(liveNode.data["memo"] ?? [])];
    if (fromIndex < 0 || fromIndex >= updatedMemo.length) return false;
    if (toIndex < 0 || toIndex >= updatedMemo.length) return false;
    const [moved] = updatedMemo.splice(fromIndex, 1);
    updatedMemo.splice(toIndex, 0, moved);
    changeData(liveNode, "memo", updatedMemo, editContext);
    return true;
  };
  const saveMemoTags = (selectedMemoIndex, tags) => {
    const editContext = getEditContext();
    return changeMemoAtIndex(
      selectedMemoIndex,
      (currentMemo) => ({ ...currentMemo, tags }),
      editContext
    );
  };
  const changeMemoFormat = (selectedMemoIndex, nextFormat) => {
    const editContext = getEditContext();
    return changeMemoAtIndex(
      selectedMemoIndex,
      (currentMemo) => {
        const currentFormat = normalizeMemoFormat(currentMemo.format, defaultMemoFormat);
        if (currentFormat === nextFormat) return currentMemo;
        return {
          ...currentMemo,
          format: nextFormat,
          content: convertMemoContent(currentMemo.content, currentFormat, nextFormat),
        };
      },
      editContext
    );
  };

  const changeTaskField = (key, value, debounceChange = false) => {
    if (!node) {
      return;
    }

    const editContext = getEditContext();
    node.data[key] = value;
    if (debounceChange) {
      changeDataDebounce(node, key, value, editContext);
    } else {
      changeData(node, key, value, editContext);
    }
  };

  const handleNameInput = (event) => {
    changeTaskField("name", event.target.value, true);
  };

  const flushNameChange = () => {
    changeDataDebounce.flush?.();
  };

  function resetCardSplit() {
    clearTimeout(snapTimer);
    detailPaneSize = "auto";
    detailPanePercent = 0;
    splitState = "open";
    splitSnapping = false;
  }

  function getCurrentPaneSizes() {
    const total = Math.max(0, splitBody?.getBoundingClientRect().height - RESIZER_SIZE);
    const detailHeight = detailPane?.getBoundingClientRect().height ?? 0;
    const memoHeight =
      memoPane?.getBoundingClientRect().height ?? Math.max(0, total - detailHeight);
    return {
      total: detailHeight + memoHeight || total,
      detailHeight,
      memoHeight,
    };
  }

  function finishSnapTransition() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      splitSnapping = false;
    }, SNAP_TRANSITION_MS);
  }

  function applyDetailSize(detailHeight, totalHeight, nextState = "open", snap = false) {
    const safeTotal = Math.max(1, totalHeight);
    splitState = nextState;
    splitSnapping = snap;

    if (nextState === "open") {
      detailPanePercent = (detailHeight / safeTotal) * 100;
      detailPaneSize = `${detailHeight}px`;
    } else if (nextState === "detail-mini") {
      detailPaneSize = `${MINI_PANE_SIZE}px`;
      detailPanePercent = 0;
    } else {
      detailPaneSize = `${Math.max(0, safeTotal - MINI_PANE_SIZE)}px`;
      detailPanePercent = 100;
    }

    if (snap) {
      finishSnapTransition();
    }
  }

  function handleCardResizePointerMove(event) {
    const delta = event.clientY - resizeStartY;
    let rawDetailSize = startDetailSize + delta;
    let rawMemoSize = startMemoSize - delta;

    if (rawDetailSize < 0) {
      rawMemoSize += rawDetailSize;
      rawDetailSize = 0;
    }
    if (rawMemoSize < 0) {
      rawDetailSize += rawMemoSize;
      rawMemoSize = 0;
    }

    lastDesiredDetailSize = rawDetailSize;
    lastDesiredMemoSize = rawMemoSize;
    applyDetailSize(rawDetailSize, startDetailSize + startMemoSize, "open");
  }

  function stopCardResize() {
    window.removeEventListener("pointermove", handleCardResizePointerMove);
    window.removeEventListener("pointerup", finishCardResize);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }

  function finishCardResize() {
    document.body.style.cursor = "";
    stopCardResize();

    const totalHeight = startDetailSize + startMemoSize;
    let finalDetailSize = lastDesiredDetailSize;
    let finalMemoSize = lastDesiredMemoSize;
    let nextState = "open";

    if (finalDetailSize < SNAP_THRESHOLD) {
      finalDetailSize = MINI_PANE_SIZE;
      finalMemoSize = totalHeight - MINI_PANE_SIZE;
      nextState = "detail-mini";
    } else if (finalDetailSize < DETAIL_MIN_HEIGHT) {
      finalDetailSize = DETAIL_MIN_HEIGHT;
      finalMemoSize = totalHeight - DETAIL_MIN_HEIGHT;
    }

    if (finalMemoSize < SNAP_THRESHOLD) {
      finalMemoSize = MINI_PANE_SIZE;
      finalDetailSize = totalHeight - MINI_PANE_SIZE;
      nextState = "memo-mini";
    } else if (nextState === "open" && finalMemoSize < MEMO_MIN_HEIGHT) {
      finalMemoSize = MEMO_MIN_HEIGHT;
      finalDetailSize = totalHeight - MEMO_MIN_HEIGHT;
    }

    applyDetailSize(finalDetailSize, totalHeight, nextState, true);
  }

  function startCardResize(event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    clearTimeout(snapTimer);
    splitSnapping = false;
    const { total, detailHeight, memoHeight } = getCurrentPaneSizes();
    resizeStartY = event.clientY;
    startDetailSize = detailHeight;
    startMemoSize = memoHeight || Math.max(0, total - detailHeight);
    lastDesiredDetailSize = startDetailSize;
    lastDesiredMemoSize = startMemoSize;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handleCardResizePointerMove);
    window.addEventListener("pointerup", finishCardResize);
  }

  function setDetailPanePercent(nextPercent) {
    detailPanePercent = Math.min(76, Math.max(24, nextPercent));
    detailPaneSize = `${detailPanePercent}%`;
    splitState = "open";
  }

  function snapCardSplit(nextState) {
    const { total } = getCurrentPaneSizes();
    const nextDetailSize = nextState === "detail-mini" ? MINI_PANE_SIZE : total - MINI_PANE_SIZE;
    applyDetailSize(nextDetailSize, total, nextState, true);
  }

  function handleCardResizeKeydown(event) {
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        setDetailPanePercent(detailPanePercent - 5);
        break;
      case "ArrowDown":
        event.preventDefault();
        setDetailPanePercent(detailPanePercent + 5);
        break;
      case "Home":
        event.preventDefault();
        snapCardSplit("detail-mini");
        break;
      case "End":
        event.preventDefault();
        snapCardSplit("memo-mini");
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        splitState = "open";
        break;
    }
  }

  function openTaskDetailInWindow() {
    if (!node || !$selected_id || !$table_selected_id) return;

    platform.openTaskDetailWindow({
      projectId: $selected_id,
      taskId: node.id,
      taskName: name,
      selectedType: isWorkspaceProject ? "WorkspaceProject" : "Projects",
      projectDir: isWorkspaceProject ? ($workspace_store.activeProjectDir ?? undefined) : undefined,
    });
  }
</script>

{#if is_selected && node}
  <Card
    title={hideDetailTitle ? "" : name}
    padded={false}
    style={"height: 100%; width: 100%; overflow: hidden;"}
  >
    {#if !hideDetailTitle}
      <IconButton
        slot="header-actions"
        variant="text"
        normalColor="var(--theme-color-Sub-main)"
        activeColor="var(--theme-color-Primary-main)"
        ariaLabel="タスク詳細を別ウィンドウで開く"
        tooltipContent="別ウィンドウで開く"
        style="margin: 0; width: 1.75rem; height: 1.75rem; box-shadow: none;"
        on:click={openTaskDetailInWindow}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M15 3H21V9M14 10L21 3M21 14V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H10"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </IconButton>
    {/if}
    {#if extraSelectedCount > 0}
      <div class="multi-select-indicator" role="status" aria-live="polite">
        他 {extraSelectedCount} 件選択中（一括操作はバーから行えます）
      </div>
    {/if}
    <div
      class="task-detail-card-body"
      class:detail-mini={splitState === "detail-mini"}
      class:memo-mini={splitState === "memo-mini"}
      class:split-snapping={splitSnapping}
      bind:this={splitBody}
      style={`--detail-pane-size: ${detailPaneSize}`}
    >
      <div class="detail-pane" class:auto-detail={detailPaneSize === "auto"} bind:this={detailPane}>
        <div class="detail-container">
          <label class="detail-field">
            <span class="detail-label">Name</span>
            <div class="detail-control">
              <input
                class="detail-input"
                type="text"
                value={name}
                aria-label="Task name"
                on:input={handleNameInput}
                on:blur={flushNameChange}
              />
            </div>
          </label>

          <label class="detail-field">
            <span class="detail-label">Status</span>
            <div class="detail-control">
              <StatusSelect
                status={node.data.status ?? "Open"}
                style="height: 100%; font-size: var(--font-body-md);"
                on:change={(event) => changeTaskField("status", event.detail.value)}
              />
            </div>
          </label>

          <label class="detail-field">
            <span class="detail-label">Start Date</span>
            <div class="detail-control">
              <DateInput
                is_dark={isDark}
                id="detail-start-date"
                backgroundColor={"var(--theme-color-Main-light)"}
                style={detailDateStyle}
                value={node.data["start date"] ?? ""}
                on:change={(event) =>
                  changeTaskField("start date", event.target.value || undefined)}
              />
            </div>
          </label>

          <label class="detail-field">
            <span class="detail-label">Due Date</span>
            <div class="detail-control">
              <DateInput
                is_dark={isDark}
                id="detail-due-date"
                backgroundColor={"var(--theme-color-Main-light)"}
                style={detailDateStyle}
                value={node.data["due date"] ?? ""}
                on:change={(event) => changeTaskField("due date", event.target.value || undefined)}
              />
            </div>
          </label>

          <div class="detail-field">
            <span class="detail-label" id="lbl-memo-count">Memo 数</span>
            <output class="detail-readonly" aria-labelledby="lbl-memo-count" aria-label="Memo count"
              >{memo.length}</output
            >
          </div>
        </div>
      </div>

      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="card-split-resizer"
        role="separator"
        aria-label="Resize task detail and memo"
        aria-orientation="horizontal"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={splitState === "detail-mini"
          ? 0
          : splitState === "memo-mini"
            ? 100
            : Math.round(detailPanePercent)}
        tabindex="0"
        on:pointerdown={startCardResize}
        on:keydown={handleCardResizeKeydown}
      ></div>

      <div class="memo-pane" bind:this={memoPane}>
        <div class="memotab-container">
          <MemoTab
            {memo}
            {saveMemo}
            {addMemo}
            {deleteMemo}
            {renameMemo}
            {reorderMemo}
            {saveMemoTags}
            {changeMemoFormat}
            {allTags}
            {isWorkspaceProject}
            {defaultMemoFormat}
            {workspaceProjectDir}
            taskId={$table_selected_id ?? null}
          />
        </div>
      </div>
    </div>
  </Card>
{:else}
  <h1 class="empty-state">No data.</h1>
{/if}

<style>
  .empty-state {
    color: var(--theme-color-Sub-main);
    display: flex;
    justify-content: center;
  }
  .task-detail-card-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .multi-select-indicator {
    padding: var(--sp1) var(--sp3);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 14%, transparent);
    color: var(--theme-color-Primary-dark);
    font-size: var(--font-label-md);
    font-weight: 600;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 30%, transparent);
  }
  .detail-pane {
    flex: 0 0 var(--detail-pane-size);
    min-height: 0;
    box-sizing: border-box;
    overflow: hidden;
  }
  .detail-pane.auto-detail {
    flex-basis: auto;
  }
  .memo-pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    box-sizing: border-box;
    overflow: hidden;
  }
  .task-detail-card-body.split-snapping .detail-pane,
  .task-detail-card-body.split-snapping .memo-pane {
    transition: flex-basis 0.18s ease;
  }
  .task-detail-card-body.detail-mini .detail-pane {
    flex-basis: 0;
  }
  .task-detail-card-body.memo-mini .detail-pane {
    flex: 1 1 auto;
  }
  .task-detail-card-body.memo-mini .memo-pane {
    flex: 0 0 0;
  }
  .task-detail-card-body.detail-mini .detail-container,
  .task-detail-card-body.memo-mini .memotab-container {
    display: none;
  }
  .card-split-resizer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 5px;
    min-height: 5px;
    padding: 0;
    cursor: row-resize;
    background-color: transparent;
    border: none;
    touch-action: none;
  }
  .card-split-resizer::before {
    content: "";
    position: absolute;
    top: 1px;
    left: 0;
    width: 100%;
    height: 3px;
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 48%, transparent);
    border-radius: 1.5px;
    opacity: 0.85;
    transition:
      background-color 0.15s ease,
      height 0.15s ease,
      opacity 0.15s ease;
  }
  .card-split-resizer::after {
    content: "";
    position: absolute;
    top: 1px;
    left: 50%;
    width: 1.5rem;
    height: 3px;
    transform: translateX(-50%);
    background-image: radial-gradient(circle, var(--theme-color-Main-main) 1px, transparent 1.2px);
    background-size: 4px 3px;
    background-repeat: repeat-x;
    opacity: 0.9;
    pointer-events: none;
  }
  .card-split-resizer:hover::before,
  .card-split-resizer:focus-visible::before {
    top: 0;
    height: 5px;
    background-color: var(--theme-color-Primary-main);
    opacity: 1;
  }
  .card-split-resizer:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
  }
  .detail-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-content: start;
    gap: var(--sp2) var(--sp4);
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    padding: var(--sp3);
    overflow: auto;
    container-type: inline-size;
  }
  .detail-pane.auto-detail .detail-container {
    height: auto;
    min-height: 0;
    overflow: visible;
  }
  .detail-field {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.2rem;
    min-width: 0;
    color: var(--theme-color-Sub-main);
  }
  .detail-label {
    flex: 0 0 auto;
    min-width: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    letter-spacing: 0.01em;
    line-height: 1.3;
    user-select: none;
  }
  .detail-input {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 0;
    padding: 0 var(--sp2);
    color: var(--theme-color-Sub-main);
    background-color: transparent;
    font-size: var(--font-body-md);
  }
  .detail-input:focus {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  .detail-control {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 2rem;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-sm);
    background-color: var(--theme-color-Main-light);
    overflow: hidden;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
    --backgroundColor: var(--theme-color-Main-light);
  }
  .detail-control:focus-within {
    border-color: var(--theme-color-Primary-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
  }
  .detail-readonly {
    padding: var(--sp1) var(--sp2);
    font-size: var(--font-body-md);
    font-weight: 600;
    color: var(--theme-color-Sub-main);
  }
  .detail-control :global(.StatusContainer) {
    gap: var(--sp1);
    padding: 0 var(--sp1);
    box-sizing: border-box;
  }
  .detail-control :global(.StatusContainer svg) {
    flex: 0 0 1.1rem;
    width: 1.1rem;
  }
  .detail-control :global(.select select) {
    font-size: 1rem;
  }
  .detail-control :global(.Date) {
    font-size: 1rem;
  }
  .memotab-container {
    display: flex;
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    margin: 0;
    padding: var(--sp3);
    overflow: hidden;
  }
  .memotab-container > :global(.container) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  @container (max-width: 28rem) {
    .detail-container {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 760px) {
    .detail-container {
      grid-template-columns: 1fr;
    }
  }
</style>
