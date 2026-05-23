<script>
  import { onMount, tick, createEventDispatcher } from "svelte";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { workspaceToProjectData } from "@features/workspace/utils/workspace_tree";
  import * as platform from "@lib/ipc/platform";
  import { globalDismiss } from "@lib/actions";
  import TargetTreeNode from "./TargetTreeNode.svelte";

  /** Number of items the parent intends to send. Used for the footer summary. */
  export let itemCount = 0;
  /** Initial project to show. Defaults to the workspace's active project. */
  export let initialProjectDir = null;

  const dispatch = createEventDispatcher();

  $: projects = $workspace_store.projects ?? [];

  let selectedProjectDir = null;
  let projectData = null;
  let projectLoading = false;
  let projectError = "";
  let selectedNodeId = null;
  let expandedIds = new Set();
  let filterQuery = "";
  let busy = false;
  let busyError = "";

  $: selectedProject = projects.find((p) => p.projectDir === selectedProjectDir) ?? null;

  // Build a path string ("ProjectA / 設計 / レビュー対応") for the chosen node.
  $: pathLabel = (() => {
    if (!projectData?.data || !selectedNodeId) return selectedProject?.name ?? "";
    const path = findPath(projectData.data, selectedNodeId);
    return path.length > 0 ? path.map((n) => n.data?.name || "(no name)").join(" / ") : "";
  })();

  // For filtering: collect ids of nodes that match the query plus their
  // ancestors so the tree remains coherent. Returns null when no filter is
  // active (so the recursive child component knows to fall back to expand
  // state).
  $: filterMatches = (() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q || !projectData?.data) return null;
    const matchSet = new Set();
    const ancestors = [];
    walk(
      projectData.data,
      (node, path) => {
        const name = (node.data?.name ?? "").toLowerCase();
        if (name.includes(q)) {
          matchSet.add(node.id);
          for (const ancestor of path) matchSet.add(ancestor.id);
        }
      },
      ancestors
    );
    return matchSet;
  })();

  function walk(node, visit, path = []) {
    visit(node, path);
    if (Array.isArray(node.children)) {
      const nextPath = [...path, node];
      for (const child of node.children) walk(child, visit, nextPath);
    }
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

  async function loadProject(projectDir) {
    selectedProjectDir = projectDir;
    projectError = "";
    projectData = null;
    selectedNodeId = null;
    expandedIds = new Set();
    if (!projectDir) return;
    const proj = projects.find((p) => p.projectDir === projectDir);
    if (!proj) {
      projectError = "プロジェクト情報が見つかりません";
      return;
    }
    projectLoading = true;
    try {
      const result = await platform.wsReadProject(projectDir);
      if (!result?.tasks) {
        projectError = "プロジェクトを読み込めませんでした";
        return;
      }
      projectData = workspaceToProjectData(result.tasks, proj.rootId);
      selectedNodeId = proj.rootId;
      expandedIds = new Set([proj.rootId]);
    } catch (err) {
      projectError = err && err.message ? err.message : "プロジェクトの読み込みに失敗しました";
    } finally {
      projectLoading = false;
    }
  }

  function handleProjectChange(e) {
    const next = e.detail?.value ?? e.target?.value;
    if (next && next !== selectedProjectDir) {
      loadProject(next);
    }
  }

  function handleSelect(e) {
    selectedNodeId = e.detail;
  }

  function handleExpandedChange(e) {
    expandedIds = e.detail;
  }

  function close() {
    dispatch("close");
  }

  async function handleConfirm() {
    if (busy) return;
    if (!selectedProject || !selectedNodeId) return;
    busy = true;
    busyError = "";
    const targetParentId = selectedNodeId === selectedProject.rootId ? undefined : selectedNodeId;
    dispatch("confirm", {
      targetProjectDir: selectedProject.projectDir,
      targetRootId: selectedProject.rootId,
      targetParentId,
    });
    // Parent component handles the rest; we don't toggle busy back here
    // since the modal will be closed on success.
  }

  function handleMaskMousedown(e) {
    if (e.target === e.currentTarget) close();
  }

  onMount(async () => {
    const initial =
      initialProjectDir ?? $workspace_store.activeProjectDir ?? projects[0]?.projectDir ?? null;
    if (initial) {
      await loadProject(initial);
    }
    await tick();
  });
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
    aria-label="プロジェクトへ送る"
    use:globalDismiss={close}
  >
    <div class="PickerHeader">
      <svg class="HeaderIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M5 12H19M13 6L19 12L13 18"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
      <span>プロジェクトへ送る</span>
      <button type="button" class="CloseBtn" on:click={close} aria-label="閉じる">✕</button>
    </div>

    <div class="PickerControls">
      <label class="ControlField">
        <span class="ControlLabel">プロジェクト</span>
        {#if projects.length > 0}
          <select
            class="ProjectSelect"
            value={selectedProjectDir}
            on:change={handleProjectChange}
            aria-label="送信先プロジェクト"
          >
            {#each projects as project (project.projectDir)}
              <option value={project.projectDir}>{project.name || project.dirName}</option>
            {/each}
          </select>
        {:else}
          <div class="EmptyHint">プロジェクトがありません</div>
        {/if}
      </label>
      <label class="ControlField">
        <span class="ControlLabel">絞り込み</span>
        <input
          type="text"
          class="FilterInput"
          placeholder="ツリー内をノード名で検索"
          bind:value={filterQuery}
          aria-label="ツリー内をノード名で検索"
        />
      </label>
    </div>

    <div class="PickerBody">
      {#if projectLoading}
        <div class="StateMessage">読み込み中...</div>
      {:else if projectError}
        <div class="StateMessage Error" role="alert">{projectError}</div>
      {:else if !projectData?.data}
        <div class="StateMessage">プロジェクトを選択してください。</div>
      {:else}
        <div class="TreeContainer" role="tree" aria-label="プロジェクトのツリー">
          <TargetTreeNode
            node={projectData.data}
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
        <span class="FooterLabel">送信先:</span>
        <span class="FooterValue">{pathLabel || "未選択"}</span>
      </div>
      <div class="FooterMeta">
        {itemCount} 件 を「{pathLabel.split(" / ").pop() || "ルート"}」の子として追加します
      </div>
      {#if busyError}
        <div class="FooterError" role="alert">{busyError}</div>
      {/if}
      <div class="FooterActions">
        <button type="button" class="CancelBtn" on:click={close}>キャンセル</button>
        <button
          type="button"
          class="ConfirmBtn"
          on:click={handleConfirm}
          disabled={busy || !projectData?.data || !selectedNodeId || itemCount === 0}
        >
          送る
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
    width: min(640px, 92vw);
    max-height: min(80vh, 720px);
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
    width: 1.3rem;
    height: 1.3rem;
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
  .EmptyHint {
    padding: var(--sp2);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 55%, transparent);
    font-size: var(--font-body-sm);
    border: 1px dashed color-mix(in srgb, var(--theme-color-Sub-main) 20%, transparent);
    border-radius: var(--shape-xs);
    text-align: center;
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
  .ProjectSelect {
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
  .ProjectSelect:focus {
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
  .StateMessage.Error {
    color: var(--theme-color-Error-main);
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
  .FooterMeta {
    font-size: var(--font-label-md);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 60%, transparent);
  }
  .FooterError {
    color: var(--theme-color-Error-main);
    font-size: var(--font-label-md);
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
