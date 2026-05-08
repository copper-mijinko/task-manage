<script>
  import { filter } from "../stores.ts";
  import { column_settings } from "../stores/column_settings.ts";
  import { closed_node_ids } from "../stores/ui.ts";
  import { sort_state, SORTABLE_COLUMNS } from "../stores/sort.ts";
  import MultiSelect from "./MultiSelect.svelte";
  import DateRangePanel from "./DateRangePanel.svelte";

  export let headers;
  export let allHeaders = [];

  let selected = [];
  $: $filter = {
    ...$filter,
    status: selected.length > 0 ? selected : undefined,
  };

  let showPanel = false;
  let panelElement;
  let panelStyle = "";

  let openDatePanel = null;
  let datePanelAnchorRect = null;
  let datePanelElement = null;

  $: availableIds = new Set(allHeaders.map((h) => h.name));

  $: startDateFilter = $filter["start date"] ?? ["", ""];
  $: dueDateFilter = $filter["due date"] ?? ["", ""];

  function openPanel(e) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    panelStyle = `top: ${rect.bottom}px; right: calc(100vw - ${rect.right}px);`;
    showPanel = !showPanel;
  }

  function handleSortClick(e, headerName) {
    if (!SORTABLE_COLUMNS.has(headerName)) return;
    sort_state.cycle(headerName);
  }

  function toggleDatePanel(e, headerName) {
    e.stopPropagation();
    if (openDatePanel === headerName) {
      openDatePanel = null;
    } else {
      datePanelAnchorRect = e.currentTarget.getBoundingClientRect();
      openDatePanel = headerName;
    }
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

  function handleWindowClick(e) {
    if (showPanel && panelElement && !panelElement.contains(e.target)) {
      showPanel = false;
    }
    if (openDatePanel && datePanelElement && !datePanelElement.contains(e.target)) {
      openDatePanel = null;
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
      <!-- Label row: clickable for sort on sortable columns -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="HeaderLabelRow"
        class:sortable={SORTABLE_COLUMNS.has(header.name)}
        class:sortActive={$sort_state?.column === header.name}
        on:click={(e) => handleSortClick(e, header.name)}
        on:keydown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleSortClick(e, header.name);
        }}
      >
        <span class:TextOverFlow={true}>{header.name}</span>
        {#if $sort_state?.column === header.name}
          <span class="SortIndicator">
            {$sort_state.direction === "asc" ? "▲" : "▼"}
          </span>
        {/if}
        {#if header.name === "start date" || header.name === "due date"}
          <button
            class="DateFilterBtn"
            class:active={!!$filter[header.name]}
            on:click|stopPropagation={(e) => toggleDatePanel(e, header.name)}
            aria-label="{header.name} 日付フィルター"
            aria-expanded={openDatePanel === header.name}
            title="日付フィルター"
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect
                x="3"
                y="4"
                width="18"
                height="18"
                rx="2"
                ry="2"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <line x1="16" y1="2" x2="16" y2="6" stroke-width="2" stroke-linecap="round" />
              <line x1="8" y1="2" x2="8" y2="6" stroke-width="2" stroke-linecap="round" />
              <line x1="3" y1="10" x2="21" y2="10" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        {/if}
      </div>
      {#if header.name == "status"}
        <div
          style="display: flex; flex: 1; width:100%; height:100%; justify-content: center; align-items: center;"
        >
          <MultiSelect
            bind:selected
            list={["Open", "Pending", "In Progress", "Completed", "Canceled"]}
            placeholder="No filter."
          />
        </div>
      {/if}
      {#if header.name == "name"}
        <div class="ExpandCollapseButtons">
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
    bind:this={datePanelElement}
    column="start date"
    from={startDateFilter[0]}
    to={startDateFilter[1]}
    anchorRect={datePanelAnchorRect}
    on:change={(e) => handleDateRangeChange("start date", e.detail)}
  />
{/if}

{#if openDatePanel === "due date"}
  <DateRangePanel
    bind:this={datePanelElement}
    column="due date"
    from={dueDateFilter[0]}
    to={dueDateFilter[1]}
    anchorRect={datePanelAnchorRect}
    on:change={(e) => handleDateRangeChange("due date", e.detail)}
  />
{/if}

<style>
  .TableRow {
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
    border-right: 1px solid;
    border-left: 1px solid;
    border-bottom: 1px solid;
    background-color: var(--theme-color-Sub-light);
    color: var(--theme-color-Main-light);
    align-items: center;
    justify-content: center;
    font-weight: bold;
  }
  .TableHeader:last-of-type {
    border-right: 0px;
    padding-right: 2rem;
  }
  .TableHeader:first-of-type {
    border-left: 0px;
  }
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .HeaderLabelRow {
    display: flex;
    flex: 1;
    width: 100%;
    height: 100%;
    justify-content: center;
    align-items: center;
    gap: 0.2rem;
    padding: 0 0.3rem;
    overflow: hidden;
    box-sizing: border-box;
  }
  .HeaderLabelRow.sortable {
    cursor: pointer;
    user-select: none;
  }
  .HeaderLabelRow.sortable:hover {
    background-color: var(--theme-color-Accent-dark);
  }
  .HeaderLabelRow.sortActive {
    color: var(--theme-color-Accent-main);
  }
  .SortIndicator {
    font-size: 0.7rem;
    flex-shrink: 0;
    color: var(--theme-color-Accent-main);
  }

  .DateFilterBtn {
    width: 1.4rem;
    height: 1.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0.2rem;
    opacity: 0.5;
    flex-shrink: 0;
  }
  .DateFilterBtn:hover,
  .DateFilterBtn.active,
  .DateFilterBtn[aria-expanded="true"] {
    background-color: var(--theme-color-Accent-dark);
    opacity: 1;
  }
  .DateFilterBtn svg {
    width: 100%;
    height: 100%;
    stroke: var(--theme-color-Main-light);
  }

  .ExpandCollapseButtons {
    display: flex;
    gap: 0.15rem;
    align-items: center;
    padding: 0 0.3rem;
  }
  .ExpandCollapseBtn {
    width: 1.4rem;
    height: 1.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: 0.25rem;
    padding: 0.2rem;
    opacity: 0.5;
    flex-shrink: 0;
  }
  .ExpandCollapseBtn:hover {
    background-color: var(--theme-color-Accent-dark);
    opacity: 1;
  }
  .ExpandCollapseBtn svg {
    width: 100%;
    height: 100%;
    stroke: var(--theme-color-Main-light);
  }

  .ColumnSettingsBtn {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: 2rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--theme-color-Sub-light);
    border: none;
    border-left: 1px solid var(--theme-color-Sub-dark);
    border-bottom: 1px solid;
    cursor: pointer;
    z-index: 1;
    opacity: 0.6;
    padding: 0.4rem;
    box-sizing: border-box;
  }
  .ColumnSettingsBtn:hover,
  .ColumnSettingsBtn[aria-expanded="true"] {
    opacity: 1;
    background-color: var(--theme-color-Accent-dark);
  }
  .ColumnSettingsBtn svg {
    width: 100%;
    height: 100%;
    stroke: var(--theme-color-Main-light);
  }

  .ColumnSettingsPanel {
    position: fixed;
    z-index: 99999999;
    background: var(--theme-color-Main-main);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: 0.5rem;
    box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.25);
    padding: 0.5rem 0;
    min-width: 13rem;
  }
  .PanelTitle {
    font-size: 0.75rem;
    font-weight: bold;
    color: var(--theme-color-Sub-dark);
    padding: 0.25rem 0.75rem 0.5rem;
    border-bottom: 1px solid var(--theme-color-Sub-dark);
    margin-bottom: 0.25rem;
  }
  .SettingsRow {
    display: flex;
    align-items: center;
    padding: 0.3rem 0.75rem;
    gap: 0.5rem;
    color: var(--theme-color-Sub-light);
    font-size: 0.875rem;
  }
  .SettingsRow:hover {
    background-color: var(--theme-color-Main-dark);
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
    color: var(--theme-color-Sub-light);
    opacity: 0.6;
  }
  .MoveBtn:hover {
    background-color: var(--theme-color-Accent-dark);
    opacity: 1;
  }
  .MoveBtn svg {
    width: 100%;
    height: 100%;
  }
</style>
