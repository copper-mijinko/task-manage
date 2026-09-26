<script lang="ts">
  import { viewportPopover } from "@lib/actions/viewport_popover";
  import { onMount, onDestroy } from "svelte";
  import { STATUS_LABELS } from "@lib/utils/status_labels";
  import { activePanelId, newPanelId } from "@stores/panel_coordinator";
  import { globalDismiss } from "@lib/actions";

  interface Props {
    selected?: string[];
    options?: string[];
    anchorRect?: DOMRect | null;
    title?: string;
    labels?: Record<string, string> | null;
    showDots?: boolean;
    onchange?: (detail: { selected: string[] }) => void;
    onclose?: () => void;
  }

  let {
    selected = [],
    options = [],
    anchorRect = null,
    title = "ステータスフィルター",
    labels = null,
    showDots = true,
    onchange,
    onclose,
  }: Props = $props();

  let panelElement: HTMLElement | undefined = $state();
  const myPanelId = newPanelId();
  let unsubPanelCoord: (() => void) | undefined;

  const STATUS_DOT_COLOR: Record<string, string> = {
    Open: "var(--theme-color-Primary-main)",
    "": "transparent",
    Pending: "var(--theme-color-Warning-main)",
    "In Progress": "var(--theme-color-Info-main)",
    Completed: "var(--theme-color-Success-main)",
    Canceled: "var(--theme-color-Sub-main)",
  };

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
    if (event.key === "Escape") onclose?.();
  }

  function toggle(opt: string) {
    const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
    onchange?.({ selected: next });
  }

  function clear() {
    onchange?.({ selected: [] });
  }

  function selectAll() {
    onchange?.({ selected: [...options] });
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

<svelte:window onkeydown={handleKeydown} />

<div
  class="StatusFilterPanel"
  bind:this={panelElement}
  style={panelStyle}
  use:portal
  use:viewportPopover={anchorRect}
  use:globalDismiss={() => onclose?.()}
>
  <div class="PanelHeader">{title}</div>
  <div class="PanelBody">
    {#each options as opt}
      <label class="OptionRow">
        <input type="checkbox" checked={selected.includes(opt)} onchange={() => toggle(opt)} />
        {#if showDots}<span class="StatusDot" style="--dot: {STATUS_DOT_COLOR[opt] ?? '#888'};"
          ></span>{/if}
        <span class="OptionLabel">{(labels ?? STATUS_LABELS)[opt] ?? opt}</span>
      </label>
    {/each}
  </div>
  <div class="PanelActions">
    <button type="button" class="LinkButton" onclick={selectAll}>すべて選択</button>
    <button type="button" class="LinkButton" onclick={clear}>フィルター解除</button>
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
    min-width: 10.5rem;
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
    /* ツリー側のチェックボックスと同じ「本文と同寸」に揃える。ここだけ
       11px で、同じ部品が 1 画面に 2 サイズ存在していた。
       当たり判定は行全体 (.OptionRow が label) が持つ。 */
    width: var(--font-body-md);
    height: var(--font-body-md);
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
