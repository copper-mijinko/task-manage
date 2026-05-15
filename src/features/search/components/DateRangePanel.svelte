<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { activePanelId, newPanelId } from "@stores/panel_coordinator";
  import { globalDismiss } from "@lib/actions";

  export let column: string;
  export let from: string = "";
  export let to: string = "";
  export let anchorRect: DOMRect | null = null;

  const dispatch = createEventDispatcher<{
    change: { from: string; to: string };
    close: void;
  }>();
  let panelElement: HTMLElement;
  const myPanelId = newPanelId();
  let unsubPanelCoord: (() => void) | undefined;

  onMount(() => {
    activePanelId.set(myPanelId);
    unsubPanelCoord = activePanelId.subscribe((id) => {
      if (id !== null && id !== myPanelId) dispatch("close");
    });
  });
  onDestroy(() => unsubPanelCoord?.());

  $: panelStyle = anchorRect ? `top: ${anchorRect.bottom + 2}px; left: ${anchorRect.left}px;` : "";

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape") {
      dispatch("close");
    }
  }

  function handleChange() {
    dispatch("change", { from, to });
  }

  function handleClear() {
    from = "";
    to = "";
    dispatch("change", { from: "", to: "" });
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }
</script>

<div
  bind:this={panelElement}
  class="DateRangePanel"
  style={panelStyle}
  role="dialog"
  tabindex="-1"
  aria-label="{column} 日付フィルター"
  on:click|stopPropagation
  on:keydown={handleKeydown}
  use:portal
  use:globalDismiss={() => dispatch("close")}
>
  <div class="PanelTitle">{column} フィルター</div>
  <div class="DateRow">
    <label for="dr-from-{column.replace(' ', '-')}">From</label>
    <input
      id="dr-from-{column.replace(' ', '-')}"
      type="date"
      bind:value={from}
      on:change={handleChange}
    />
  </div>
  <div class="DateRow">
    <label for="dr-to-{column.replace(' ', '-')}">To</label>
    <input
      id="dr-to-{column.replace(' ', '-')}"
      type="date"
      bind:value={to}
      on:change={handleChange}
    />
  </div>
  {#if from || to}
    <button class="ClearBtn" on:click={handleClear}>クリア</button>
  {/if}
</div>

<style>
  .DateRangePanel {
    position: fixed;
    z-index: 99999999;
    background: var(--theme-color-Main-main);
    border-radius: var(--shape-sm);
    box-shadow: 0 0.2rem 0.5rem rgba(0, 0, 0, 0.25);
    padding: 4px 0;
    min-width: 14rem;
    color: var(--theme-color-Sub-light);
  }
  .PanelTitle {
    font-size: var(--font-label-md);
    font-weight: bold;
    color: var(--theme-color-Sub-light);
    padding: var(--sp2) var(--sp3) var(--sp1);
    opacity: 0.75;
  }
  .DateRow {
    display: flex;
    align-items: center;
    padding: var(--sp2) var(--sp3);
    gap: var(--sp3);
    color: var(--theme-color-Sub-light);
    font-size: var(--font-body-sm);
  }
  .DateRow label {
    width: 2.5rem;
    flex-shrink: 0;
    user-select: none;
  }
  .DateRow input[type="date"] {
    flex: 1;
    background: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-light);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-xs);
    padding: 0.2rem var(--sp1);
    font-size: var(--font-label-md);
    color-scheme: var(--color-scheme, dark);
    box-sizing: border-box;
    min-width: 0;
  }
  .ClearBtn {
    display: flex;
    align-items: center;
    width: 100%;
    margin: 0;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--theme-color-Sub-light);
    cursor: pointer;
    font-size: var(--font-body-sm);
    padding: var(--sp2) var(--sp3);
    text-align: left;
  }
  .ClearBtn:hover {
    background-color: var(--theme-color-Primary-dark);
    opacity: 1;
  }
</style>
