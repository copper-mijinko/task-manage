<script>
  import { createEventDispatcher } from "svelte";
  import { globalDismiss } from "@lib/actions";
  import { stripArchivedNodes } from "@features/tasks/utils/tree_control";
  import TargetTreeNode from "@features/inbox/components/TargetTreeNode.svelte";

  /**
   * Modal picker for cross-task memo duplication. Scoped to the CURRENT
   * project only: `tree` is the already-loaded project tree ($tree_data.data)
   * — no disk/IPC access happens here, unlike ProjectTargetPicker which can
   * load a *different* project. Archived tasks (and their descendants) are
   * dropped from the tree before rendering, so they are simply not
   * selectable rather than shown-but-disabled.
   */

  /** @type {import("@features/tasks/utils/tree_control").TreeData | null} */
  export let tree = null;
  /** The task the memo is being copied FROM. Selecting it is allowed (append-to-current). */
  export let currentTaskId = null;
  /** Title of the memo being duplicated, shown in the footer for context. */
  export let memoTitle = "";
  export let busy = false;
  export let errorMessage = "";

  const dispatch = createEventDispatcher();

  $: visibleTree = tree ? stripArchivedNodes(tree) : null;

  let selectedNodeId = null;
  let expandedIds = new Set();
  let filterQuery = "";
  let initialized = false;

  $: if (visibleTree && !initialized) {
    initialized = true;
    selectedNodeId = nodeExists(visibleTree, currentTaskId) ? currentTaskId : visibleTree.id;
    expandedIds = new Set([visibleTree.id]);
  }

  function nodeExists(root, targetId) {
    if (!root || !targetId) return false;
    if (root.id === targetId) return true;
    return (root.children ?? []).some((child) => nodeExists(child, targetId));
  }

  function findPath(root, targetId, current = []) {
    if (!root) return [];
    const next = [...current, root];
    if (root.id === targetId) return next;
    if (Array.isArray(root.children)) {
      for (const child of root.children) {
        const found = findPath(child, targetId, next);
        if (found.length > 0) return found;
      }
    }
    return [];
  }

  $: pathLabel = (() => {
    if (!visibleTree || !selectedNodeId) return "";
    const path = findPath(visibleTree, selectedNodeId);
    return path.length > 0 ? path.map((n) => n.data?.name || "(no name)").join(" / ") : "";
  })();

  function walk(node, visit, path = []) {
    visit(node, path);
    if (Array.isArray(node.children)) {
      const nextPath = [...path, node];
      for (const child of node.children) walk(child, visit, nextPath);
    }
  }

  $: filterMatches = (() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q || !visibleTree) return null;
    const matchSet = new Set();
    walk(visibleTree, (node, path) => {
      const name = (node.data?.name ?? "").toLowerCase();
      if (name.includes(q)) {
        matchSet.add(node.id);
        for (const ancestor of path) matchSet.add(ancestor.id);
      }
    });
    return matchSet;
  })();

  function handleSelect(e) {
    selectedNodeId = e.detail;
  }

  function handleExpandedChange(e) {
    expandedIds = e.detail;
  }

  function close() {
    if (busy) return;
    dispatch("close");
  }

  function handleConfirm() {
    if (busy || !selectedNodeId) return;
    dispatch("confirm", { targetTaskId: selectedNodeId });
  }

  function handleMaskMousedown(e) {
    if (e.target === e.currentTarget) close();
  }
</script>

<div
  class="PickerMask"
  on:mousedown={handleMaskMousedown}
  role="presentation"
  data-page-search-skip
