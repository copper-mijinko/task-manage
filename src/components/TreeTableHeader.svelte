<script>
  import { filter } from "../stores.ts";
  import { column_settings } from "../stores/column_settings.ts";
  import { closed_node_ids } from "../stores/ui.ts";
  import { sort_state, SORTABLE_COLUMNS } from "../stores/sort.ts";
  import { ripple } from "../common/common.js";
  import IconButton from "./IconButton.svelte";
  import MultiSelect from "./MultiSelect.svelte";
  import DateRangePanel from "./DateRangePanel.svelte";
  import NameFilterPanel from "./NameFilterPanel.svelte";

  export let headers;
  export let allHeaders = [];

  const STATUS_OPTIONS = ["Open", "Pending", "In Progress", "Completed", "Canceled"];
  const EMPTY_FILTER_LABEL = "No filter";
  const FILTER_ICON_PATH =
    "M3 7C3 6.44772 3.44772 6 4 6H20C20.5523 6 21 6.44772 21 7C21 7.55228 20.5523 8 20 8H4C3.44772 8 3 7.55228 3 7ZM6 12C6 11.4477 6.44772 11 7 11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H7C6.44772 13 6 12.5523 6 12ZM9 17C9 16.4477 9.44772 16 10 16H14C14.5523 16 15 16.4477 15 17C15 17.5523 14.5523 18 14 18H10C9.44772 18 9 17.5523 9 17Z";
  const FILTER_CLEAR_ICON_PATH =
    "M9.291,10.352l-4-4-4.005,4A.75.75,0,1,1,.22,9.291l4.005-4L.22,1.281A.75.75,0,0,1,1.281.22L5.286,4.225l4-4.005a.75.75,0,1,1,1.061,1.061l-4,4.005,4,4a.75.75,0,0,1-1.061,1.061Z";

  let statusSelected = [];
  let showPanel = false;
  let panelElement;
  let panelStyle = "";

  let openDatePanel = null;
  let datePanelAnchorRect = null;
  let openNamePanel = false;
  let namePanelAnchorRect = null;

  $: availableIds = new Set(allHeaders.map((h) => h.name));

  $: startDateFilter = $filter["start date"] ?? ["", ""];
  $: dueDateFilter = $filter["due date"] ?? ["", ""];
  $: nameFilterValue = $filter?.name?.[0] ?? "";
  $: statusSelected = $filter?.status?.filter(Boolean) ?? [];
  $: filterSummaries = Object.fromEntries(
    (headers ?? []).map((header) => [header.name, getFilterSummary(header.name, $filter)])
  );
  $: filterActive = Object.fromEntries(
    (headers ?? []).map((header) => [header.name, isFilterActive(header.name, $filter)])
  );

  function isDateColumn(headerName) {
    return headerName === "start date" || headerName === "due date";
  }

  function openPanel(e) {
    e.stopPropagation();
    openDatePanel = null;
    openNamePanel = false;
    const rect = e.currentTarget.getBoundingClientRect();
    panelStyle = `top: ${rect.bottom}px; right: calc(100vw - ${rect.right}px);`;
    showPanel = !showPanel;
  }

  function handleSortClick(e, headerName) {
    if (!SORTABLE_COLUMNS.has(headerName)) return;
    sort_state.cycle(headerName);
  }

  function getSortDirection(headerName) {
    return $sort_state?.column === headerName ? $sort_state.direction : null;
  }

  function getSortButtonLabel(headerName) {
    const direction = getSortDirection(headerName);
    if (direction === "asc") return `${headerName} sorted ascending`;
    if (direction === "desc") return `${headerName} sorted descending`;
    return `Sort ${headerName}`;
  }

  function isFilterActive(headerName, currentFilter = $filter) {
    if (headerName === "name") {
      return Boolean(currentFilter?.name?.[0]);
    }
    if (headerName === "status") {
      return (currentFilter?.status?.filter(Boolean).length ?? 0) > 0;
    }
    return (currentFilter?.[headerName]?.filter(Boolean).length ?? 0) > 0;
  }

  function getDateFilterSummary(headerName, currentFilter = $filter) {
    const [from = "", to = ""] = currentFilter?.[headerName] ?? [];
    if (from && to) return `${from} - ${to}`;
    if (from) return `From ${from}`;
    if (to) return `To ${to}`;
    return EMPTY_FILTER_LABEL;
  }

  function getFilterSummary(headerName, currentFilter = $filter) {
    if (headerName === "name") {
      const nameQuery = currentFilter?.name?.[0] ?? "";
      if (nameQuery) return nameQuery;
      return EMPTY_FILTER_LABEL;
    }
    if (isDateColumn(headerName)) {
      return getDateFilterSummary(headerName, currentFilter);
    }
    if (headerName === "status") {
      const statusValues = currentFilter?.status?.filter(Boolean) ?? [];
      if (statusValues.length === 1) return statusValues[0];
      if (statusValues.length > 1) return `${statusValues.length} selected.`;
      return EMPTY_FILTER_LABEL;
    }
    const values = currentFilter?.[headerName]?.filter(Boolean) ?? [];
    if (values.length === 1) return values[0];
    if (values.length > 1) return `${values.length} selected.`;
    return EMPTY_FILTER_LABEL;
  }

  function toggleDatePanel(e, headerName) {
    e.stopPropagation();
    showPanel = false;
    openNamePanel = false;
    if (openDatePanel === headerName) {
      openDatePanel = null;
    } else {
      datePanelAnchorRect = e.currentTarget.getBoundingClientRect();
      openDatePanel = headerName;
    }
  }

  function toggleNamePanel(e) {
    e.stopPropagation();
    showPanel = false;
    openDatePanel = null;
    namePanelAnchorRect = e.currentTarget.getBoundingClientRect();
    openNamePanel = !openNamePanel;
  }

  function handleDateRangeChange(headerName, detail) {
    const { from, to } = detail;
    filter.update((f) => {
      const next = { ...f };
      if (!from && !to) {
        delete next[headerName];
      } else {
        next[headerName] = [from, to];
      }
      return next;
    });
  }

  function handleStatusFilterChange(detail) {
    const nextSelected = detail.selected ?? [];
    filter.update((f) => {
      const next = { ...f };
      if (nextSelected.length > 0) {
        next.status = nextSelected;
      } else {
        delete next.status;
      }
      return next;
    });
  }

  function handleNameFilterChange(detail) {
    const { name } = detail;
    filter.update((f) => {
      const next = { ...f };
      if (name) {
        next.name = [name];
      } else {
        delete next.name;
      }
      return next;
    });
  }

  function clearColumnFilter(headerName) {
    if (openDatePanel === headerName) {
      openDatePanel = null;
    }
    if (headerName === "name") {
      openNamePanel = false;
    }

    filter.update((f) => {
      const next = { ...f };
      delete next[headerName];
      return next;
    });
  }

  function handleWindowClick(e) {
    if (showPanel && panelElement && !panelElement.contains(e.target)) {
      showPanel = false;
    }
  }

  function portal(node) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }
