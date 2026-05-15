<script>
  export let is_dark = false;
  export let backgroundColor = "var(--theme-color-Main-light)";
  export let color = "var(--theme-color-Sub-main)";
  export let disabled = false;
  export let value = "";
  export let id = "";
  export let style = "";
  export let inheritedDate = "";
  /** When true, urgency state is reflected on the input border + text color. Default true. */
  export let showUrgency = true;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const URGENT_DAYS = 5;

  function urgencyOf(dateStr) {
    if (!dateStr) return "none";
    const v = new Date(dateStr);
    if (isNaN(v.getTime())) return "none";
    const today = new Date();
    const diff = v - today + DAY_MS - 1;
    if (diff < 0) return "overdue";
    if (diff < DAY_MS * URGENT_DAYS) return "due-soon";
    return "none";
  }

  $: displayDate = value || inheritedDate || "";
  $: isInherited = !value && !!inheritedDate;
  $: urgency = showUrgency ? urgencyOf(displayDate) : "none";
  $: borderColor =
    urgency === "overdue"
      ? "var(--theme-color-Error-main)"
      : urgency === "due-soon"
        ? "var(--theme-color-Warning-main)"
        : "var(--theme-color-Main-dark)";
  $: textColor =
    urgency === "overdue"
      ? "var(--theme-color-Error-main)"
      : urgency === "due-soon"
        ? "var(--theme-color-Warning-main)"
        : color;
  $: inputTitle = isInherited
    ? `親タスクの期限: ${inheritedDate}`
    : urgency === "overdue"
      ? `期限切れ: ${displayDate}`
      : urgency === "due-soon"
        ? `期限間近: ${displayDate}`
        : undefined;
</script>

<div
  class="Container"
  class:Overdue={urgency === "overdue"}
  class:DueSoon={urgency === "due-soon"}
  style="--dark:{is_dark
    ? 'dark'
    : ''}; --backgroundColor: {backgroundColor}; --borderColor: {borderColor}; --color-datetime: {textColor};"
>
  {#if urgency === "overdue"}
    <span class="WarnIcon" aria-hidden="true">⚠</span>
  {/if}
  <input
    {style}
    class="Date"
    class:Inherited={isInherited}
    {id}
    type="date"
    {disabled}
    value={displayDate}
    title={inputTitle}
    on:change
    on:click={(e) => {
      e.stopPropagation();
    }}
  />
</div>

<style>
  .Container {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    gap: 2px;
  }
  /* Warning icon overlaid at the left edge inside the input padding */
  .WarnIcon {
    position: absolute;
    left: var(--sp1);
    top: 50%;
    transform: translateY(-50%);
    flex-shrink: 0;
    font-size: var(--font-label-md);
    color: var(--theme-color-Error-main);
    line-height: 1;
    user-select: none;
    pointer-events: none;
    z-index: 2;
  }
  .Date {
    height: 100%;
    width: 100%;
    background-color: var(--backgroundColor);
    color: var(--color-datetime);
    border: 1px solid var(--borderColor);
    border-radius: var(--shape-xs);
    color-scheme: var(--dark);
    position: relative;
    display: flex;
    margin: 0;
    padding: 0 var(--sp1);
    box-sizing: border-box;
    font-weight: 500;
    font-size: var(--font-label-md);
    cursor: pointer;
  }
  /* Make room for the leading warning icon */
  .Container.Overdue .Date {
    padding-left: calc(var(--sp1) + var(--sp4));
  }
  .Container.Overdue .Date,
  .Container.DueSoon .Date {
    font-weight: 600;
  }
  .Date.Inherited {
    opacity: 0.65;
    border-style: dashed;
    font-weight: 400;
  }
  /* Hide the native calendar picker icon — clicking the input opens the picker */
  .Date::-webkit-calendar-picker-indicator {
    background: transparent;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    cursor: pointer;
    color: transparent;
    opacity: 0;
  }
</style>
