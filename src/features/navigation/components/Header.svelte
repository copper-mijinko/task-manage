<script>
  import { showQuickCapture } from "@stores/ui";
  import { workspaceNavigation } from "@features/workspace/application/workspace";
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
  import { inbox_count, INBOX_SELECTED_ID, resolveInboxNodeId } from "@features/inbox/stores/inbox";
  import { AGENDA_SELECTED_ID } from "@features/agenda/stores/agenda";
  import { pageSearchCountIsPartial, pageSearchQuery } from "@features/search/stores/search";
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
    $selected_type = "WorkspaceProject";
    $selected_id = INBOX_SELECTED_ID;
  }

  // Inbox ボタンの選択状態。
  //
  // 以前は `selected_type === "Inbox"` と比較していたが、openInboxView は
  // selected_type に "WorkspaceProject" を入れるため永久に false だった。
  // さらに `selected_id` のセンチネルはページ側が受け取った直後に実ノードの
  // id へ書き換えるので、センチネルとの比較だけでも 1 microtask しか当たらない。
  // ページと同じ解決規則 (resolveInboxNodeId) を使って実 id と突き合わせる。
  $: resolvedInboxId = resolveInboxNodeId($workspaceNavigation);
  $: inboxActive =
    $selected_id === INBOX_SELECTED_ID ||
    (resolvedInboxId !== undefined && $selected_id === resolvedInboxId);

  function openAgendaView() {
    if (!$workspace_store.activeWorkspacePath) return;
    $selected_type = "WorkspaceProject";
    $selected_id = AGENDA_SELECTED_ID;
  }

  const isElectronRuntime = typeof window !== "undefined" && Boolean(window.electronAPI);

  /* 880px を切ったら保存状態のラベルを視覚的にだけ畳み、ドットだけ残す。
     display:none にすると aria-live の読み上げまで消えるので、
     .visually-hidden-narrow で視覚的にだけ隠す。 */
  let headerWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  $: compactHeader = headerWidth <= 880;
</script>

<svelte:window on:keydown={handleGlobalKeydown} bind:innerWidth={headerWidth} />

