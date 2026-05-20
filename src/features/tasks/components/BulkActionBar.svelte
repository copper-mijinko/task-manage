<script>
  import { createEventDispatcher, tick } from "svelte";
  import { fly } from "svelte/transition";
  import IconButton from "@lib/primitives/IconButton.svelte";

  /** Number of selected rows. Bar is hidden when 0. */
  export let count = 0;

  const dispatch = createEventDispatcher();

  const STATUSES = ["Open", "Pending", "In Progress", "Completed", "Canceled"];
  const STATUS_COLOR = {
    Open: "var(--theme-color-Primary-main)",
    "In Progress": "var(--theme-color-Info-main)",
    Pending: "var(--theme-color-Warning-main)",
    Completed: "var(--theme-color-Success-main)",
    Canceled: "var(--theme-color-Sub-main)",
  };

  let statusButtonEl;
  let statusPopupEl;
  let statusOpen = false;
  let statusPopupStyle = "";

  let datePopupEl;
  let dateOpen = null; // "start date" | "due date" | null
  let dateAnchorEl = null;
  let datePopupStyle = "";
  let pendingDateValue = "";

  async function toggleStatus(e) {
    e.stopPropagation();
    if (statusOpen) {
      statusOpen = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    statusPopupStyle = `bottom: ${window.innerHeight - rect.top + 6}px; left: ${rect.left}px;`;
    statusOpen = true;
    closeDate();
    await tick();
    statusPopupEl?.focus();
  }

  function pickStatus(value) {
    statusOpen = false;
    dispatch("bulkStatus", { value });
  }

  async function toggleDate(e, which) {
    e.stopPropagation();
    if (dateOpen === which) {
      closeDate();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    datePopupStyle = `bottom: ${window.innerHeight - rect.top + 6}px; left: ${rect.left}px;`;
    dateAnchorEl = e.currentTarget;
    pendingDateValue = "";
    dateOpen = which;
    statusOpen = false;
    await tick();
    datePopupEl?.querySelector("input[type=date]")?.focus();
  }

  function closeDate() {
    dateOpen = null;
    pendingDateValue = "";
    dateAnchorEl = null;
  }

  function applyDate() {
    if (!dateOpen) return;
    if (pendingDateValue) {
      dispatch("bulkSetDate", { key: dateOpen, value: pendingDateValue });
    }
    closeDate();
  }

  function clearDate(key) {
    dispatch("bulkClearDate", { key });
  }

  function handleWindowClick(e) {
    if (statusOpen) {
      if (!statusButtonEl?.contains(e.target) && !statusPopupEl?.contains(e.target)) {
        statusOpen = false;
      }
    }
    if (dateOpen) {
      if (!dateAnchorEl?.contains(e.target) && !datePopupEl?.contains(e.target)) {
        closeDate();
      }
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      if (statusOpen) {
        statusOpen = false;
        e.stopPropagation();
      } else if (dateOpen) {
        closeDate();
        e.stopPropagation();
      }
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

<svelte:window on:click={handleWindowClick} on:keydown={handleKeydown} />

{#if count > 0}
  <div
    class="BulkBar"
    role="toolbar"
    aria-label="一括操作"
    tabindex="-1"
    transition:fly={{ y: 20, duration: 160 }}
  >
    <span class="Count">{count}件選択</span>
    <span class="Divider" aria-hidden="true"></span>
    <button
      type="button"
      class="TextButton"
      bind:this={statusButtonEl}
      aria-haspopup="listbox"
      aria-expanded={statusOpen}
      on:click={toggleStatus}
    >
      ステータス変更
      <svg viewBox="0 0 12 12" aria-hidden="true" class="Caret">
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
    <button type="button" class="TextButton" on:click={(e) => toggleDate(e, "start date")}>
      開始日設定
    </button>
    <button type="button" class="TextButton" on:click={(e) => toggleDate(e, "due date")}>
      期日設定
    </button>
    <button type="button" class="TextButton" on:click={() => clearDate("start date")}>
      開始日クリア
    </button>
    <button type="button" class="TextButton" on:click={() => clearDate("due date")}>
      期日クリア
    </button>
    <span class="Divider" aria-hidden="true"></span>
    <IconButton
      variant="text"
      ariaLabel="コピー"
      tooltipContent="クリップボードへコピー（右クリック→Ctrl+V でペースト）"
      on:click={() => dispatch("bulkCopy")}
      style="margin: 0; width: 2rem; height: 2rem; box-shadow: none;"
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2ZM4 8H2v12a2 2 0 0 0 2 2h8v-2H4Z"
          fill="currentColor"
        />
      </svg>
    </IconButton>
    <span class="Divider" aria-hidden="true"></span>
    <IconButton
      variant="text"
      ariaLabel="選択を解除"
      tooltipContent="選択を解除"
      on:click={() => dispatch("clearSelection")}
      style="margin: 0; width: 2rem; height: 2rem; box-shadow: none;"
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M18 6L6 18M6 6L18 18"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </IconButton>
  </div>
{/if}

{#if statusOpen}
  <ul
    bind:this={statusPopupEl}
    class="StatusPopup"
    role="listbox"
    tabindex="-1"
    style={statusPopupStyle}
    use:portal
  >
    {#each STATUSES as opt}
      <li class="StatusOption">
        <button
          type="button"
          role="option"
          aria-selected="false"
          class="StatusOptionButton"
          on:click={() => pickStatus(opt)}
        >
          <span class="StatusDot" style="background: {STATUS_COLOR[opt]}"></span>
          <span class="StatusLabel">{opt}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

{#if dateOpen}
  <div
    bind:this={datePopupEl}
    class="DatePopup"
    role="dialog"
    aria-label={dateOpen === "start date" ? "開始日を設定" : "期日を設定"}
    style={datePopupStyle}
    use:portal
  >
    <input
      type="date"
      bind:value={pendingDateValue}
      on:keydown={(e) => {
        if (e.key === "Enter") applyDate();
      }}
    />
    <button type="button" class="DateApply" disabled={!pendingDateValue} on:click={applyDate}>
      適用
    </button>
  </div>
{/if}

<style>
  .BulkBar {
    position: fixed;
    bottom: var(--sp4);
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2) var(--sp3);
    background-color: var(--theme-color-Main-light);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    border-radius: var(--shape-md);
    box-shadow: var(--elevation-3);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    max-width: calc(100vw - var(--sp7));
    flex-wrap: wrap;
    justify-content: center;
  }
  .Count {
    font-weight: 600;
    color: var(--theme-color-Primary-dark);
    padding: 0 var(--sp1);
    white-space: nowrap;
  }
  .Divider {
    width: 1px;
    height: 1.5rem;
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 24%, transparent);
    flex-shrink: 0;
  }
  .TextButton {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    padding: var(--sp1) var(--sp2);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    border-radius: var(--shape-xs);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
  }
  .TextButton:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 10%, transparent);
    border-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Primary-main);
  }
  .TextButton:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  .Caret {
    width: 0.75rem;
    height: 0.75rem;
    opacity: 0.7;
  }
  .StatusPopup {
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
    min-width: 10rem;
  }
  .StatusOption {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .StatusOptionButton {
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
  .StatusOptionButton:hover,
  .StatusOptionButton:focus-visible {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
    outline: none;
  }
  .StatusDot {
    width: var(--sp2);
    height: var(--sp2);
    border-radius: 50%;
    flex-shrink: 0;
  }
  .StatusLabel {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .DatePopup {
    position: fixed;
    z-index: 99999999;
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2);
    background-color: var(--theme-color-Main-main);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    border-radius: var(--shape-sm);
    box-shadow: var(--elevation-3);
  }
  .DatePopup input[type="date"] {
    padding: var(--sp1) var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-main);
    font: inherit;
  }
  .DateApply {
    padding: var(--sp1) var(--sp3);
    background-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Main-light);
    border: none;
    border-radius: var(--shape-xs);
    font: inherit;
    cursor: pointer;
  }
  .DateApply:disabled {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    cursor: not-allowed;
  }
</style>
