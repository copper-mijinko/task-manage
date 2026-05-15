<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { activePanelId, newPanelId } from "@stores/panel_coordinator";
  import { globalDismiss } from "@lib/actions";

  export let selected: string[] = [];
  export let options: string[] = [];
  export let anchorRect: DOMRect | null = null;

  const dispatch = createEventDispatcher<{
    change: { selected: string[] };
    close: void;
  }>();
  let panelElement: HTMLElement;
  const myPanelId = newPanelId();
  let unsubPanelCoord: (() => void) | undefined;

  const STATUS_DOT_COLOR: Record<string, string> = {
    Open: "var(--theme-color-Primary-main)",
    Pending: "var(--theme-color-Warning-main)",
    "In Progress": "var(--theme-color-Info-main)",
    Completed: "var(--theme-color-Success-main)",
    Canceled: "var(--theme-color-Sub-main)",
  };

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
    if (event.key === "Escape") dispatch("close");
  }

  function toggle(opt: string) {
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    dispatch("change", { selected: next });
  }

  function clear() {
    dispatch("change", { selected: [] });
  }

  function selectAll() {
    dispatch("change", { selected: [...options] });
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

<svelte:window on:keydown={handleKeydown} />

<div
  class="StatusFilterPanel"
  bind:this={panelElement}
  style={panelStyle}
  use:portal
  use:globalDismiss={() => dispatch("close")}
>
  <div class="PanelHeader">Status フィルター</div>
  <div class="PanelBody">
    {#each options as opt}
      <label class="OptionRow">
        <input
          type="checkbox"
          checked={selected.includes(opt)}
          on:change={() => toggle(opt)}
        />
        <span class="StatusDot" style="--dot: {STATUS_DOT_COLOR[opt] ?? '#888'};"></span>
        <span class="OptionLabel">{opt}</span>
      </label>
    {/each}
  </div>
  <div class="PanelActions">
    <button type="button" class="LinkButton" on:click={selectAll}>すべて選択</button>
    <button type="button" class="LinkButton" on:click={clear}>フィルター解除</button>
  </div>
</div>

<style>
  .StatusFilterPanel {
    position: fixed;
    z-index: 99999999;
    background: var(--theme-color-Main-light);
    border: 1px solid var(--theme-color-Main-dark);
    border-radius: var(--shape-sm);
    box-shadow: var(--elevation-2);
    min-width: 14rem;
    color: var(--theme-color-Sub-main);
    padding: var(--sp1) 0;
    box-sizing: border-box;
  }
  .PanelHeader {
    padding: var(--sp1) var(--sp3) var(--sp2);
    font-size: var(--font-label-md);
    font-weight: 700;
    color: var(--theme-color-Sub-main);
    border-bottom: 1px solid var(--theme-color-Main-dark);
  }
  .PanelBody {
    display: flex;
    flex-direction: column;
    padding: var(--sp1) 0;
  }
  .OptionRow {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp1) var(--sp3);
    cursor: pointer;
    font-size: var(--font-body-sm);
    user-select: none;
  }
  .OptionRow:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 10%, transparent);
  }
  .OptionRow input[type="checkbox"] {
    width: 0.95rem;
    height: 0.95rem;
    margin: 0;
    accent-color: var(--theme-color-Primary-main);
  }
  .StatusDot {
    width: var(--sp2);
    height: var(--sp2);
    border-radius: 50%;
    background: var(--dot);
    flex-shrink: 0;
  }
  .OptionLabel {
    flex: 1;
  }
  .PanelActions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp2);
    padding: var(--sp1) var(--sp3) var(--sp2);
    border-top: 1px solid var(--theme-color-Main-dark);
  }
  .LinkButton {
    background: none;
    border: none;
    color: var(--theme-color-Primary-main);
    font-size: var(--font-label-md);
    cursor: pointer;
    padding: var(--sp1) var(--sp2);
    border-radius: var(--shape-xs);
  }
  .LinkButton:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
  }
</style>
