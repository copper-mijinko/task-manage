<script>
  import IconButton from "@lib/primitives/IconButton.svelte";
  import ToggleSwitch from "@lib/primitives/ToggleSwitch.svelte";
  import { theme, saveStatus, sidebarCollapsed } from "@stores";
  import { pageSearchQuery } from "@features/search/stores/search";
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
  </div>
</div>

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
    padding-right: var(--sp4);
    box-shadow: var(--elevation-2);
    width: 100%;
    height: 100%;
    background-color: var(--theme-color-Theme-main);
    color: white;
    position: sticky;
    top: 0;
    z-index: 999;
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
  @media (max-width: 700px) {
    .SearchField {
      max-width: 14rem;
    }
    .SearchShortcut {
      display: none;
    }
  }
</style>
