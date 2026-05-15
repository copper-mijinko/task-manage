<script>
  import { createEventDispatcher } from "svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import { ripple } from "@lib/actions";
  import { activePanelId, newPanelId } from "@stores/panel_coordinator";

  const myPanelId = newPanelId();

  export let list = ["first", "second", "third"];
  export let selected = [];
  export let placeholder = "Not selected.";
  export let summary = "";

  let checked = Array.from(list).fill(false);
  let expanded = false;
  let containerElement;
  let listElement;
  let anchorRect = null;
  let selectedKey = "";

  const dispatch = createEventDispatcher();

  function keyOf(values) {
    return (values ?? []).join("\u001f");
  }

  $: {
    const nextKey = keyOf(selected);
    if (nextKey !== selectedKey) {
      checked = list.map((elm) => selected.includes(elm));
      selectedKey = nextKey;
    }
  }

  $: selectionLabel =
    summary ||
    (selected.length == 0
      ? placeholder
      : selected.length == 1
        ? selected[0]
        : `${selected.length} selected.`);

  $: listStyle = anchorRect
    ? `top: ${anchorRect.bottom + 2}px; left: ${anchorRect.left}px; min-width: max(${anchorRect.width}px, 14rem);`
    : "";

  function updateSelected() {
    const next = list.filter((elm, i) => checked[i]);
    selected = next;
    selectedKey = keyOf(next);
    dispatch("change", { selected: next });
  }

  // Close when another panel becomes active
  $: if ($activePanelId !== null && $activePanelId !== myPanelId && expanded) {
    expanded = false;
  }

  function toggleExpanded(event) {
    event.stopPropagation();
    anchorRect = event.currentTarget.getBoundingClientRect();
    if (!expanded) {
      activePanelId.set(myPanelId);
    }
    expanded = !expanded;
  }

  function handleWindowClick(event) {
    if (
      expanded &&
      containerElement &&
      listElement &&
      !containerElement.contains(event.target) &&
      !listElement.contains(event.target)
    ) {
      expanded = false;
    }
  }

  function handleWindowKeydown(event) {
    if (expanded && event.key === "Escape") {
      expanded = false;
    }
  }

  function portal(node) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleWindowKeydown} />

<div class="container" bind:this={containerElement}>
  <div class="selectContainer">
    <button on:click={toggleExpanded} use:ripple>
      <div class="svgContainer">
        <svg
          class:emphasized={selected.length > 0}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          ><path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M3 7C3 6.44772 3.44772 6 4 6H20C20.5523 6 21 6.44772 21 7C21 7.55228 20.5523 8 20 8H4C3.44772 8 3 7.55228 3 7ZM6 12C6 11.4477 6.44772 11 7 11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H7C6.44772 13 6 12.5523 6 12ZM9 17C9 16.4477 9.44772 16 10 16H14C14.5523 16 15 16.4477 15 17C15 17.5523 14.5523 18 14 18H10C9.44772 18 9 17.5523 9 17Z"
          ></path></svg
        >
      </div>
      <div class="selection" class:expanded>
        {selectionLabel}
      </div>
      {#if selected.length > 0}
        <IconButton
          style={"margin: 0rem; padding: var(--sp1); margin-left: auto; width: 1.5rem; height: 1.5rem; flex-shrink: 0;"}
          ariaLabel="Clear filter selection"
          on:click={(e) => {
            expanded = false;
            checked = list.map(() => false);
            updateSelected();
            e.stopPropagation();
          }}
          activeColor={"transparent"}
          normalColor={"transparent"}
        >
          <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg"
            ><rect id="view-box" width="24" height="24" fill="none"></rect>
            <path
              id="Shape"
              d="M9.291,10.352l-4-4-4.005,4A.75.75,0,1,1,.22,9.291l4.005-4L.22,1.281A.75.75,0,0,1,1.281.22L5.286,4.225l4-4.005a.75.75,0,1,1,1.061,1.061l-4,4.005,4,4a.75.75,0,0,1-1.061,1.061Z"
              transform="translate(6.629 6.8)"
            ></path></svg
          >
        </IconButton>
      {/if}
    </button>
  </div>
  {#if expanded}
    <div bind:this={listElement} class="listContainer" style={listStyle} use:portal>
      {#each list as elm, i}
        <label class="elmContainer" for={`multi-select-${i}`}>
          <input
            id={`multi-select-${i}`}
            type="checkbox"
            bind:checked={checked[i]}
            on:change={updateSelected}
          />
          <span>{elm}</span>
        </label>
      {/each}
    </div>
  {/if}
</div>

<style>
  button {
    display: flex;
    align-items: center;
    border: none;
    border-radius: 0;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    background-color: transparent;
    flex-shrink: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-sm);
  }
  button:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  button:active {
    background-color: transparent;
  }
  svg.emphasized {
    fill: var(--theme-color-Primary-main);
  }
  svg {
    fill: var(--theme-color-Sub-main);
  }
  .container {
    width: 100%;
    height: 2rem;
    box-sizing: border-box;
    padding: 0;
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    font-weight: 1;
    border-radius: var(--shape-sm);
  }
  .svgContainer {
    margin: 0;
    padding: var(--sp1);
    width: 1.5rem;
    height: 1.5rem;
    flex-shrink: 0;
  }
  .selectContainer {
    display: flex;
    flex-direction: row;
    align-items: center;
    height: 100%;
    width: 100%;
    flex: 1;
  }
  .listContainer {
    position: fixed;
    z-index: 99999999;
    display: flex;
    flex-direction: column;
    background: var(--theme-color-Main-light);
    border: 1px solid var(--theme-color-Main-dark);
    border-radius: var(--shape-sm);
    box-shadow: var(--elevation-2);
    padding: var(--sp1) 0;
    color: var(--theme-color-Sub-main);
    box-sizing: border-box;
  }
  .elmContainer {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    margin: 0;
    padding: var(--sp1) var(--sp3);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
    cursor: pointer;
    user-select: none;
  }
  .elmContainer:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
  }
  .elmContainer input[type="checkbox"] {
    width: 0.9rem;
    height: 0.9rem;
    margin: 0;
    flex-shrink: 0;
    accent-color: var(--theme-color-Primary-main);
  }
  .selection {
    padding: 0 var(--sp1);
    overflow: hidden;
    box-sizing: border-box;
  }
  .expanded {
    border: 1px solid gray;
    border-radius: var(--shape-xs);
  }
</style>
