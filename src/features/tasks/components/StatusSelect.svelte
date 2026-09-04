<script>
  import { createEventDispatcher, onDestroy, tick } from "svelte";

  export let status = "";
  export let style = "";
  export let disabled = false;
  export let ariaLabel = "ステータス";

  const dispatch = createEventDispatcher();

  // 「無し」は既定値ではなく状態のひとつ。メモから育ったノードは進み具合を
  // 持たないので、そこに「未着手」を出すと未完了タスクの山に埋もれる。
  // 選ぶだけで追跡が始まるよう、専用の操作は作らずここに並べる。
  const NO_STATUS = "";
  const STATUSES = [NO_STATUS, "Open", "Pending", "In Progress", "Completed", "Canceled"];
  const STATUS_LABELS = {
    [NO_STATUS]: "なし",
    Open: "未着手",
    Pending: "保留",
    "In Progress": "進行中",
    Completed: "完了",
    Canceled: "キャンセル",
  };

  const color_map = {
    [NO_STATUS]: "transparent",
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
    if (disabled) return;
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
    class:s-disabled={disabled}
    style="--status-color: {color_map[status]};"
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={open}
    {disabled}
    data-current-status={status}
    on:click={toggle}
  >
    <span class="s-dot" style="--dot-color: {color_map[status]};"></span>
    <span class="s-label">{STATUS_LABELS[status] ?? status}</span>
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
          <span class="s-option-label">{STATUS_LABELS[opt] ?? opt}</span>
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
    /* 状態の色はドットが持ち、ラベルは本文色にする。
       アクセント色（例: Warning #ed6c02）は 8px のドットとしては十分でも
       12px の文字としては薄く、ライトテーマの行背景に対して 2.96:1 まで
       落ちて WCAG AA (4.5:1) を満たせなかった。ステータスは全行に出る、
       アプリ中でいちばん反復の多い文字なので影響が大きい。
       ドロップダウンの選択肢（.s-option）は元々この形なので、見た目も
       そちらに揃う。色分けはドットで残り、Open は中抜き、Canceled は
       打ち消し線と、色以外の手掛かりも保つ。 */
    color: var(--theme-color-Sub-main);
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
  /* ステータス無しは「淡いダッシュ」にして、件数バッジの 0 件表示と流儀を
     揃える。丸を出すと色の無い状態がひとつ増えたようにしか見えない。 */
  .s-chip[data-status=""] .s-dot,
  .s-dot-static[data-status=""] {
    display: none;
  }
  .s-chip[data-status=""] .s-label {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 55%, transparent);
  }
  .s-chip[data-status="Open"] .s-dot {
    background: color-mix(in srgb, var(--dot-color) 30%, transparent);
    border: 1.5px solid var(--dot-color);
  }
  .s-chip[data-status="Canceled"] .s-label {
    text-decoration: line-through;
  }
  /* 終わったタスクは一段落とす。急ぐものだけが目に入るようにする方針は
     期限日の色付けと揃える。 */
  .s-chip[data-status="Canceled"] .s-label,
  .s-chip[data-status="Completed"] .s-label {
    opacity: 0.75;
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
