<script lang="ts">
  import { viewportPopover } from "@lib/actions/viewport_popover";
  import { onMount, onDestroy } from "svelte";
  import { activePanelId, newPanelId } from "@stores/panel_coordinator";
  import { globalDismiss } from "@lib/actions";

  interface Props {
    column: string;
    from?: string;
    to?: string;
    anchorRect?: DOMRect | null;
    onchange?: (detail: { from: string; to: string }) => void;
    onclose?: () => void;
  }

  let {
    column,
    from = $bindable(""),
    to = $bindable(""),
    anchorRect = null,
    onchange,
    onclose,
  }: Props = $props();

  let panelElement: HTMLElement | undefined = $state();
  const myPanelId = newPanelId();
  let unsubPanelCoord: (() => void) | undefined;

  onMount(() => {
    activePanelId.set(myPanelId);
    unsubPanelCoord = activePanelId.subscribe((id) => {
      if (id !== null && id !== myPanelId) onclose?.();
    });
  });
  onDestroy(() => unsubPanelCoord?.());

  let panelStyle = $derived(
    anchorRect ? `top: ${anchorRect.bottom + 2}px; left: ${anchorRect.left}px;` : ""
  );

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape") {
      onclose?.();
    }
  }

  function handleChange() {
    onchange?.({ from, to });
  }

  function handleClear() {
    from = "";
    to = "";
    onchange?.({ from: "", to: "" });
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
  onclick={(event) => event.stopPropagation()}
  onkeydown={handleKeydown}
  use:portal
  use:viewportPopover={anchorRect}
  use:globalDismiss={() => onclose?.()}
>
  <div class="PanelTitle">{column} フィルター</div>
  <div class="DateRow">
    <label for="dr-from-{column.replace(' ', '-')}">From</label>
    <input
      id="dr-from-{column.replace(' ', '-')}"
      type="date"
      bind:value={from}
      onchange={handleChange}
    />
  </div>
  <div class="DateRow">
    <label for="dr-to-{column.replace(' ', '-')}">To</label>
    <input
      id="dr-to-{column.replace(' ', '-')}"
      type="date"
      bind:value={to}
      onchange={handleChange}
    />
  </div>
  {#if from || to}
    <button class="ClearBtn" onclick={handleClear}>クリア</button>
  {/if}
</div>

<style>
  .DateRangePanel {
    position: fixed;
    z-index: 99999999;
    background: var(--theme-color-Main-main);
    border-radius: var(--shape-sm);
    box-shadow: 0 0.15rem 0.375rem rgba(0, 0, 0, 0.25);
    padding: 4px 0;
    min-width: 10.5rem;
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
    width: 1.875rem;
    flex-shrink: 0;
    user-select: none;
  }
  .DateRow input[type="date"] {
    flex: 1;
    background: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-light);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-xs);
    padding: 0.15rem var(--sp1);
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
