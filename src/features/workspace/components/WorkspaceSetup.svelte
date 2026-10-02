<script lang="ts">
  import { userErrorMessage } from "@lib/utils/error_messages";
  import Modal from "@lib/primitives/Modal.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { workspace_graph_store } from "@features/workspace/stores/graph";
  import * as platform from "@lib/ipc/platform";

  interface Props {
    show?: boolean;
    toggle: () => void;
  }

  let { show = false, toggle }: Props = $props();

  let pendingPath: string | null = $state(null);
  let pendingLabel = $state("");
  let errorMessage = $state("");

  // ディスクから読み直す（ワークスペースのフォルダーを外で書き換えたとき）。
  let reloadBusy = $state(false);
  let reloadMessage = $state("");

  async function reloadFromDisk() {
    if (!activeWorkspacePath || reloadBusy) return;
    reloadBusy = true;
    reloadMessage = "";
    try {
      await workspace_graph_store.reload(activeWorkspacePath);
      reloadMessage = "ディスクの内容を読み込み直しました。";
    } catch (error) {
      reloadMessage = userErrorMessage(error);
    } finally {
      reloadBusy = false;
    }
  }

  // 旧形式のフォルダーを、別の場所へ変換して書き出す（移行のための一時的な機能）。
  let convertBusy = $state(false);
  let convertMessage = $state("");

  async function convertLegacy() {
    if (convertBusy) return;
    convertBusy = true;
    convertMessage = "";
    errorMessage = "";
    try {
      const result = await platform.wsConvertLegacy();
      if (result.error) {
        errorMessage = result.error;
      } else if (result.path) {
        // 書き出した先を、追加できる状態にする（「追加」を押すと開く）。
        pendingPath = result.path;
        pendingLabel = result.path.split(/[/\\]/).pop() ?? "";
        convertMessage = `書き出しました（本文にまとめたメモ: ${result.merged ?? 0} 件）。「追加」で開けます。`;
      }
    } catch (error) {
      errorMessage = userErrorMessage(error);
    } finally {
      convertBusy = false;
    }
  }

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
    // 追加したフォルダーをそのまま開く。以前は開いているワークスペースが
    // あると登録だけで、「切り替え」を押すまで画面に何も出なかった。
    await workspace_store.setActive(pendingPath);
    pendingPath = null;
    pendingLabel = "";
  }

  async function handleSetActive(path: string) {
    await workspace_store.setActive(path);
  }

  function handleRemove(path: string) {
    workspace_store.removeWorkspace(path);
  }
  let activeWorkspacePath = $derived($workspace_store.activeWorkspacePath);
  // 開き直したとき・ワークスペースを切り替えたときは、前の結果の表示を消す。
  $effect.pre(() => {
    void show;
    void activeWorkspacePath;
    reloadMessage = "";
  });
</script>

<Modal {show} {toggle} width="33rem" height="auto">
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
                  <button class="action-btn set-active" onclick={() => handleSetActive(ws.path)}>
                    切り替え
                  </button>
                {:else}
                  <span class="active-badge">使用中</span>
                {/if}
                <IconButton
                  ariaLabel="削除"
                  tooltipContent="このワークスペースを削除"
                  variant="text"
                  style="height:1.5rem; width:1.5rem; margin:0; box-shadow:none;"
                  normalColor="var(--theme-color-Error-main)"
                  activeColor="var(--theme-color-Error-dark)"
                  onclick={() => handleRemove(ws.path)}
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
        <button class="select-dir-btn" onclick={handleSelectDirectory}> フォルダを選択... </button>
        {#if pendingPath}
          <span class="pending-path">{pendingPath}</span>
          <input class="label-input" bind:value={pendingLabel} placeholder="ラベル（省略可）" />
          <button class="action-btn confirm-btn" onclick={handleAdd}>追加</button>
        {/if}
      </div>
      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}

      <p class="section-label">旧形式から変換して書き出す</p>
      <div class="migrate-area">
        <p class="migrate-note">
          旧形式（メモを別ファイルで持つ形）のフォルダーを、別の空のフォルダーへ書き出します。メモが
          1
          つだけで名前が「memo」、かつ親の本文が空のものは、親の本文にまとめます。元のフォルダーは変更しません。
        </p>
        <button class="action-btn confirm-btn" disabled={convertBusy} onclick={convertLegacy}>
          {convertBusy ? "変換中..." : "旧形式のフォルダーを変換..."}
        </button>
        {#if convertMessage}<p class="migrate-note" role="status">{convertMessage}</p>{/if}
      </div>

      {#if activeWorkspacePath}
        <p class="section-label">ディスクから読み込み直す</p>
        <div class="migrate-area">
          <p class="migrate-note">
            ワークスペースのフォルダーの Markdown ファイルを、アプリの外（エディターや AI
            など）で書き換えたときや、旧形式のプロジェクトのフォルダーを置いたときに使います。画面はディスクの内容になります。
          </p>
          <button class="action-btn confirm-btn" disabled={reloadBusy} onclick={reloadFromDisk}>
            {reloadBusy ? "読み込み中..." : "読み込み直す"}
          </button>
          {#if reloadMessage}<p class="migrate-note" role="status">{reloadMessage}</p>{/if}
        </div>
      {/if}
    </div>

    <div class="footer">
      <button class="close-btn" onclick={toggle}>閉じる</button>
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
    font-size: 1.05rem;
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
    font-size: 0.75rem;
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
    padding: 0.075rem var(--sp2);
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
    width: 7.5rem;
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
</style>
