<script lang="ts">
  import Modal from "./Modal.svelte";
  import { workspace_store } from "../stores/workspace";
  import * as platform from "../lib/platform";

  export let show = false;
  export let toggle: () => void;

  type LegacyProject = { id: string; name: string; taskCount: number };
  type MigrateResult = {
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
  let result: MigrateResult | null = null;
  let loadError = "";

  $: targetPath = useCustom ? customPath : selectedPath;
  $: workspaces = $workspace_store.workspaces;

  async function handleOpen() {
    phase = "loading";
    loadError = "";
    try {
      legacyProjects = await platform.wsGetLegacyProjects();
      phase = legacyProjects.length === 0 ? "idle" : "ready";
      if (legacyProjects.length === 0) loadError = "移行対象のプロジェクトがありません。";
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

  async function handleMigrate() {
    if (!targetPath) return;
    phase = "running";
    try {
      result = await platform.wsMigrateProjects(targetPath);
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
    <div class="header">レガシーデータを移行</div>

    <div class="body">
      {#if phase === "loading"}
        <p class="note">読み込み中...</p>
      {:else if phase === "idle"}
        {#if loadError}
          <p class="empty-note">{loadError}</p>
        {/if}
      {:else if phase === "ready" || phase === "running"}
        <!-- Project list -->
        <p class="section-label">移行されるプロジェクト ({legacyProjects.length} 件)</p>
        <ul class="project-list">
          {#each legacyProjects as p (p.id)}
            <li class="project-item">
              <span class="project-name">{p.name}</span>
              <span class="task-count">{p.taskCount} タスク</span>
            </li>
          {/each}
        </ul>

        <!-- Target workspace -->
        <p class="section-label">移行先ワークスペース</p>
        <div class="target-area">
          {#if workspaces.length > 0}
            <select
              class="ws-select"
              bind:value={selectedPath}
              on:change={() => (useCustom = false)}
            >
              {#each workspaces as ws (ws.path)}
                <option value={ws.path}>{ws.label}</option>
              {/each}
            </select>
            <span class="or-text">または</span>
          {/if}
          <button class="select-btn" on:click={handleSelectCustom}> フォルダを選択... </button>
          {#if useCustom && customPath}
            <span class="custom-path">{customPath}</span>
          {/if}
        </div>

        <p class="warn-note">
          移行前に <code>db.json.bak</code> としてバックアップが作成されます。
        </p>
      {:else if phase === "done" && result}
        <!-- Results -->
        {#if result.migrated.length > 0}
          <p class="section-label">移行成功 ({result.migrated.length} 件)</p>
          <ul class="result-list">
            {#each result.migrated as m}
              <li class="result-ok">✓ {m.name} ({m.count} タスク)</li>
            {/each}
          </ul>
        {/if}
        {#if result.errors.length > 0}
          <p class="section-label error-label">エラー ({result.errors.length} 件)</p>
          <ul class="result-list">
            {#each result.errors as e}
              <li class="result-err">✗ {e.name}: {e.error}</li>
            {/each}
          </ul>
        {/if}
        {#if result.errors.length === 0}
          <p class="success-note">移行が完了しました。</p>
        {/if}
      {/if}
    </div>

    <div class="footer">
      {#if phase === "ready"}
        <button class="migrate-btn" disabled={!targetPath} on:click={handleMigrate}>
          移行する
        </button>
      {/if}
      <button class="close-btn" on:click={handleClose}>
        {phase === "done" ? "閉じる" : "キャンセル"}
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
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .header {
    padding: 0.75rem 1rem;
    font-weight: bold;
    font-size: 1.4rem;
    color: var(--theme-color-Sub-main);
    background-color: var(--theme-color-Main-main);
    border-bottom: 1px solid var(--theme-color-Sub-dark);
  }
  .body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 60vh;
    overflow-y: auto;
  }
  .section-label {
    font-size: 0.9rem;
    font-weight: bold;
    color: var(--theme-color-Sub-main);
    margin: 0.5rem 0 0.25rem;
    opacity: 0.7;
  }
  .error-label {
    color: var(--theme-color-Error-main);
    opacity: 1;
  }
  .project-list,
  .result-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .project-item {
    display: flex;
    align-items: center;
    padding: 0.35rem 0.75rem;
    border-radius: 0.25rem;
    background-color: var(--theme-color-Main-main);
    gap: 0.5rem;
  }
  .project-name {
    flex: 1;
    color: var(--theme-color-Sub-main);
    font-size: 0.95rem;
  }
  .task-count {
    font-size: 0.8rem;
    color: var(--theme-color-Sub-dark);
    flex-shrink: 0;
  }
  .result-ok {
    font-size: 0.9rem;
    color: var(--theme-color-Success-main);
    padding: 0.2rem 0.5rem;
  }
  .result-err {
    font-size: 0.9rem;
    color: var(--theme-color-Error-main);
    padding: 0.2rem 0.5rem;
    word-break: break-all;
  }
  .target-area {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .ws-select {
    background-color: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-main);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: 0.25rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.9rem;
    min-width: 10rem;
  }
  .or-text {
    font-size: 0.85rem;
    color: var(--theme-color-Sub-dark);
  }
  .select-btn {
    cursor: pointer;
    border: none;
    border-radius: 0.25rem;
    padding: 0.3rem 0.75rem;
    font-size: 0.9rem;
    background-color: var(--theme-color-Theme-main);
    color: white;
  }
  .select-btn:hover {
    background-color: var(--theme-color-Theme-dark);
  }
  .custom-path {
    font-size: 0.8rem;
    color: var(--theme-color-Sub-main);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn-note {
    font-size: 0.82rem;
    color: var(--theme-color-Sub-dark);
    margin-top: 0.25rem;
  }
  .warn-note code {
    background-color: var(--theme-color-Main-dark);
    padding: 0.1rem 0.3rem;
    border-radius: 0.2rem;
    font-size: 0.82rem;
  }
  .success-note {
    font-size: 0.9rem;
    color: var(--theme-color-Success-main);
    margin-top: 0.25rem;
  }
  .note,
  .empty-note {
    font-size: 0.9rem;
    color: var(--theme-color-Sub-dark);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--theme-color-Sub-dark);
    background-color: var(--theme-color-Main-main);
  }
  .migrate-btn {
    cursor: pointer;
    border: none;
    border-radius: 0.25rem;
    padding: 0.3rem 1rem;
    font-size: 0.9rem;
    background-color: var(--theme-color-Primary-main);
    color: white;
  }
  .migrate-btn:hover:not(:disabled) {
    background-color: var(--theme-color-Primary-dark);
  }
  .migrate-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .close-btn {
    cursor: pointer;
    border: none;
    border-radius: 0.25rem;
    padding: 0.3rem 1rem;
    font-size: 0.9rem;
    background-color: var(--theme-color-Sub-dark);
    color: var(--theme-color-Main-main);
  }
  .close-btn:hover {
    opacity: 0.8;
  }
</style>
