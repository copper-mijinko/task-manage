<script>
  import { createEventDispatcher } from "svelte";

  export let row;
  export let headers = [];
  export let selected = false;
  export let isDark = false;
  export let canDrop = () => false;
  export let canMoveUp = false;
  export let canMoveDown = false;
  export let canIndent = false;
  export let canOutdent = false;
  export let canOpenTaskFolder = false;

  const dispatch = createEventDispatcher();
</script>

<div
  id={row.id}
  class="TableRow"
  data-testid={"row-" + row.id}
  data-dark={isDark ? "true" : "false"}
  data-can-drop={canDrop("", "") ? "true" : "false"}
  data-can-move-up={canMoveUp ? "true" : "false"}
  data-can-move-down={canMoveDown ? "true" : "false"}
  data-can-indent={canIndent ? "true" : "false"}
  data-can-outdent={canOutdent ? "true" : "false"}
  data-selected={selected ? "true" : "false"}
>
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
      {/if}
    </div>
  {/each}
</div>
