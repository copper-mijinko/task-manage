<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let column: string;
  export let from: string = "";
  export let to: string = "";
  export let anchorRect: DOMRect | null = null;

  const dispatch = createEventDispatcher<{ change: { from: string; to: string } }>();

  $: panelStyle = anchorRect ? `top: ${anchorRect.bottom + 2}px; left: ${anchorRect.left}px;` : "";

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

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="DateRangePanel"
  style={panelStyle}
  role="dialog"
  tabindex="-1"
  aria-label="{column} 日付フィルター"
  on:click|stopPropagation
  on:keydown|stopPropagation
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
  .DateRow {
    display: flex;
    align-items: center;
    padding: 0.3rem 0.75rem;
    gap: 0.5rem;
    color: var(--theme-color-Sub-light);
    font-size: 0.875rem;
  }
  .DateRow label {
    width: 2.5rem;
    flex-shrink: 0;
    user-select: none;
  }
  .DateRow input[type="date"] {
    flex: 1;
    background: var(--theme-color-Main-dark);
    color: var(--theme-color-Main-light);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: 0.25rem;
    padding: 0.2rem 0.3rem;
    font-size: 0.8rem;
    color-scheme: dark;
    box-sizing: border-box;
    min-width: 0;
  }
  .ClearBtn {
    display: block;
    margin: 0.25rem 0.75rem 0;
    background: transparent;
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: 0.25rem;
    color: var(--theme-color-Sub-light);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.2rem 0.6rem;
  }
  .ClearBtn:hover {
    background-color: var(--theme-color-Accent-dark);
    color: var(--theme-color-Main-light);
    opacity: 1;
  }
</style>