<div class="Container" class:webRuntime={!isElectronRuntime} data-page-search-skip>
  <IconButton
    on:click={() => {
      $sidebarCollapsed = !$sidebarCollapsed;
    }}
    ariaLabel={$sidebarCollapsed ? "サイドバーを表示" : "サイドバーを隠す"}
    ariaPressed={$sidebarCollapsed ? "false" : "true"}
    tooltipContent={$sidebarCollapsed ? "サイドバーを表示" : "サイドバーを折りたたむ"}
    use_ripple={false}
    activeColor={"transparent"}
    normalColor={"transparent"}
    style={"box-shadow: none; height:1.875rem; width: 1.875rem; margin: 0;"}
  >
    {#if $sidebarCollapsed}
      <!-- Hamburger when the sidebar is hidden — clicking opens it. -->
      <svg class="Menu" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
        ><path
          d="M4 6H20M4 12H20M4 18H20"
          stroke="var(--fg-default)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></path></svg
      >
    {:else}
      <!-- 閉じる側にも「＜」を使っていたが、8px 右隣の「戻る」が
           まったく同じ path (M15 6L9 12L15 18) で、同じ字形が並んでいた。
           サイドバーの開閉は方向ではなく面の操作なので、パネルの絵にする。
           隠している間のハンバーガーとも意味がつながる。 -->
      <svg class="Menu" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <rect
          x="3.5"
          y="5"
          width="17"
          height="14"
          rx="2"
          stroke="var(--fg-default)"
          stroke-width="2"
          fill="none"
        ></rect>
        <path d="M9.5 5V19" stroke="var(--fg-default)" stroke-width="2"></path>
      </svg>
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
          : `${$pageSearchCurrentIndex + 1} / ${$pageSearchMatchCount}${$pageSearchCountIsPartial ? "+" : ""}`}
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

  {#if !$workspaceNavigation}
    <!-- 「予定」は開くと gantt 表示 + root スコープへ飛ばすだけの一回限りの
         操作で、「予定ビューを開いている」という持続状態がアプリのどこにも
         存在しない。表現できない状態を aria-pressed="false" で常時主張すると
         支援技術に嘘をつくことになるので、トグルではなく通常のコマンド
         ボタンとして扱う。 -->
    <button
      type="button"
      class="InboxBtn"
      class:Disabled={!$workspace_store.activeWorkspacePath}
      disabled={!$workspace_store.activeWorkspacePath}
      data-testid="open-agenda"
      on:click={openAgendaView}
      aria-label="予定を開く"
      title={$workspace_store.activeWorkspacePath
        ? "予定を開く（全プロジェクトの期限）"
        : "Workspaceを設定すると予定が使えます"}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 5.5h16v15H4zM8 3v4M16 3v4M4 10h16"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
        <path
          d="M8 14h3"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          fill="none"
        />
      </svg>
    </button>
  {/if}

  <button
    type="button"
    class="InboxBtn"
    class:Active={inboxActive}
    class:Disabled={!$workspace_store.activeWorkspacePath}
    disabled={!$workspace_store.activeWorkspacePath}
    data-testid="open-inbox"
    on:click={openInboxView}
    aria-label="Inboxを開く"
    aria-pressed={inboxActive}
    title={$workspace_store.activeWorkspacePath
      ? "Inboxを開く"
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

  <button
    class="ui-action"
    title="Inboxへクイック追加"
    style="white-space: nowrap; flex-shrink: 0;"
    disabled={!$workspace_store.activeWorkspacePath}
    on:click={() => ($showQuickCapture = true)}>クイック追加</button
  >
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
      <span class="SaveLabel" class:visually-hidden-narrow={compactHeader}
        >{saveStatusLabel($saveStatus)}</span
      >
    </div>

    <div class="ToggleSwitchContainer">
      <ToggleSwitch
        left={"Dark"}
        right={"Light"}
        leftColor="black"
        rightColor="white"
        leftTextColor="var(--fg-muted)"
        rightTextColor="var(--fg-muted)"
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
              fill="var(--canvas-subtle)"
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
    margin: 0 var(--sp2);
    font-size: var(--font-title-md);
    font-weight: 500;
  }
  .Container {
    display: flex;
    flex-direction: row;
    justify-content: left;
    align-items: center;
    gap: var(--sp2);
    box-shadow: var(--elevation-2);
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding-left: var(--sp1);
    background-color: var(--theme-color-Theme-main);
    --fg-default: var(--on-theme-text);
    /* muted を default と同値にすると、プレースホルダーが入力値と同じ色に
       なり「空欄かどうか」が判別できなくなる。濃紺用の専用 muted を使う。 */
    --fg-muted: var(--on-theme-text-muted);
    --hover-bg: var(--on-theme-surface-hover);
    color: var(--fg-default);
    position: sticky;
    top: 0;
    z-index: 999;
    -webkit-app-region: drag;
  }
  .Container :global(.ui-action) {
    background: transparent;
    color: var(--on-theme-text);
    border-color: rgba(255, 255, 255, 0.35);
  }
  .Container.webRuntime {
    -webkit-app-region: no-drag;
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
    margin: var(--sp2);
    height: 100%;
  }
  .Title {
    flex-shrink: 0;
    flex-grow: 0;
    margin: var(--sp2);
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
    width: var(--tap-min);
    height: var(--tap-min);
    padding: 0;
    margin: 0;
    border: 1px solid transparent;
    border-radius: var(--shape-sm);
    background-color: var(--on-theme-surface);
    color: var(--fg-default);
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease,
      opacity 0.12s ease;
  }
  .NavHistoryBtn:hover:not(:disabled) {
    background-color: var(--on-theme-surface-hover);
    border-color: var(--fg-muted);
  }
  .NavHistoryBtn:focus-visible {
    outline: 2px solid var(--accent-fg);
    outline-offset: 2px;
  }
  .NavHistoryBtn:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
  .NavHistoryBtn svg {
    width: 0.825rem;
    height: 0.825rem;
    fill: none;
  }
  svg {
    fill: currentColor;
  }

  /* Search field — actual input */
  .SearchField {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    flex: 1 1 auto;
    max-width: 18.75rem;
    min-width: 3.75rem;
    padding: 2px var(--sp2);
    border: 1px solid transparent;
    border-radius: var(--shape-sm);
    background-color: var(--on-theme-surface);
    color: var(--fg-muted);
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
    cursor: text;
  }
  .SearchField:hover {
    background-color: var(--on-theme-surface-hover);
  }
  .SearchField:focus-within {
    background-color: var(--on-theme-surface-hover);
    border-color: var(--accent-fg);
  }
  .SearchIcon {
    width: 0.75rem;
    height: 0.75rem;
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
    /* 入力欄も SC 2.5.8 の対象。実測 15px だった。 */
    min-height: var(--tap-min);
    border: none;
    outline: none;
    background: transparent;
    color: var(--fg-default);
    font-size: var(--font-body-sm);
    font-family: inherit;
    padding: 0;
  }
  .SearchInput::placeholder {
    color: var(--fg-muted);
  }
  .SearchInput::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
  .SearchShortcut {
    font-size: var(--font-label-sm);
    color: var(--fg-muted);
    padding: 1px var(--sp1);
    border: 1px solid var(--on-theme-surface-hover);
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
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    padding: 0 var(--sp1);
  }
  .SearchNavBtn {
    flex-shrink: 0;
    width: var(--tap-min);
    height: var(--tap-min);
    padding: 2px;
    margin: 0;
    border-radius: var(--shape-xs);
    border: none;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .SearchNavBtn:hover {
    background-color: var(--hover-bg);
  }
  .SearchNavBtn:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
  .SearchNavBtn svg {
    width: 0.75rem;
    height: 0.75rem;
    fill: none;
  }

  /* Inbox quick-capture trigger sits just before the right group so it stays
     visually close to the page-search field (both are "input affordances"). */
  .InboxBtn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--tap-min);
    height: var(--tap-min);
    flex-shrink: 0;
    border: 1px solid transparent;
    border-radius: var(--shape-sm);
    background-color: var(--on-theme-surface);
    color: var(--fg-default);
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
  }
  .InboxBtn:hover {
    background-color: var(--on-theme-surface-hover);
    border-color: var(--fg-muted);
  }
  /* 選択中はホバーより一段強い塗り + アクセント色の枠で、ホバーと区別する。
     以前は塗り・枠・内側 shadow がすべて --hover-bg で、静止/ホバー/選択が
     同じ見た目だった。 */
  .InboxBtn.Active {
    background-color: var(--on-theme-surface-active);
    border-color: var(--accent-fg);
    box-shadow: inset 0 0 0 1px var(--accent-fg);
  }
  .InboxBtn.Disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .InboxBtn svg {
    width: 0.825rem;
    height: 0.825rem;
    fill: none;
  }
  /* 未処理件数のバッジ。濃紺ヘッダーの上に載る明るいチップなので、文字は
     白ではなく暗色にする。白文字だと 2.65:1 しかなく AA (4.5:1) を満たせず、
     かといって背景を濃くするとヘッダーの濃紺に埋もれる（3:1 を割る）。
     暗色文字なら 7:1 で、チップ自体もヘッダーに対して 4:1 で浮く。
     文字サイズも 0.4875rem（7.8px）ではトークン最小の 11px を下回っていて
     読めなかったので --font-label-sm に揃える。 */
  .InboxBtnBadge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 0.9375rem;
    height: 0.9375rem;
    padding: 0 0.225rem;
    border-radius: var(--shape-pill);
    background-color: var(--accent-fg);
    color: #101315;
    font-size: var(--font-label-sm);
    font-weight: 700;
    line-height: 0.9375rem;
    text-align: center;
  }

  /* Right group */
  .HeaderRight {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    margin-left: auto;
  }
  .SaveIndicator {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    padding: 0 var(--sp2);
    border-radius: var(--shape-xs);
    font-size: var(--font-label-md);
    color: var(--fg-muted);
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
  .ToggleSwitchContainer :global(> div) {
    margin: 0;
  }
  .ToggleSwitchContainer :global(span) {
    margin: 0 var(--sp1);
  }
  .SettingsBtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--tap-min);
    height: var(--tap-min);
    flex-shrink: 0;
    padding: 0;
    margin: 0;
    border: 1px solid transparent;
    border-radius: var(--shape-sm);
    background-color: var(--on-theme-surface);
    color: var(--fg-default);
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
  }
  .SettingsBtn:hover {
    background-color: var(--on-theme-surface-hover);
    border-color: var(--fg-muted);
  }
  .SettingsBtn svg {
    width: 0.825rem;
    height: 0.825rem;
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
    width: 1.875rem;
    height: 100%;
    min-height: 1.6875rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    transition: background-color 0.12s ease;
  }
  .WinCtrlBtn:hover {
    background-color: var(--hover-bg);
  }
  .WinCtrlBtn:active {
    background-color: var(--hover-bg);
  }
  .WinCtrlBtn.Close:hover {
    background-color: #e81123;
    color: var(--fg-default);
  }
  .WinCtrlBtn.Close:active {
    background-color: #c4101f;
  }
  .WinCtrlBtn svg {
    width: 0.8625rem;
    height: 0.8625rem;
    fill: none;
  }
  /* ウィンドウは frame:false なので、最小化/最大化/閉じるはここにある自前の
     ボタンだけが提供する。minWidth は 700 なのでユーザーは普通に 700px まで
     縮められるが、以前はヘッダーが縮まず、820px を切ると設定ボタンと
     ウィンドウ操作ボタンがビューポート外へ押し出されて「閉じられない」状態に
     なっていた。情報量の少ないものから順に畳んで幅を作る。 */
  @media (max-width: 1000px) {
    /* 常に "Task Manage" と出るだけで現在地を示さないので、最初に落とす。 */
    .Title {
      display: none;
    }
    .SearchField {
      max-width: 10.5rem;
    }
    .SearchShortcut {
      display: none;
    }
  }
  @media (max-width: 880px) {
    /* ドットだけ残す。ラベルは .visually-hidden-narrow で読み上げには残る。 */
    .SaveIndicator {
      padding: 0;
    }
    .SearchField {
      max-width: 7.5rem;
    }
  }
  @media (max-width: 800px) {
    .Container {
      gap: var(--sp1);
    }
    /* Dark / Light の文字ラベルを落としてスイッチ本体だけ残す。 */
    .ToggleSwitchContainer :global(span) {
      display: none;
    }
  }
</style>