</script>

<svelte:window on:click={handleWindowClick} />

<div class:TableRow={true} role="row">
  {#each headers as header}
    <div class:TableHeader={true} role="columnheader">
      <div class="HeaderLabelRow" class:sortActive={$sort_state?.column === header.name}>
        <span class="HeaderLabelText TextOverFlow">{header.name}</span>
        {#if SORTABLE_COLUMNS.has(header.name)}
          <button
            class="SortButton"
            class:active={$sort_state?.column === header.name}
            aria-label={getSortButtonLabel(header.name)}
            title={getSortButtonLabel(header.name)}
            on:click|stopPropagation={(e) => handleSortClick(e, header.name)}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              {#if getSortDirection(header.name) === "asc"}
                <path
                  d="M6 15l6-6 6 6"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              {:else}
                <path
                  d="M6 9l6 6 6-6"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              {/if}
            </svg>
          </button>
        {/if}
        {#if header.name == "name"}
          <div class="HeaderUtilityButtons">
            <button
              class="ExpandCollapseBtn"
              aria-label="すべて展開"
              title="すべて展開"
              on:click={() => closed_node_ids.expandAll()}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 3H5a2 2 0 0 0-2 2v3"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M21 8V5a2 2 0 0 0-2-2h-3"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M3 16v3a2 2 0 0 0 2 2h3"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M16 21h3a2 2 0 0 0 2-2v-3"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <button
              class="ExpandCollapseBtn"
              aria-label="すべて折り畳み"
              title="すべて折り畳み"
              on:click={() => closed_node_ids.collapseAll()}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 3v3a2 2 0 0 1-2 2H3"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M21 8h-3a2 2 0 0 1-2-2V3"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M3 16h3a2 2 0 0 1 2 2v3"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M16 21v-3a2 2 0 0 1 2-2h3"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
        {/if}
      </div>
      <div class="HeaderControlRow">
        {#if header.name == "status"}
          <MultiSelect
            selected={statusSelected}
            list={STATUS_OPTIONS}
            placeholder={EMPTY_FILTER_LABEL}
            summary={filterSummaries.status}
            on:change={(e) => handleStatusFilterChange(e.detail)}
          />
        {:else if header.name == "name"}
          <div class="HeaderFilterGroup">
            <button
              class="HeaderFilterControl"
              class:active={filterActive[header.name]}
              on:click|stopPropagation={toggleNamePanel}
              aria-label="{header.name} フィルター"
              aria-expanded={openNamePanel}
              title="Name フィルター"
              use:ripple
            >
              <span class="FilterIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d={FILTER_ICON_PATH} />
                </svg>
              </span>
              <span class="FilterSelection">{filterSummaries[header.name]}</span>
            </button>
            {#if filterActive[header.name]}
              <IconButton
                style={"margin: 0rem; padding: 0.25rem; margin-left: auto; width: 1.5rem; height: 1.5rem; flex-shrink: 0;"}
                ariaLabel={`${header.name} フィルターをクリア`}
                on:click={(e) => {
                  clearColumnFilter(header.name);
                  e.stopPropagation();
                }}
                activeColor={"transparent"}
                normalColor={"transparent"}
              >
                <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d={FILTER_CLEAR_ICON_PATH}
                    fill="currentColor"
                    transform="translate(6.629 6.8)"
                  />
                </svg>
              </IconButton>
            {/if}
          </div>
        {:else if isDateColumn(header.name)}
          <div class="HeaderFilterGroup">
            <button
              class="HeaderFilterControl"
              class:active={filterActive[header.name]}
              on:click|stopPropagation={(e) => toggleDatePanel(e, header.name)}
              aria-label="{header.name} 日付フィルター"
              aria-expanded={openDatePanel === header.name}
              title="日付フィルター"
              use:ripple
            >
              <span class="FilterIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d={FILTER_ICON_PATH} />
                </svg>
              </span>
              <span class="FilterSelection">{filterSummaries[header.name]}</span>
            </button>
            {#if filterActive[header.name]}
              <IconButton
                style={"margin: 0rem; padding: 0.25rem; margin-left: auto; width: 1.5rem; height: 1.5rem; flex-shrink: 0;"}
                ariaLabel={`${header.name} フィルターをクリア`}
                on:click={(e) => {
                  clearColumnFilter(header.name);
                  e.stopPropagation();
                }}
                activeColor={"transparent"}
                normalColor={"transparent"}
              >
                <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d={FILTER_CLEAR_ICON_PATH}
                    fill="currentColor"
                    transform="translate(6.629 6.8)"
                  />
                </svg>
              </IconButton>
            {/if}
          </div>
        {:else}
          <div class="HeaderFilterGroup">
            <div
              class="HeaderFilterControl HeaderFilterSummary"
              class:active={filterActive[header.name]}
              aria-label="{header.name} filter: {filterSummaries[header.name]}"
            >
              <span class="FilterIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d={FILTER_ICON_PATH} />
                </svg>
              </span>
              <span class="FilterSelection">{filterSummaries[header.name]}</span>
            </div>
            {#if filterActive[header.name]}
              <IconButton
                style={"margin: 0rem; padding: 0.25rem; margin-left: auto; width: 1.5rem; height: 1.5rem; flex-shrink: 0;"}
                ariaLabel={`${header.name} フィルターをクリア`}
                on:click={(e) => {
                  clearColumnFilter(header.name);
                  e.stopPropagation();
                }}
                activeColor={"transparent"}
                normalColor={"transparent"}
              >
                <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d={FILTER_CLEAR_ICON_PATH}
                    fill="currentColor"
                    transform="translate(6.629 6.8)"
                  />
                </svg>
              </IconButton>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/each}

  <button
    class="ColumnSettingsBtn"
    aria-label="Column settings"
    aria-expanded={showPanel}
    on:click={openPanel}
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</div>

{#if showPanel}
  <div
    bind:this={panelElement}
    class="ColumnSettingsPanel"
    style={panelStyle}
    role="dialog"
    aria-label="カラム表示設定"
    use:portal
  >
    <div class="PanelTitle">カラム表示設定</div>
    {#each $column_settings as setting}
      {#if availableIds.has(setting.id)}
        <div class="SettingsRow">
          {#if setting.id === "name"}
            <span class="LockIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect
                  x="3"
                  y="11"
                  width="18"
                  height="11"
                  rx="2"
                  ry="2"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M7 11V7a5 5 0 0 1 10 0v4"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="ColumnLabel">{setting.label}</span>
          {:else}
            <input
              type="checkbox"
              id={`col-vis-${setting.id}`}
              checked={setting.visible}
              on:change={() => column_settings.toggle(setting.id)}
            />
            <label for={`col-vis-${setting.id}`} class="ColumnLabel">{setting.label}</label>
            <div class="MoveButtons">
              <button
                class="MoveBtn"
                aria-label="Move {setting.label} up"
                on:click|stopPropagation={() => column_settings.moveUp(setting.id)}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 5l-7 7h4v7h6v-7h4z" />
                </svg>
              </button>
              <button
                class="MoveBtn"
                aria-label="Move {setting.label} down"
                on:click|stopPropagation={() => column_settings.moveDown(setting.id)}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 19l7-7h-4V5h-6v7H5z" />
                </svg>
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

{#if openDatePanel === "start date"}
  <DateRangePanel
    column="start date"
    from={startDateFilter[0]}
    to={startDateFilter[1]}
    anchorRect={datePanelAnchorRect}
    on:change={(e) => handleDateRangeChange("start date", e.detail)}
    on:close={() => (openDatePanel = null)}
  />
{/if}

{#if openDatePanel === "due date"}
  <DateRangePanel
    column="due date"
    from={dueDateFilter[0]}
    to={dueDateFilter[1]}
    anchorRect={datePanelAnchorRect}
    on:change={(e) => handleDateRangeChange("due date", e.detail)}
    on:close={() => (openDatePanel = null)}
  />
{/if}

{#if openNamePanel}
  <NameFilterPanel
    value={nameFilterValue}
    anchorRect={namePanelAnchorRect}
    on:change={(e) => handleNameFilterChange(e.detail)}
    on:close={() => (openNamePanel = false)}
  />
{/if}

<style>
  .TableRow {
    --header-bg: var(--theme-color-Sub-light);
    --header-fg: var(--theme-color-Main-light);
    --header-border: var(--theme-color-Main-dark);
    --header-hover: color-mix(in srgb, var(--theme-color-Accent-dark) 78%, transparent);
    --header-active: var(--theme-color-Accent-main);
    --header-button-border: color-mix(in srgb, var(--theme-color-Main-light) 24%, transparent);
    --header-icon-size: 1.5rem;
    --header-action-icon-size: 1.1rem;

    position: sticky;
    top: 0;
    display: flex;
    flex-shrink: 0;
    box-sizing: border-box;
    height: 4rem;
    padding: 0;
    width: 100%;
    z-index: 9999;
  }
  .TableHeader {
    position: relative;
    height: 4rem;
    box-sizing: border-box;
    min-width: 4rem;
    display: flex;
    flex-direction: column;
    border-right: 2px solid var(--header-border);
    border-bottom: 2px solid var(--header-border);
    background-color: var(--header-bg);
    color: var(--header-fg);
    align-items: center;
    justify-content: center;
    font-weight: bold;
  }
  .TableHeader:last-of-type {
    border-right: 0px;
    padding-right: 2rem;
  }
  .TableHeader:first-of-type {
    border-left: 0;
  }
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .HeaderLabelRow {
    display: flex;
    flex: 0 0 2rem;
    width: 100%;
    height: 2rem;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    padding: 0 0.2rem;
    overflow: hidden;
    box-sizing: border-box;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }
  .HeaderLabelRow.sortActive {
    color: var(--header-active);
  }
  .HeaderLabelText {
    flex: 1 1 auto;
    min-width: 0;
    text-align: center;
  }
  .HeaderUtilityButtons {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    flex-shrink: 0;
  }

  .SortButton,
  .ExpandCollapseBtn,
  .ColumnSettingsBtn {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--header-fg);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    cursor: pointer;
    opacity: 0.68;
    padding: 0;
    box-sizing: border-box;
    flex-shrink: 0;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease,
      opacity 0.12s ease;
  }

  .SortButton:hover,
  .ExpandCollapseBtn:hover,
  .ColumnSettingsBtn:hover,
  .ColumnSettingsBtn[aria-expanded="true"] {
    background-color: var(--header-hover);
    border-color: var(--header-button-border);
    opacity: 1;
  }

  .SortButton.active {
    color: var(--header-active);
    opacity: 1;
  }

  .SortButton svg,
  .ExpandCollapseBtn svg,
  .ColumnSettingsBtn svg {
    width: var(--header-action-icon-size);
    height: var(--header-action-icon-size);
    stroke: currentColor;
  }

  .SortButton {
    width: var(--header-icon-size);
    height: var(--header-icon-size);
  }

  .HeaderControlRow {
    display: flex;
    flex: 0 0 2rem;
    width: 100%;
    height: 2rem;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    padding: 0 0.3rem;
    box-sizing: border-box;
    overflow: hidden;
  }
  .ExpandCollapseBtn {
    width: var(--header-icon-size);
    height: var(--header-icon-size);
  }

  .HeaderFilterGroup {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: 2rem;
  }

  .ColumnSettingsBtn {
    position: absolute;
    top: 50%;
    right: 0;
    width: var(--header-icon-size);
    height: var(--header-icon-size);
    z-index: 1;
    transform: translateY(-50%);
  }

  .HeaderFilterControl {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: 2rem;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    border: none;
    border-radius: 0;
    background-color: transparent;
    color: var(--theme-color-Main-light);
    cursor: pointer;
    flex: 1 1 auto;
    font-weight: 1;
    overflow: hidden;
    white-space: nowrap;
  }
  .HeaderFilterControl:focus-visible {
    outline: auto;
  }
  .HeaderFilterControl:active {
    background-color: transparent;
  }
  .HeaderFilterSummary {
    cursor: default;
  }
  .FilterIcon {
    width: 1.5rem;
    height: 1.5rem;
    margin: 0;
    padding: 0.25rem;
    box-sizing: content-box;
    flex-shrink: 0;
  }
  .FilterIcon svg {
    width: 100%;
    height: 100%;
    fill: var(--theme-color-Main-light);
    stroke: none;
  }
  .HeaderFilterControl.active .FilterIcon svg {
    fill: var(--theme-color-Accent-main);
  }
  .FilterSelection {
    min-width: 0;
    padding: 0 0.25rem;
    box-sizing: border-box;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ColumnSettingsPanel {
    position: fixed;
    z-index: 99999999;
    background: var(--theme-color-Main-main);
    border: 1px solid var(--theme-color-Shadow-main);
    border-radius: 0.4rem;
    box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.25);
    padding: 0.5rem 0;
    min-width: 13rem;
    color: var(--theme-color-Sub-main);
  }
  .PanelTitle {
    font-size: 0.75rem;
    font-weight: bold;
    color: var(--theme-color-Sub-main);
    padding: 0.25rem 0.75rem 0.5rem;
    border-bottom: 1px solid var(--theme-color-Shadow-main);
    margin-bottom: 0.25rem;
  }
  .SettingsRow {
    display: flex;
    align-items: center;
    padding: 0.3rem 0.75rem;
    gap: 0.5rem;
    color: var(--theme-color-Sub-main);
    font-size: 0.875rem;
  }
  .SettingsRow:hover {
    background-color: color-mix(in srgb, var(--theme-color-Accent-main) 10%, transparent);
  }
  .LockIcon {
    width: 0.9rem;
    height: 0.9rem;
    flex-shrink: 0;
    opacity: 0.4;
    display: flex;
    align-items: center;
  }
  .LockIcon svg {
    width: 100%;
    height: 100%;
    stroke: currentColor;
  }
  .ColumnLabel {
    flex: 1;
    cursor: pointer;
    user-select: none;
  }
  input[type="checkbox"] {
    width: 0.9rem;
    height: 0.9rem;
    flex-shrink: 0;
    cursor: pointer;
    accent-color: var(--theme-color-Accent-dark);
  }
  .MoveButtons {
    display: flex;
    gap: 0.1rem;
    flex-shrink: 0;
  }
  .MoveBtn {
    width: 1.2rem;
    height: 1.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: 0.2rem;
    padding: 0.1rem;
    color: var(--theme-color-Sub-main);
    opacity: 0.6;
  }
  .MoveBtn:hover {
    background-color: color-mix(in srgb, var(--theme-color-Accent-main) 14%, transparent);
    opacity: 1;
  }
  .MoveBtn svg {
    width: 100%;
    height: 100%;
  }
</style>
