<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { activePanelId, newPanelId } from "../stores/panel_coordinator";

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

  function handleClickOutside(event: MouseEvent) {
    if (panelElement && !panelElement.contains(event.target as Node)) {
      dispatch("close");
    }
  }

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

<svelte:window on:click={handleClickOutside} />

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
    border-radius: 0.5rem;
    box-shadow: 0 0.2rem 0.5rem rgba(0, 0, 0, 0.25);
    padding: 4px 0;
    min-width: 14rem;
    color: var(--theme-color-Sub-light);
  }
  .PanelTitle {
    font-size: 0.75rem;
    font-weight: bold;
    color: var(--theme-color-Sub-light);
    padding: 0.45rem 0.75rem 0.35rem;
    opacity: 0.75;
  }
  .DateRow {
    display: flex;
    align-items: center;
    padding: 0.45rem 0.75rem;
    gap: 0.75rem;
    color: var(--theme-color-Sub-light);
    font-size: 0.85rem;
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
    border-radius: 0.25rem;
    padding: 0.2rem 0.3rem;
    font-size: 0.8rem;
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
    font-size: 0.85rem;
    padding: 0.45rem 0.75rem;
    text-align: left;
  }
  .ClearBtn:hover {
    background-color: var(--theme-color-Accent-dark);
    opacity: 1;
  }
</style>
