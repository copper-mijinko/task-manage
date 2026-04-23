<script>
  import { filter } from "../stores.ts";
  import { column_settings } from "../stores/column_settings.ts";
  import MultiSelect from "./MultiSelect.svelte";

  export let headers;

  let selected = [];
  $: $filter = {
    ...$filter,
    status: selected.length > 0 ? selected : undefined,
  };

  let showPanel = false;
  let panelElement;
  let panelStyle = "";

  $: availableIds = new Set(headers.map((h) => h.name));

  function openPanel(e) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    panelStyle = `top: ${rect.bottom}px; right: calc(100vw - ${rect.right}px);`;
    showPanel = !showPanel;
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
      <div
        style="display: flex; flex: 1; width:100%; height:100%; justify-content: center; align-items: center;"
      >
        <span class:TextOverFlow={true}>{header.name}</span>
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
  }
  .TableHeader:first-of-type {
    border-left: 0px;
  }
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .ColumnSettingsBtn {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
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
