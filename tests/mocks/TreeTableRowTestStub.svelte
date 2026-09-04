<script>
  import { createEventDispatcher } from "svelte";

  export let row;
  export let headers = [];
  export let selected = false;
  export let bulkSelectionActive = false;
  export let isDark = false;
  export let canDrop = () => false;
  export let canMoveUp = false;
  export let canMoveDown = false;
  export let canIndent = false;
  export let canOutdent = false;
  export let canOpenTaskFolder = false;
  export let isTabStop = false;

  const NAVIGATION_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
  ]);

  const dispatch = createEventDispatcher();
</script>

<div
  id={row.id}
  data-row-path={row.path}
  role="row"
  class="TableRow"
  data-testid={"row-" + row.id}
  data-dark={isDark ? "true" : "false"}
  data-can-drop={canDrop("", "") ? "true" : "false"}
  data-can-move-up={canMoveUp ? "true" : "false"}
  data-can-move-down={canMoveDown ? "true" : "false"}
  data-can-indent={canIndent ? "true" : "false"}
  data-can-outdent={canOutdent ? "true" : "false"}
  data-selected={selected ? "true" : "false"}
  data-tab-stop={isTabStop ? "true" : "false"}
  tabindex={isTabStop ? 0 : -1}
  on:keydown={(e) => {
    if (!NAVIGATION_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    dispatch("navigate", { id: row.id, path: row.path, key: e.key, shiftKey: e.shiftKey });
  }}
>
  <div class="CheckboxCell" style="width: 28px;">
    {#if row.depth > 0}
      <input
        type="checkbox"
        data-testid={"bulk-select-" + row.id}
        checked={bulkSelectionActive && selected}
        on:click={() => dispatch("toggleCheckbox", { id: row.id })}
      />
    {/if}
  </div>
  {#each headers as header}
    <div class="TableData" style="width: 100px;">
      {#if header.name === "name"}
        <span>{row.node.data.name}</span>
        <button
          type="button"
          data-testid={"select-" + row.id}
          on:click={() => {
            dispatch("select", { id: row.id });
          }}
        >
          select
        </button>
        {#if row.hasChildren}
          <button
            type="button"
            data-testid={"toggle-" + row.id}
            on:click={() => {
              dispatch("toggle", { id: row.id });
            }}
          >
            {row.expanded ? "collapse" : "expand"}
          </button>
        {/if}
        {#if canOpenTaskFolder}
          <button
            type="button"
            data-testid={"open-folder-" + row.id}
            on:click={() => {
              dispatch("openTaskFolder", { id: row.id });
            }}
          >
            open folder
          </button>
        {/if}
      {:else}
        <span data-testid={"cell-" + row.id + "-" + header.name}>
          {Array.isArray(row.node.data[header.name])
            ? row.node.data[header.name].length
            : (row.node.data[header.name] ?? "")}
        </span>
      {/if}
    </div>
  {/each}
</div>
