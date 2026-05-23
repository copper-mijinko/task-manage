<script>
  import { afterUpdate, tick, createEventDispatcher } from "svelte";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { inbox_store } from "@features/inbox/stores/inbox";

  /**
   * Lightweight quick-capture overlay. Designed for "tap → type → enter →
   * gone" flow, so this is intentionally simpler than the full Modal
   * primitive (no Card chrome, no padding-aware layout).
   */
  export let show = false;

  const dispatch = createEventDispatcher();

  let inputEl;
  let value = "";
  let recentAdds = [];
  let busy = false;
  let errorMessage = "";
  let lastShow = false;

  $: workspaceReady = Boolean($workspace_store.activeWorkspacePath);

  afterUpdate(async () => {
    if (show && !lastShow) {
      // Just opened — reset and focus.
      value = "";
      recentAdds = [];
      errorMessage = "";
      await tick();
      inputEl?.focus();
    }
    lastShow = show;
  });

  function close() {
    dispatch("close");
  }

  async function handleAdd(closeAfter) {
    const name = value.trim();
    if (!name || busy) return;
    if (!workspaceReady) {
      errorMessage = "Workspaceを設定してください";
      return;
    }
    busy = true;
    errorMessage = "";
    const result = await inbox_store.addItem({ name });
    busy = false;
    if (!result.success) {
      errorMessage = result.error || "追加に失敗しました";
      return;
    }
    recentAdds = [name, ...recentAdds].slice(0, 5);
    value = "";
    if (closeAfter) {
      close();
    } else {
      await tick();
      inputEl?.focus();
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      handleAdd(e.shiftKey);
    }
  }

  function handleMaskMousedown(e) {
    if (e.target === e.currentTarget) {
      close();
    }
  }
</script>

{#if show}
  <div
    class="QuickCaptureMask"
    on:mousedown={handleMaskMousedown}
    role="presentation"
    data-page-search-skip
  >
    <div class="QuickCaptureCard" role="dialog" aria-modal="true" aria-label="Inboxへクイック追加">
      <div class="QuickCaptureHeader">
        <svg class="HeaderIcon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M3 12L5.5 5.5C5.7 4.9 6.3 4.5 7 4.5H17C17.7 4.5 18.3 4.9 18.5 5.5L21 12V18C21 18.6 20.6 19 20 19H4C3.4 19 3 18.6 3 18V12Z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
            fill="none"
          />
          <path
            d="M3 12H8L9.5 14H14.5L16 12H21"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>
        <span>Inboxへ追加</span>
        <button type="button" class="CloseBtn" on:click={close} aria-label="閉じる"> ✕ </button>
      </div>

      <input
        bind:this={inputEl}
        bind:value
        on:keydown={handleKeydown}
        placeholder="思いついたタスクを入力 ... Enterで追加、Shift+Enterで追加して閉じる"
        class="QuickCaptureInput"
        type="text"
        aria-label="追加するタスク名"
        disabled={!workspaceReady}
      />

      <div class="QuickCaptureMeta">
        {#if !workspaceReady}
          <span class="MetaWarn">Workspaceが未設定です。先にワークスペースを追加してください。</span
          >
        {:else if errorMessage}
          <span class="MetaError">{errorMessage}</span>
        {:else}
          <span class="MetaHint">
            Enter で追加して入力欄をリセット / Shift+Enter で追加して閉じる / Esc で閉じる
          </span>
        {/if}
      </div>

      {#if recentAdds.length > 0}
        <div class="RecentList" aria-live="polite">
          <span class="RecentLabel">追加済み:</span>
          <ul>
            {#each recentAdds as item, i (i + "-" + item)}
              <li>{item}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .QuickCaptureMask {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 18vh;
    z-index: 99999;
    backdrop-filter: blur(2px);
  }
  .QuickCaptureCard {
    width: min(640px, 92vw);
    background-color: var(--theme-color-Main-main);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 35%, transparent);
    border-radius: var(--shape-md, var(--shape-sm));
    box-shadow: var(--elevation-4);
    padding: var(--sp4);
    display: flex;
    flex-direction: column;
    gap: var(--sp2);
  }
  .QuickCaptureHeader {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-title-md);
    font-weight: 600;
  }
  .HeaderIcon {
    width: 1.4rem;
    height: 1.4rem;
    color: var(--theme-color-Primary-main);
    flex-shrink: 0;
  }
  .CloseBtn {
    margin-left: auto;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    font-size: 1.1rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.2rem var(--sp2);
    border-radius: var(--shape-xs);
  }
  .CloseBtn:hover {
    color: var(--theme-color-Sub-main);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  .QuickCaptureInput {
    width: 100%;
    box-sizing: border-box;
    border: 1.5px solid color-mix(in srgb, var(--theme-color-Primary-main) 40%, transparent);
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-main);
    border-radius: var(--shape-sm);
    padding: var(--sp3);
    font-size: 1.1rem;
    outline: none;
  }
  .QuickCaptureInput:focus {
    border-color: var(--theme-color-Primary-main);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-color-Primary-main) 25%, transparent);
  }
  .QuickCaptureInput:disabled {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 8%, transparent);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 60%, transparent);
  }
  .QuickCaptureMeta {
    font-size: var(--font-label-md);
    min-height: 1.1rem;
  }
  .MetaHint {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 60%, transparent);
  }
  .MetaError {
    color: var(--theme-color-Error-main);
  }
  .MetaWarn {
    color: var(--theme-color-Warning-main);
  }
  .RecentList {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
    padding-top: var(--sp2);
    border-top: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 14%, transparent);
  }
  .RecentLabel {
    font-size: var(--font-label-md);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
  }
  .RecentList ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .RecentList li {
    padding: 0.15rem var(--sp2);
    background-color: color-mix(in srgb, var(--theme-color-Success-main) 8%, transparent);
    border-left: 2px solid var(--theme-color-Success-main);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
    border-radius: var(--shape-xs);
  }
</style>