>
  <div
    class="PickerCard"
    role="dialog"
    aria-modal="true"
    aria-label="別のタスクへ複製"
    use:globalDismiss={close}
  >
    <div class="PickerHeader">
      <svg class="HeaderIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M8 8V5C8 4.4 8.4 4 9 4H19C19.6 4 20 4.4 20 5V15C20 15.6 19.6 16 19 16H16"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
        <path
          d="M5 8H15C15.6 8 16 8.4 16 9V19C16 19.6 15.6 20 15 20H5C4.4 20 4 19.6 4 19V9C4 8.4 4.4 8 5 8Z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
      <span>別のタスクへ複製</span>
      <button type="button" class="CloseBtn" on:click={close} aria-label="閉じる">✕</button>
    </div>

    <div class="PickerControls">
      <label class="ControlField">
        <span class="ControlLabel">絞り込み</span>
        <input
          type="text"
          class="FilterInput"
          placeholder="タスク名で検索"
          bind:value={filterQuery}
          aria-label="タスク名で検索"
        />
      </label>
    </div>

    <div class="PickerBody">
      {#if !visibleTree}
        <div class="StateMessage">タスクを読み込めませんでした。</div>
      {:else}
        <div class="TreeContainer" role="tree" aria-label="タスクのツリー">
          <TargetTreeNode
            node={visibleTree}
            depth={0}
            selectedId={selectedNodeId}
            {expandedIds}
            {filterMatches}
            isRoot={true}
            on:select={handleSelect}
            on:expandedchange={handleExpandedChange}
          />
        </div>
      {/if}
    </div>

    <div class="PickerFooter">
      <div class="FooterPath">
        <span class="FooterLabel">複製先:</span>
        <span class="FooterValue">{pathLabel || "未選択"}</span>
        {#if selectedNodeId && selectedNodeId === currentTaskId}
          <span class="FooterCurrentBadge">現在のタスク</span>
        {/if}
      </div>
      {#if memoTitle}
        <div class="FooterMeta">「{memoTitle}」を複製します</div>
      {/if}
      {#if errorMessage}
        <div class="FooterError" role="alert">{errorMessage}</div>
      {/if}
      <div class="FooterActions">
        <button type="button" class="CancelBtn" on:click={close} disabled={busy}>
          キャンセル
        </button>
        <button
          type="button"
          class="ConfirmBtn"
          on:click={handleConfirm}
          disabled={busy || !visibleTree || !selectedNodeId}
        >
          {busy ? "複製中…" : "複製"}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .PickerMask {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
  }
  .PickerCard {
    width: min(560px, 92vw);
    max-height: min(80vh, 680px);
    background-color: var(--theme-color-Main-main);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 35%, transparent);
    border-radius: var(--shape-md, var(--shape-sm));
    box-shadow: var(--elevation-4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .PickerHeader {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp3) var(--sp4);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-title-md);
    font-weight: 600;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  .HeaderIcon {
    width: 1.2rem;
    height: 1.2rem;
    color: var(--theme-color-Primary-main);
    flex-shrink: 0;
  }
  .CloseBtn {
    margin-left: auto;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    font-size: 1.05rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.2rem var(--sp2);
    border-radius: var(--shape-xs);
  }
  .CloseBtn:hover {
    color: var(--theme-color-Sub-main);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  .PickerControls {
    display: flex;
    flex-direction: column;
    gap: var(--sp2);
    padding: var(--sp3) var(--sp4) var(--sp2);
    flex-shrink: 0;
  }
  .ControlField {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
  }
  .ControlLabel {
    font-size: var(--font-label-md);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    font-weight: 600;
  }
  .FilterInput {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    border-radius: var(--shape-xs);
    padding: 0.35rem var(--sp2);
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
    outline: none;
  }
  .FilterInput:focus {
    border-color: var(--theme-color-Primary-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 25%, transparent);
  }
  .PickerBody {
    flex: 1 1 auto;
    min-height: 12rem;
    overflow-y: auto;
    border-top: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  .StateMessage {
    padding: var(--sp4);
    text-align: center;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
    font-size: var(--font-body-sm);
  }
  .TreeContainer {
    display: flex;
    flex-direction: column;
    padding: var(--sp1) 0;
  }
  .PickerFooter {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
    padding: var(--sp3) var(--sp4);
    flex-shrink: 0;
    background-color: color-mix(in srgb, var(--theme-color-Main-light) 50%, transparent);
  }
  .FooterPath {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    font-size: var(--font-body-sm);
  }
  .FooterLabel {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
    flex-shrink: 0;
  }
  .FooterValue {
    color: var(--theme-color-Primary-main);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .FooterCurrentBadge {
    flex-shrink: 0;
    padding: 0 var(--sp1);
    border-radius: var(--shape-pill);
    background-color: color-mix(in srgb, var(--theme-color-Info-main) 18%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-sm);
    font-weight: 600;
  }
  .FooterMeta {
    font-size: var(--font-label-md);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 60%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .FooterError {
    color: var(--theme-color-Error-main);
    font-size: var(--font-label-md);
    font-weight: 600;
  }
  .FooterActions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp2);
    margin-top: var(--sp1);
  }
  .CancelBtn,
  .ConfirmBtn {
    border: none;
    border-radius: var(--shape-xs);
    padding: 0.4rem var(--sp3);
    font-size: var(--font-body-sm);
    cursor: pointer;
  }
  .CancelBtn {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 15%, transparent);
    color: var(--theme-color-Sub-main);
  }
  .CancelBtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ConfirmBtn {
    background-color: var(--theme-color-Primary-main);
    color: white;
    font-weight: 600;
  }
  .ConfirmBtn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
