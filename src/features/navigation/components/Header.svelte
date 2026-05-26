<script>
  import { onMount } from "svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import ToggleSwitch from "@lib/primitives/ToggleSwitch.svelte";
  import SettingsModal from "@features/settings/components/SettingsModal.svelte";
  import {
    theme,
    saveStatus,
    sidebarCollapsed,
    selected_type,
    selected_id,
    navigation_history,
    canGoBack,
    canGoForward,
  } from "@stores";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { inbox_count, INBOX_SELECTED_ID } from "@features/inbox/stores/inbox";
  import { pageSearchQuery } from "@features/search/stores/search";
  import * as platform from "@lib/ipc/platform";
  import {
    setQuery,
    next as nextMatch,
    prev as prevMatch,
    pageSearchMatchCount,
    pageSearchCurrentIndex,
  } from "@features/search/utils/page_search_highlighter";

  export let title = "Task Manage";
  let searchInputEl;
  let queryText = "";
  let isMaximized = false;
  let showSettings = false;

  onMount(async () => {
    try {
      const state = await platform.windowGetState();
      isMaximized = !!state?.isMaximized;
    } catch {
      // ignore
    }
    platform.onWindowStateChanged((state) => {
      isMaximized = !!state?.isMaximized;
    });
  });

  function handleMinimize() {
    platform.windowMinimize();
  }
  function handleToggleMaximize() {
    platform.windowToggleMaximize();
  }
  function handleClose() {
    platform.windowClose();
  }

  // Header search is purely an in-screen highlight (no row filtering).
  // The toolbar SearchBox handles "filter tasks", so we just feed
  // pageSearchQuery here and leave the filter store alone.
  function applyQuery(value) {
    queryText = value;
    pageSearchQuery.set(value);
    setQuery(value);
  }

  function handleSearchInput(e) {
    applyQuery(e.currentTarget.value);
  }

  function handleSearchKeydown(e) {
    if (e.key === "Escape") {
      applyQuery("");
      e.currentTarget.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prevMatch();
      else nextMatch();
    }
  }

  function handleGlobalKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      searchInputEl?.focus();
      searchInputEl?.select();
    }
    if (e.key === "F3" || ((e.ctrlKey || e.metaKey) && e.key === "g")) {
      // Browser-style "find next" shortcut.
      e.preventDefault();
      if (e.shiftKey) prevMatch();
      else nextMatch();
    }
  }

  function goBack() {
    navigation_history.back();
  }
  function goForward() {
    navigation_history.forward();
  }

  function isSavePending(status) {
    return status === "queued" || status === "writing" || status === "retrying";
  }

  function saveStatusLabel(status) {
    if (status === "error") return "保存失敗";
    if (status === "conflict") return "競合";
    if (status === "queued") return "保存待ち";
    if (status === "retrying") return "再試行中";
    if (status === "writing") return "保存中...";
    return "保存済み";
  }

  function openInboxView() {
    if (!$workspace_store.activeWorkspacePath) return;
    $selected_type = "Inbox";
    $selected_id = INBOX_SELECTED_ID;
  }
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<div class="Container" data-page-search-skip>
  <IconButton
    on:click={() => {
      $sidebarCollapsed = !$sidebarCollapsed;
    }}
    ariaLabel={$sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
    tooltipContent={$sidebarCollapsed ? "サイドバーを表示" : "サイドバーを折りたたむ"}
    use_ripple={false}
    activeColor={"transparent"}
    normalColor={"transparent"}
    style={"box-shadow: none; height:3rem; width: 3rem"}
  >
    {#if $sidebarCollapsed}
      <!-- Hamburger when the sidebar is hidden — clicking opens it. -->
      <svg class="Menu" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
        ><path
          d="M4 6H20M4 12H20M4 18H20"
          stroke="#ffffff"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></path></svg
      >
    {:else}
      <!-- Plain chevron-left "＜" while the sidebar is open — clicking closes it. -->
      <svg class="Menu" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
        ><path
          d="M15 6L9 12L15 18"
          stroke="#ffffff"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        ></path></svg
      >
    {/if}
  </IconButton>

  <!-- Browser-style back / forward through visited pages
       (selected_type + selected_id history). -->
  <div class="NavHistoryGroup" data-page-search-skip>
    <button
      type="button"
      class="NavHistoryBtn"
      aria-label="戻る"
      title="戻る (Alt+←)"
      data-testid="nav-history-back"
      on:click={goBack}
      disabled={!$canGoBack}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M15 6L9 12L15 18"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
    </button>
    <button
      type="button"
      class="NavHistoryBtn"
      aria-label="進む"
      title="進む (Alt+→)"
      data-testid="nav-history-forward"
      on:click={goForward}
      disabled={!$canGoForward}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M9 6L15 12L9 18"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
    </button>
  </div>

  <h1 class="Title">{title}</h1>

  <!-- Page-search: highlight matches on screen only; does NOT filter rows. -->
  <label class="SearchField" aria-label="画面内検索（ハイライト）" data-page-search-skip>
    <svg class="SearchIcon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21L16.5 16.5" />
    </svg>
    <input
      bind:this={searchInputEl}
      type="search"
      class="SearchInput"
      placeholder="画面内をハイライト検索…"
      value={queryText}
      on:input={handleSearchInput}
      on:keydown={handleSearchKeydown}
      aria-label="画面内を検索してハイライト"
    />
    {#if queryText}
      <span class="SearchCount" aria-live="polite">
        {$pageSearchMatchCount === 0
          ? "0件"
          : `${$pageSearchCurrentIndex + 1} / ${$pageSearchMatchCount}`}
      </span>
      <button
        type="button"
        class="SearchNavBtn"
        aria-label="前の一致へ"
        title="前の一致へ (Shift+Enter)"
        on:click={prevMatch}
        disabled={$pageSearchMatchCount === 0}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6 15L12 9L18 15"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="SearchNavBtn"
        aria-label="次の一致へ"
        title="次の一致へ (Enter)"
        on:click={nextMatch}
        disabled={$pageSearchMatchCount === 0}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6 9L12 15L18 9"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="SearchNavBtn"
        aria-label="検索をクリア"
        title="クリア (Esc)"
        on:click={() => applyQuery("")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6 6L18 18M18 6L6 18"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    {:else}
      <span class="SearchShortcut" aria-hidden="true">Ctrl+F</span>
    {/if}
  </label>

  <button
    type="button"
    class="InboxBtn"
    class:Active={$selected_type === "Inbox"}
    class:Disabled={!$workspace_store.activeWorkspacePath}
    disabled={!$workspace_store.activeWorkspacePath}
    on:click={openInboxView}
    aria-label="Inboxを開く"
    aria-pressed={$selected_type === "Inbox"}
    title={$workspace_store.activeWorkspacePath
      ? "Inboxを開く (Ctrl+Shift+I でクイック追加)"
      : "Workspaceを設定するとInboxが使えます"}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
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
    {#if $workspace_store.activeWorkspacePath && $inbox_count > 0}
      <span class="InboxBtnBadge">{$inbox_count}</span>
    {/if}
  </button>

  <div class="HeaderRight">
    <div
      class="SaveIndicator"
      class:saved={$saveStatus === "saved" || $saveStatus === "idle"}
      class:pending={isSavePending($saveStatus)}
      class:error={$saveStatus === "error" || $saveStatus === "conflict"}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="save-status-indicator"
      data-status={$saveStatus}
    >
      <span class="SaveDot" aria-hidden="true"></span>
      <span class="SaveLabel">{saveStatusLabel($saveStatus)}</span>
    </div>

    <div class="ToggleSwitchContainer">
      <ToggleSwitch
        left={"Dark"}
        right={"Light"}
        leftColor="black"
        rightColor="white"
        leftTextColor="rgba(255,255,255,0.95)"
        rightTextColor="rgba(255,255,255,0.95)"
        leftColorBack="rgba(0,0,0,0.5)"
        rightColorBack="rgba(255,255,255,0.5)"
        checked={$theme == "light"}
        on:click={() => {
          $theme = $theme == "dark" ? "light" : "dark";
        }}
      />
    </div>

    <button
      type="button"
      class="SettingsBtn"
      on:click={() => (showSettings = true)}
      aria-label="設定を開く"
      title="設定"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.29 16.96l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.17.66.43.88.75.22.32.34.7.34 1.09v.32c0 .39-.12.77-.34 1.09-.22.32-.52.58-.88.75z"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
    </button>

    <div class="WindowControls">
      <button
        type="button"
        class="WinCtrlBtn"
        aria-label="最小化"
        title="最小化"
        on:click={handleMinimize}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6 L10 6" stroke="currentColor" stroke-width="1.5" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        class="WinCtrlBtn"
        aria-label={isMaximized ? "元のサイズに戻す" : "最大化"}
        title={isMaximized ? "元のサイズに戻す" : "最大化"}
        on:click={handleToggleMaximize}
      >
        {#if isMaximized}
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect
              x="3"
              y="1.5"
              width="6.5"
              height="6.5"
              stroke="currentColor"
              stroke-width="1.5"
              fill="none"
            />
            <rect
              x="1.5"
              y="3"
              width="6.5"
              height="6.5"
              stroke="currentColor"
              stroke-width="1.5"
              fill="var(--theme-color-Theme-main)"
            />
          </svg>
        {:else}
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect
              x="2"
              y="2"
              width="8"
              height="8"
              stroke="currentColor"
              stroke-width="1.5"
              fill="none"
            />
          </svg>
        {/if}
      </button>
      <button
        type="button"
        class="WinCtrlBtn Close"
        aria-label="閉じる"
        title="閉じる"
        on:click={handleClose}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </div>
</div>

<SettingsModal show={showSettings} toggle={() => (showSettings = !showSettings)} />

<style>
  h1.Title {
    margin: 0 var(--sp4);
    font-size: var(--font-title-lg);
    font-weight: 500;
  }
  .Container {
    display: flex;
    flex-direction: row;
    justify-content: left;
    align-items: center;
    gap: var(--sp3);
    box-shadow: var(--elevation-2);
    width: 100%;
    height: 100%;
    background-color: var(--theme-color-Theme-main);
    color: white;
    position: sticky;
    top: 0;
    z-index: 999;
    -webkit-app-region: drag;
  }
  /* インタラクティブ要素はドラッグ対象から除外 */
  .Container :global(button),
  .Container :global(a),
  .Container :global(input),
  .Container :global(label),
  .Container :global(select),
  .Container :global(textarea),
  .Container :global(.ToggleSwitchContainer) {
    -webkit-app-region: no-drag;
  }
  .Menu {
    flex-shrink: 0;
    flex-grow: 0;
    margin: var(--sp4);
    height: 100%;
  }
  .Title {
    flex-shrink: 0;
    flex-grow: 0;
    margin: var(--sp4);
  }

  /* Browser-style back/forward navigation through the visited-page history. */
  .NavHistoryGroup {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    flex-shrink: 0;
  }
  .NavHistoryBtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    margin: 0;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: var(--shape-sm);
    background-color: rgba(255, 255, 255, 0.1);
    color: white;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease,
      opacity 0.12s ease;
  }
  .NavHistoryBtn:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.22);
    border-color: rgba(255, 255, 255, 0.55);
  }
  .NavHistoryBtn:focus-visible {
    outline: 2px solid var(--on-theme-primary);
    outline-offset: 2px;
  }
  .NavHistoryBtn:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
  .NavHistoryBtn svg {
    width: 1.1rem;
    height: 1.1rem;
    fill: none;
  }
  svg {
    fill: white;
  }

  /* Search field — actual input */
  .SearchField {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    flex: 1 1 auto;
    max-width: 25rem;
    min-width: 8rem;
    padding: var(--sp1) var(--sp2);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: var(--shape-sm);
    background-color: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.92);
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
    cursor: text;
  }
  .SearchField:focus-within {
    background-color: rgba(255, 255, 255, 0.22);
    border-color: rgba(255, 255, 255, 0.55);
  }
  .SearchIcon {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
    opacity: 0.85;
  }
  .SearchInput {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: white;
    font-size: var(--font-body-sm);
    font-family: inherit;
    padding: 0;
  }
  .SearchInput::placeholder {
    color: rgba(255, 255, 255, 0.6);
  }
  .SearchInput::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
  .SearchShortcut {
    font-size: var(--font-label-sm);
    color: rgba(255, 255, 255, 0.7);
    padding: 1px var(--sp1);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: var(--shape-xs);
    font-family: "Consolas", "Courier New", monospace;
    flex-shrink: 0;
  }
  .SearchField:focus-within .SearchShortcut {
    display: none;
  }
  .SearchCount {
    flex-shrink: 0;
    font-size: var(--font-label-sm);
    color: rgba(255, 255, 255, 0.78);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    padding: 0 var(--sp1);
  }
  .SearchNavBtn {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    padding: 2px;
    margin: 0;
    border-radius: var(--shape-xs);
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .SearchNavBtn:hover {
    background-color: rgba(255, 255, 255, 0.18);
  }
  .SearchNavBtn:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
  .SearchNavBtn svg {
    width: 1rem;
    height: 1rem;
    fill: none;
  }

  /* Inbox quick-capture trigger sits just before the right group so it stays
     visually close to the page-search field (both are "input affordances"). */
  .InboxBtn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: var(--shape-sm);
    background-color: rgba(255, 255, 255, 0.1);
    color: white;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
  }
  .InboxBtn:hover {
    background-color: rgba(255, 255, 255, 0.22);
    border-color: rgba(255, 255, 255, 0.55);
  }
  .InboxBtn.Active {
    background-color: rgba(255, 255, 255, 0.3);
    border-color: rgba(255, 255, 255, 0.75);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  }
  .InboxBtn.Disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .InboxBtn svg {
    width: 1.1rem;
    height: 1.1rem;
    fill: none;
  }
  .InboxBtnBadge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 1.1rem;
    height: 1.1rem;
    padding: 0 0.3rem;
    border-radius: var(--shape-pill);
    background-color: var(--on-theme-primary);
    color: white;
    font-size: 0.65rem;
    font-weight: 700;
    line-height: 1.1rem;
    text-align: center;
  }

  /* Right group */
  .HeaderRight {
    display: flex;
    align-items: center;
    gap: var(--sp3);
    margin-left: auto;
  }
  .SaveIndicator {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    padding: var(--sp1) var(--sp2);
    border-radius: var(--shape-xs);
    font-size: var(--font-label-md);
    color: rgba(255, 255, 255, 0.92);
    white-space: nowrap;
  }
  .SaveDot {
    width: var(--sp2);
    height: var(--sp2);
    border-radius: 50%;
    background-color: var(--on-theme-success);
    transition: background-color 0.2s ease;
  }
  .SaveIndicator.pending .SaveDot {
    background-color: var(--on-theme-warning);
  }
  .SaveIndicator.error .SaveDot {
    background-color: var(--on-theme-error);
  }
  .SaveIndicator.error {
    color: var(--on-theme-error-light);
  }
  .ToggleSwitchContainer {
    flex-shrink: 0;
  }
  .SettingsBtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    padding: 0;
    margin: 0;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: var(--shape-sm);
    background-color: rgba(255, 255, 255, 0.1);
    color: white;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
  }
  .SettingsBtn:hover {
    background-color: rgba(255, 255, 255, 0.22);
    border-color: rgba(255, 255, 255, 0.55);
  }
  .SettingsBtn svg {
    width: 1.1rem;
    height: 1.1rem;
    fill: none;
  }

  /* Window controls (frameless window) */
  .WindowControls {
    display: flex;
    align-items: stretch;
    height: 100%;
    margin-left: var(--sp2);
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }
  .WinCtrlBtn {
    width: 2.75rem;
    height: 100%;
    min-height: 2.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
    transition: background-color 0.12s ease;
  }
  .WinCtrlBtn:hover {
    background-color: rgba(255, 255, 255, 0.12);
  }
  .WinCtrlBtn:active {
    background-color: rgba(255, 255, 255, 0.18);
  }
  .WinCtrlBtn.Close:hover {
    background-color: #e81123;
    color: #ffffff;
  }
  .WinCtrlBtn.Close:active {
    background-color: #c4101f;
  }
  .WinCtrlBtn svg {
    width: 1.15rem;
    height: 1.15rem;
    fill: none;
  }
  @media (max-width: 700px) {
    .SearchField {
      max-width: 14rem;
    }
    .SearchShortcut {
      display: none;
    }
  }
</style>
