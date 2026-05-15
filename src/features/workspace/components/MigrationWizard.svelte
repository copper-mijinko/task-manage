<script lang="ts">
  import Modal from "@lib/primitives/Modal.svelte";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import * as platform from "@lib/ipc/platform";

  export let show = false;
  export let toggle: () => void;

  type LegacyProject = { id: string; name: string; taskCount: number };
  type ExportResult = {
    success: boolean;
    migrated: { name: string; count: number }[];
    errors: { name: string; error: string }[];
  };
  type Phase = "idle" | "loading" | "ready" | "running" | "done";

  let phase: Phase = "idle";
  let legacyProjects: LegacyProject[] = [];
  let selectedPath = $workspace_store.activeWorkspacePath ?? "";
  let customPath = "";
  let useCustom = false;
  let result: ExportResult | null = null;
  let loadError = "";

  $: targetPath = useCustom ? customPath : selectedPath;
  $: workspaces = $workspace_store.workspaces;

  async function handleOpen() {
    phase = "loading";
    loadError = "";
    try {
      legacyProjects = await platform.wsGetLegacyProjects();
      phase = legacyProjects.length === 0 ? "idle" : "ready";
      if (legacyProjects.length === 0) loadError = "No db.json projects found.";
    } catch (e) {
      loadError = String(e);
      phase = "idle";
    }
  }

  async function handleSelectCustom() {
    const p = await workspace_store.selectDirectory();
    if (p) {
      customPath = p;
      useCustom = true;
    }
  }

  async function handleExport() {
    if (!targetPath) return;
    phase = "running";
    try {
      result = await platform.wsExportLegacyProjects(targetPath);
      if (result) {
        await workspace_store.refreshProjects();
      }
    } catch (e) {
      result = { success: false, migrated: [], errors: [{ name: "system", error: String(e) }] };
    }
    phase = "done";
  }

  function handleClose() {
    phase = "idle";
    result = null;
    loadError = "";
    toggle();
  }

  $: if (show && phase === "idle") handleOpen();
</script>

<Modal {show} toggle={handleClose} width="44rem" height="auto">
  <div class="container">
    <div class="header">Export db.json projects</div>

    <div class="body">
      {#if phase === "loading"}
        <p class="note">Loading...</p>
      {:else if phase === "idle"}
        {#if loadError}
          <p class="empty-note">{loadError}</p>
        {/if}
      {:else if phase === "ready" || phase === "running"}
        <p class="section-label">Projects to export ({legacyProjects.length})</p>
        <ul class="project-list">
          {#each legacyProjects as p (p.id)}
            <li class="project-item">
              <span class="project-name">{p.name}</span>
              <span class="task-count">{p.taskCount} tasks</span>
            </li>
          {/each}
        </ul>

        <p class="section-label">Destination workspace</p>
        <div class="target-area">
          {#if workspaces.length > 0}
            <select
              class="ws-select"
              bind:value={selectedPath}
              on:change={() => (useCustom = false)}
              disabled={phase === "running"}
            >
              {#each workspaces as ws (ws.path)}
                <option value={ws.path}>{ws.label}</option>
              {/each}
            </select>
            <span class="or-text">or</span>
          {/if}
          <button class="select-btn" disabled={phase === "running"} on:click={handleSelectCustom}>
            Select folder...
          </button>
          {#if useCustom && customPath}
            <span class="custom-path">{customPath}</span>
          {/if}
        </div>

        <p class="warn-note">
          This exports Markdown files only. The source db.json is not changed.
        </p>
        {#if phase === "running"}
          <p class="note">Exporting...</p>
        {/if}
      {:else if phase === "done" && result}
        {#if result.migrated.length > 0}
          <p class="section-label">Exported ({result.migrated.length})</p>
          <ul class="result-list">
            {#each result.migrated as m}
              <li class="result-ok">OK: {m.name} ({m.count} tasks)</li>
            {/each}
          </ul>
        {/if}
        {#if result.errors.length > 0}
          <p class="section-label error-label">Errors ({result.errors.length})</p>
          <ul class="result-list">
            {#each result.errors as e}
              <li class="result-err">Error: {e.name}: {e.error}</li>
            {/each}
          </ul>
        {/if}
        {#if result.errors.length === 0}
          <p class="success-note">Export completed.</p>
        {/if}
      {/if}
    </div>

    <div class="footer">
      {#if phase === "ready"}
        <button class="export-btn" disabled={!targetPath} on:click={handleExport}>Export</button>
      {/if}
      <button class="close-btn" on:click={handleClose}>
        {phase === "done" ? "Close" : "Cancel"}
      </button>
    </div>
  </div>
</Modal>

<style>
  .container {
    display: flex;
    flex-direction: column;
    width: 100%;
    background-color: var(--theme-color-Main-light);
    border-radius: var(--shape-sm);
    overflow: hidden;
  }

  .header {
    padding: var(--sp3) var(--sp4);
    font-weight: bold;
    font-size: 1.4rem;
    color: var(--theme-color-Sub-main);
    background-color: var(--theme-color-Main-main);
    border-bottom: 1px solid var(--theme-color-Sub-dark);
  }

  .body {
    padding: var(--sp4);
    display: flex;
    flex-direction: column;
    gap: var(--sp2);
    max-height: 60vh;
    overflow-y: auto;
  }

  .section-label {
    font-size: var(--font-body-md);
    font-weight: bold;
    color: var(--theme-color-Sub-main);
    margin: var(--sp2) 0 var(--sp1);
    opacity: 0.75;
  }

  .project-list,
  .result-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
  }

  .project-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--sp2) var(--sp3);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-main);
    gap: var(--sp3);
  }

  .project-name {
    color: var(--theme-color-Sub-main);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-count,
  .note,
  .warn-note,
  .empty-note {
    color: var(--theme-color-Sub-dark);
    font-size: var(--font-body-sm);
  }

  .target-area {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp2);
  }

  .ws-select,
  .select-btn,
  .export-btn,
  .close-btn {
    border: none;
    border-radius: var(--shape-xs);
    padding: var(--sp1) var(--sp3);
    font-size: var(--font-body-md);
  }

  .ws-select {
    background-color: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-main);
    border: 1px solid var(--theme-color-Sub-dark);
  }

  .select-btn,
  .export-btn {
    cursor: pointer;
    background-color: var(--theme-color-Primary-main);
    color: white;
  }

  .select-btn:disabled,
  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .custom-path {
    flex: 1;
    min-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
  }

  .result-ok {
    color: var(--theme-color-Success-main);
  }

  .result-err,
  .error-label {
    color: var(--theme-color-Error-main);
  }

  .success-note {
    color: var(--theme-color-Success-main);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp2);
    padding: var(--sp3) var(--sp4);
    border-top: 1px solid var(--theme-color-Sub-dark);
    background-color: var(--theme-color-Main-main);
  }

  .close-btn {
    cursor: pointer;
    background-color: var(--theme-color-Sub-dark);
    color: var(--theme-color-Main-main);
  }
</style>
