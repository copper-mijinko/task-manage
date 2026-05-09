<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let column: string;
  export let min: string = "";
  export let max: string = "";
  export let anchorRect: DOMRect | null = null;

  const dispatch = createEventDispatcher<{
    change: { min: string; max: string };
    close: void;
  }>();
  let panelElement: HTMLElement;

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
    dispatch("change", { min, max });
  }

  function handleClear() {
    min = "";
    max = "";
    dispatch("change", { min: "", max: "" });
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
  class="NumberRangePanel"
  style={panelStyle}
  role="dialog"
  tabindex="-1"
  aria-label="{column} 数値フィルター"
  on:click|stopPropagation
  on:keydown={handleKeydown}
  use:portal
>
  <div class="PanelTitle">{column} フィルター</div>
  <div class="NumberRow">
    <label for="nr-min-{column}">以上</label>
    <input
      id="nr-min-{column}"
      type="number"
      min="0"
      step="1"
      bind:value={min}
      on:change={handleChange}
      placeholder="—"
    />
    <span class="Unit">件</span>
  </div>
  <div class="NumberRow">
    <label for="nr-max-{column}">以下</label>
    <input
      id="nr-max-{column}"
      type="number"
      min="0"
      step="1"
      bind:value={max}
      on:change={handleChange}
      placeholder="—"
    />
    <span class="Unit">件</span>
  </div>
  {#if min || max}
    <button class="ClearBtn" on:click={handleClear}>クリア</button>
  {/if}
</div>

<style>
  .NumberRangePanel {
    position: fixed;
    z-index: 99999999;
    background: var(--theme-color-Main-main);
    border-radius: 0.5rem;
    box-shadow: 0 0.2rem 0.5rem rgba(0, 0, 0, 0.25);
    padding: 4px 0;
    min-width: 12rem;
    color: var(--theme-color-Sub-light);
  }
  .PanelTitle {
    font-size: 0.75rem;
    font-weight: bold;
    color: var(--theme-color-Sub-light);
    padding: 0.45rem 0.75rem 0.35rem;
    opacity: 0.75;
  }
  .NumberRow {
    display: flex;
    align-items: center;
    padding: 0.45rem 0.75rem;
    gap: 0.5rem;
    color: var(--theme-color-Sub-light);
    font-size: 0.85rem;
  }
  .NumberRow label {
    width: 2.5rem;
    flex-shrink: 0;
    user-select: none;
  }
  .NumberRow input[type="number"] {
    flex: 1;
    background: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-light);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: 0.25rem;
    padding: 0.2rem 0.3rem;
    font-size: 0.8rem;
    box-sizing: border-box;
    min-width: 0;
  }
  .Unit {
    flex-shrink: 0;
    font-size: 0.8rem;
    opacity: 0.7;
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
