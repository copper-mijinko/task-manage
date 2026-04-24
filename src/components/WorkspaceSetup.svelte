<script lang="ts">
  import Modal from "./Modal.svelte";
  import IconButton from "./IconButton.svelte";
  import { workspace_store } from "../stores/workspace";

  export let show = false;
  export let toggle: () => void;

  let pendingPath: string | null = null;
  let pendingLabel = "";
  let errorMessage = "";

  async function handleSelectDirectory() {
    errorMessage = "";
    const path = await workspace_store.selectDirectory();
    if (path) {
      pendingPath = path;
      if (!pendingLabel) {
        pendingLabel = path.split(/[/\\]/).pop() ?? "";
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
                  style="height:2rem; width:2rem; margin:0; box-shadow:none;"
                  normalColor="transparent"
                  activeColor="rgba(255,255,255,0.15)"
                  on:click={() => handleRemove(ws.path)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                    <path
                      fill="white"
                      d="M13.05 42q-1.25 0-2.125-.875T10.05 39V10.5H8v-3h9.4V6h13.2v1.5H40v3h-2.05V39q0 1.2-.9 2.1-.9.9-2.1.9Zm21.9-31.5h-21.9V39h21.9Zm-16.6 24.2h3V14.75h-3Zm8.3 0h3V14.75h-3Zm-13.6-24.2V39Z"
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
    </div>

    <div class="footer">
      <button class="close-btn" on:click={toggle}>閉じる</button>
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
  }
  .section-label {
    font-size: 0.9rem;
    font-weight: bold;
    color: var(--theme-color-Sub-main);
    margin: 0.5rem 0 0.25rem;
    opacity: 0.7;
  }
  .workspace-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .workspace-item {
    display: flex;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    background-color: var(--theme-color-Main-main);
    gap: 0.5rem;
  }
  .workspace-item.active {
    border-left: 3px solid var(--theme-color-Accent-main);
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
    font-size: 0.8rem;
    color: var(--theme-color-Sub-dark);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ws-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .active-badge {
    font-size: 0.8rem;
    padding: 0.1rem 0.5rem;
    border-radius: 0.25rem;
    background-color: var(--theme-color-Accent-dark);
    color: white;
  }
  .add-area {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .pending-path {
    font-size: 0.85rem;
    color: var(--theme-color-Sub-main);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label-input {
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.9rem;
    background-color: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-main);
    width: 10rem;
  }
  .select-dir-btn,
  .action-btn {
    cursor: pointer;
    border: none;
    border-radius: 0.25rem;
    padding: 0.3rem 0.75rem;
    font-size: 0.9rem;
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
    font-size: 0.9rem;
    color: var(--theme-color-Sub-dark);
  }
  .error {
    color: var(--theme-color-Error-main);
    font-size: 0.9rem;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--theme-color-Sub-dark);
    background-color: var(--theme-color-Main-main);
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
