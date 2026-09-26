<script>
  import { tick } from "svelte";
  import { STATUS_VALUES, statusOptionLabel } from "@lib/utils/status_labels";
  import { fly } from "svelte/transition";
  import IconButton from "@lib/primitives/IconButton.svelte";

  /**
   * @typedef {Object} Props
   * @property {number} [count] - Number of selected rows. Bar is hidden when 0.
   * @property {(detail?: any) => void} [onbulkstatus]
   * @property {(detail?: any) => void} [onbulksetdate]
   * @property {(detail?: any) => void} [onbulkcleardate]
   * @property {(detail?: any) => void} [onbulkcopy]
   * @property {(detail?: any) => void} [onclearselection]
   */

  /** @type {Props} */
  let {
    count = 0,
    onbulkstatus,
    onbulksetdate,
    onbulkcleardate,
    onbulkcopy,
    onclearselection,
  } = $props();

  const STATUSES = STATUS_VALUES;
  const STATUS_COLOR = {
    Open: "var(--theme-color-Primary-main)",
    "In Progress": "var(--theme-color-Info-main)",
    Pending: "var(--theme-color-Warning-main)",
    Completed: "var(--theme-color-Success-main)",
    Canceled: "var(--theme-color-Sub-main)",
  };

  let statusButtonEl = $state();
  let statusPopupEl = $state();
  let statusOpen = $state(false);
  let statusPopupStyle = $state("");

  let dateMenuButtonEl = $state();
  let dateMenuEl = $state();
  let dateMenuOpen = $state(false);
  let dateMenuStyle = $state("");

  let datePopupEl = $state();
  let dateOpen = $state(null); // "start date" | "due date" | null
  let dateAnchorEl = null;
  let datePopupStyle = $state("");
  let pendingDateValue = $state("");

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
    onbulkstatus?.({ value });
  }

  /**
   * 日付の操作は 開始日/期限日 × 設定/クリア の 4 つ。素のボタンで 4 つ並べると
   * 「ステータス変更」と同格に見えるうえ、バーが折り返していた。1 つのメニューに
   * 畳んで、ステータスと同じ「ボタン＋▾」の形に揃える。
   */
  async function toggleDateMenu(e) {
    e.stopPropagation();
    if (dateMenuOpen) {
      dateMenuOpen = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    dateMenuStyle = `bottom: ${window.innerHeight - rect.top + 6}px; left: ${rect.left}px;`;
    dateMenuOpen = true;
    statusOpen = false;
    closeDate();
    await tick();
    dateMenuEl?.querySelector("button")?.focus();
  }

  async function toggleDate(e, which) {
    e.stopPropagation();
    if (dateOpen === which) {
      closeDate();
      return;
    }
    const rect = (dateMenuButtonEl ?? e.currentTarget).getBoundingClientRect();
    datePopupStyle = `bottom: ${window.innerHeight - rect.top + 6}px; left: ${rect.left}px;`;
    dateAnchorEl = dateMenuButtonEl ?? e.currentTarget;
    pendingDateValue = "";
    dateOpen = which;
    statusOpen = false;
    dateMenuOpen = false;
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
      onbulksetdate?.({ key: dateOpen, value: pendingDateValue });
    }
    closeDate();
  }

  function clearDate(key) {
    dateMenuOpen = false;
    onbulkcleardate?.({ key });
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
    if (dateMenuOpen) {
      if (!dateMenuButtonEl?.contains(e.target) && !dateMenuEl?.contains(e.target)) {
        dateMenuOpen = false;
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
      } else if (dateMenuOpen) {
        dateMenuOpen = false;
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

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

{#if count > 1}
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
      onclick={toggleStatus}
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
    <button
      type="button"
      class="TextButton"
      bind:this={dateMenuButtonEl}
      aria-haspopup="menu"
      aria-expanded={dateMenuOpen}
      onclick={toggleDateMenu}
    >
      日付
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
    <span class="Divider" aria-hidden="true"></span>
    <IconButton
      variant="text"
      ariaLabel="コピー"
      tooltipContent="クリップボードへコピー（右クリック→Ctrl+V でペースト）"
      onclick={() => onbulkcopy?.()}
      style="margin: 0; width: 1.5rem; height: 1.5rem; box-shadow: none;"
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
      onclick={() => onclearselection?.()}
      style="margin: 0; width: 1.5rem; height: 1.5rem; box-shadow: none;"
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
          onclick={() => pickStatus(opt)}
        >
          <span class="StatusDot" style="background: {STATUS_COLOR[opt]}"></span>
          <span class="StatusLabel">{statusOptionLabel(opt)}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

{#if dateMenuOpen}
  <div
    bind:this={dateMenuEl}
    class="DateMenu"
    role="menu"
    aria-label="日付の一括操作"
    style={dateMenuStyle}
    use:portal
  >
    <button type="button" role="menuitem" onclick={(e) => toggleDate(e, "start date")}>
      開始日を設定
    </button>
    <button type="button" role="menuitem" onclick={(e) => toggleDate(e, "due date")}>
      期限日を設定
    </button>
    <span class="DateMenuSep" aria-hidden="true"></span>
    <button type="button" role="menuitem" onclick={() => clearDate("start date")}>
      開始日をクリア
    </button>
    <button type="button" role="menuitem" onclick={() => clearDate("due date")}>
      期限日をクリア
    </button>
  </div>
{/if}

{#if dateOpen}
  <div
    bind:this={datePopupEl}
    class="DatePopup"
    role="dialog"
    aria-label={dateOpen === "start date" ? "開始日を設定" : "期限日を設定"}
    style={datePopupStyle}
    use:portal
  >
    <input
      type="date"
      bind:value={pendingDateValue}
      onkeydown={(e) => {
        if (e.key === "Enter") applyDate();
      }}
    />
    <button type="button" class="DateApply" disabled={!pendingDateValue} onclick={applyDate}>
      適用
    </button>
  </div>
{/if}

<style>
  .DateMenu {
    position: fixed;
    z-index: 10001;
    display: flex;
    flex-direction: column;
    min-width: 9rem;
    padding: var(--sp1) 0;
    background-color: var(--theme-color-Main-light);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    border-radius: var(--shape-sm);
    box-shadow: var(--elevation-3);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
  }
  .DateMenu button {
    display: flex;
    align-items: center;
    min-height: var(--tap-min);
    padding: 0 var(--sp3);
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .DateMenu button:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
  }
  .DateMenuSep {
    margin: var(--sp1) 0;
    border-top: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 16%, transparent);
  }
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
    height: 1.125rem;
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
    width: 0.5625rem;
    height: 0.5625rem;
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
    min-width: 7.5rem;
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
