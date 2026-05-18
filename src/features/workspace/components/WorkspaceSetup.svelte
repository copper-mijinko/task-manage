<script lang="ts">
  import Modal from "@lib/primitives/Modal.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import MigrationWizard from "@features/workspace/components/MigrationWizard.svelte";
  import { workspace_store } from "@features/workspace/stores/workspace";

  export let show = false;
  export let toggle: () => void;

  let pendingPath: string | null = null;
  let pendingLabel = "";
  let errorMessage = "";
  let showMigration = false;

  async function handleSelectDirectory() {
    errorMessage = "";
    const result = await workspace_store.selectDirectory();
    if (result.error) {
      errorMessage = result.error;
      return;
    }
    if (result.path) {
      pendingPath = result.path;
      if (!pendingLabel) {
        pendingLabel = result.path.split(/[/\\]/).pop() ?? "";
      }
    }
  }

  async function handleAdd() {
    if (!pendingPath) return;
    const label = pendingLabel.trim() || (pendingPath.split(/[/\\]/).pop() ?? pendingPath);
    workspace_store.addWorkspace(pendingPath, label);
    if (!$workspace_store.activeWorkspacePath) {
      await workspace_store.setActive(pendingPath);
    }
    pendingPath = null;
    pendingLabel = "";
  }

  async function handleSetActive(path: string) {
    await workspace_store.setActive(path);
  }

  function handleRemove(path: string) {
    workspace_store.removeWorkspace(path);
  }
</script>

<Modal {show} {toggle} width="44rem" height="auto">
  <div class="container">
    <div class="header">ワークスペース管理</div>

    <div class="body">
      <!-- Registered workspaces -->
      {#if $workspace_store.workspaces.length > 0}
        <p class="section-label">登録済みワークスペース</p>
        <ul class="workspace-list">
          {#each $workspace_store.workspaces as ws (ws.path)}
            <li
              class="workspace-item"
              class:active={ws.path === $workspace_store.activeWorkspacePath}
            >
              <div class="ws-info">
                <span class="ws-label">{ws.label}</span>
                <span class="ws-path">{ws.path}</span>
              </div>
              <div class="ws-actions">
                {#if ws.path !== $workspace_store.activeWorkspacePath}
                  <button class="action-btn set-active" on:click={() => handleSetActive(ws.path)}>
                    切り替え
                  </button>
                {:else}
                  <span class="active-badge">使用中</span>
                {/if}
                <IconButton
                  ariaLabel="削除"
                  tooltipContent="このワークスペースを削除"
                  variant="text"
                  style="height:2rem; width:2rem; margin:0; box-shadow:none;"
                  normalColor="var(--theme-color-Error-main)"
                  activeColor="var(--theme-color-Error-dark)"
                  on:click={() => handleRemove(ws.path)}
                >
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M3 6H21M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M10 11V17M14 11V17M5 6L6 20C6 20.6 6.4 21 7 21H17C17.6 21 18 20.6 18 20L19 6"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </IconButton>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-note">ワークスペースが未登録です。</p>
      {/if}

      <!-- Add new workspace -->
      <p class="section-label">追加</p>
      <div class="add-area">
        <button class="select-dir-btn" on:click={handleSelectDirectory}> フォルダを選択... </button>
        {#if pendingPath}
          <span class="pending-path">{pendingPath}</span>
          <input class="label-input" bind:value={pendingLabel} placeholder="ラベル（省略可）" />
          <button class="action-btn confirm-btn" on:click={handleAdd}>追加</button>
        {/if}
      </div>
      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}

      <!-- Migration -->
      <p class="section-label">移行</p>
      <div class="migrate-area">
        <p class="migrate-note">既存の db.json プロジェクトをワークスペース形式に変換します。</p>
        <button class="migrate-link-btn" on:click={() => (showMigration = true)}>
          レガシーデータを移行...
        </button>
      </div>
    </div>

    <div class="footer">
      <button class="close-btn" on:click={toggle}>閉じる</button>
    </div>
  </div>
</Modal>

<MigrationWizard show={showMigration} toggle={() => (showMigration = !showMigration)} />

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
  }
  .section-label {
    font-size: var(--font-body-md);
    font-weight: bold;
    color: var(--theme-color-Sub-main);
    margin: var(--sp2) 0 var(--sp1);
    opacity: 0.7;
  }
  .workspace-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
  }
  .workspace-item {
    display: flex;
    align-items: center;
    padding: var(--sp2) var(--sp3);
    background-color: var(--theme-color-Main-main);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    gap: var(--sp2);
  }
  .workspace-item:last-child {
    border-bottom: none;
  }
  .workspace-item.active {
    border-left: 3px solid var(--theme-color-Primary-main);
  }
  .ws-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
  .ws-label {
    font-size: 1rem;
    color: var(--theme-color-Sub-main);
    font-weight: bold;
  }
  .ws-path {
    font-size: var(--font-label-md);
    color: var(--theme-color-Sub-dark);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ws-actions {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    flex-shrink: 0;
  }
  .active-badge {
    font-size: var(--font-label-md);
    padding: 0.1rem var(--sp2);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Primary-dark);
    color: white;
  }
  .add-area {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp2);
  }
  .pending-path {
    font-size: var(--font-body-sm);
    color: var(--theme-color-Sub-main);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label-input {
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-xs);
    padding: var(--sp1) var(--sp2);
    font-size: var(--font-body-md);
    background-color: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-main);
    width: 10rem;
  }
  .select-dir-btn,
  .action-btn {
    cursor: pointer;
    border: none;
    border-radius: var(--shape-xs);
    padding: var(--sp1) var(--sp3);
    font-size: var(--font-body-md);
  }
  .select-dir-btn {
    background-color: var(--theme-color-Theme-main);
    color: white;
  }
  .select-dir-btn:hover {
    background-color: var(--theme-color-Theme-dark);
  }
  .action-btn {
    background-color: var(--theme-color-Primary-main);
    color: white;
  }
  .action-btn:hover {
    background-color: var(--theme-color-Primary-dark);
  }
  .confirm-btn {
    background-color: var(--theme-color-Success-main);
  }
  .confirm-btn:hover {
    background-color: var(--theme-color-Success-dark);
  }
  .set-active {
    background-color: var(--theme-color-Theme-main);
  }
  .set-active:hover {
    background-color: var(--theme-color-Theme-dark);
  }
  .empty-note {
    font-size: var(--font-body-md);
    color: var(--theme-color-Sub-dark);
  }
  .error {
    color: var(--theme-color-Error-main);
    font-size: var(--font-body-md);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    padding: var(--sp3) var(--sp4);
    border-top: 1px solid var(--theme-color-Sub-dark);
    background-color: var(--theme-color-Main-main);
  }
  .close-btn {
    cursor: pointer;
    border: none;
    border-radius: var(--shape-xs);
    padding: var(--sp1) var(--sp4);
    font-size: var(--font-body-md);
    background-color: var(--theme-color-Sub-dark);
    color: var(--theme-color-Main-main);
  }
  .close-btn:hover {
    opacity: 0.8;
  }
  .migrate-area {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
  }
  .migrate-note {
    font-size: var(--font-body-sm);
    color: var(--theme-color-Sub-dark);
    margin: 0;
  }
  .migrate-link-btn {
    align-self: flex-start;
    cursor: pointer;
    border: none;
    background: none;
    color: var(--theme-color-Primary-main);
    font-size: var(--font-body-md);
    padding: 0;
    text-decoration: underline;
  }
  .migrate-link-btn:hover {
    opacity: 0.75;
  }
</style>
