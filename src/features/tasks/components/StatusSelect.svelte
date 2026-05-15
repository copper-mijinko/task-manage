<script>
  import { createEventDispatcher, onDestroy, tick } from "svelte";

  export let status = "Open";
  export let style = "";

  const dispatch = createEventDispatcher();

  const STATUSES = ["Open", "Pending", "In Progress", "Completed", "Canceled"];

  const color_map = {
    Open: "var(--theme-color-Primary-main)",
    "In Progress": "var(--theme-color-Info-main)",
    Pending: "var(--theme-color-Warning-main)",
    Completed: "var(--theme-color-Success-main)",
    Canceled: "var(--theme-color-Sub-main)",
  };

  let open = false;
  let containerEl;
  let popupEl;
  let popupStyle = "";

  async function toggle(event) {
    event.stopPropagation();
    if (open) {
      open = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    popupStyle = `top: ${rect.bottom + 2}px; left: ${rect.left}px; min-width: ${rect.width}px;`;
    open = true;
    await tick();
    popupEl?.focus();
  }

  function select(value) {
    open = false;
    if (value === status) return;
    // Dispatch a change event whose target.value matches the legacy <select> API.
    dispatch("change", { target: { value }, value });
  }

  function handleWindowClick(e) {
    if (!open) return;
    if (containerEl && !containerEl.contains(e.target) && popupEl && !popupEl.contains(e.target)) {
      open = false;
    }
  }

  function handleKey(e) {
    if (!open) return;
    if (e.key === "Escape") {
      open = false;
      e.stopPropagation();
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

  onDestroy(() => {
    open = false;
  });
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleKey} />

<span class="s-chip" data-status={status} {style} bind:this={containerEl}>
  <button
    type="button"
    class="s-button"
    style="--status-color: {color_map[status]};"
    aria-label="Status"
    aria-haspopup="listbox"
    aria-expanded={open}
    data-current-status={status}
    on:click={toggle}
  >
    <span class="s-dot" style="--dot-color: {color_map[status]};"></span>
    <span class="s-label">{status}</span>
    <svg class="s-caret" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        stroke-width="1.5"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</span>

{#if open}
  <ul
    bind:this={popupEl}
    class="s-popup"
    role="listbox"
    tabindex="-1"
    style={popupStyle}
    use:portal
  >
    {#each STATUSES as opt}
      <li class="s-option-shell">
        <button
          type="button"
          role="option"
          aria-selected={opt === status}
          class="s-option"
          class:selected={opt === status}
          on:click={() => select(opt)}
        >
          <span class="s-dot s-dot-static" style="--dot-color: {color_map[opt]};" data-status={opt}
          ></span>
          <span class="s-option-label">{opt}</span>
          {#if opt === status}
            <svg class="s-check" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 8.5L6.5 12L13 5"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .s-chip {
    display: inline-flex;
    align-items: center;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }
  .s-button {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    padding: 0 var(--sp1);
    background: transparent;
    border: none;
    color: var(--status-color);
    font-size: var(--font-label-md);
    font-weight: 500;
    cursor: pointer;
    min-width: 0;
    text-align: left;
  }
  .s-button:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
    border-radius: var(--shape-xs);
  }
  .s-dot {
    width: var(--sp2);
    height: var(--sp2);
    border-radius: 50%;
    background: var(--dot-color);
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .s-chip[data-status="Open"] .s-dot {
    background: color-mix(in srgb, var(--dot-color) 30%, transparent);
    border: 1.5px solid var(--dot-color);
  }
  .s-chip[data-status="Canceled"] .s-label {
    text-decoration: line-through;
  }
  .s-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .s-caret {
    width: 0.75rem;
    height: 0.75rem;
    flex-shrink: 0;
    opacity: 0.7;
  }
  .s-popup {
    position: fixed;
    z-index: 99999999;
    margin: 0;
    padding: var(--sp1) 0;
    list-style: none;
    border-radius: var(--shape-sm);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    background-color: var(--theme-color-Main-main);
    box-shadow: var(--elevation-3);
    color: var(--theme-color-Sub-main);
    min-width: 8rem;
    animation: s-pop 0.12s ease-out;
  }
  @keyframes s-pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .s-popup .s-option-shell {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .s-option {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    width: 100%;
    padding: var(--sp1) var(--sp2);
    background: transparent;
    border: none;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }
  .s-option:hover,
  .s-option:focus-visible {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
    outline: none;
  }
  .s-option-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .s-dot-static[data-status="Open"] {
    background: color-mix(in srgb, var(--dot-color) 30%, transparent);
    border: 1.5px solid var(--dot-color);
  }
  .s-dot-static[data-status="Canceled"] {
    /* Use a slightly muted dot for Canceled */
    opacity: 0.7;
  }
  .s-check {
    width: 0.9rem;
    height: 0.9rem;
    color: var(--theme-color-Primary-main);
    flex-shrink: 0;
  }
  .s-option.selected {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 8%, transparent);
  }
</style>
