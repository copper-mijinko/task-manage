<script lang="ts">
  import { viewportPopover } from "@lib/actions/viewport_popover";
  import { onMount, onDestroy } from "svelte";
  import { activePanelId, newPanelId } from "@stores/panel_coordinator";
  import { globalDismiss } from "@lib/actions";

  interface Props {
    value?: string;
    anchorRect?: DOMRect | null;
    onchange?: (detail: { name: string }) => void;
    onclose?: () => void;
  }

  let { value = $bindable(""), anchorRect = null, onchange, onclose }: Props = $props();

  let panelElement: HTMLElement | undefined = $state();
  let inputElement: HTMLInputElement | undefined = $state();
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
    onchange?.({ name: value });
  }

  function handleClear() {
    value = "";
    onchange?.({ name: "" });
    inputElement?.focus();
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    inputElement?.focus();
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }
</script>

<div
  bind:this={panelElement}
  class="NameFilterPanel"
  style={panelStyle}
  role="dialog"
  tabindex="-1"
  aria-label="Name フィルター"
  onclick={(event) => event.stopPropagation()}
  onkeydown={handleKeydown}
  use:portal
  use:viewportPopover={anchorRect}
  use:globalDismiss={() => onclose?.()}
>
  <div class="PanelTitle">Name フィルター</div>
  <label class="TextRow" for="name-filter-input">
    <span>Name</span>
    <input
      bind:this={inputElement}
      id="name-filter-input"
      type="text"
      bind:value
      placeholder="ノード名を絞り込み"
      aria-label="ノード名を絞り込み"
      oninput={handleChange}
    />
  </label>
  {#if value}
    <button class="ClearBtn" onclick={handleClear}>クリア</button>
  {/if}
</div>

<style>
  .NameFilterPanel {
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
  .TextRow {
    display: flex;
    align-items: center;
    padding: var(--sp2) var(--sp3);
    gap: var(--sp3);
    color: var(--theme-color-Sub-light);
    font-size: var(--font-body-sm);
  }
  .TextRow span {
    width: 1.875rem;
    flex-shrink: 0;
    user-select: none;
  }
  .TextRow input[type="text"] {
    flex: 1;
    background: var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-light);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-xs);
    padding: 0.15rem var(--sp1);
    font-size: var(--font-label-md);
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
