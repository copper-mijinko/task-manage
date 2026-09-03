<script>
  import { dueDateUrgency, dueDateUrgencyLabel } from "@lib/utils/date_urgency";

  export let is_dark = false;
  export let backgroundColor = "var(--theme-color-Main-light)";
  export let color = "var(--theme-color-Sub-main)";
  export let disabled = false;
  export let value = "";
  export let id = "";
  export let style = "";
  export let inheritedDate = "";
  export let ariaLabel = "日付";
  /**
   * true のときだけ期限としての差し迫り具合を枠線と文字色に出す。
   * 開始日のような「期限ではない日付」は false にする。過ぎた開始日は
   * 進行中タスクのごく普通の状態で、警告色にすると本当の期限切れが埋もれる。
   */
  export let showUrgency = true;
  /** 期限の色付けを抑えるためのタスクステータス（完了 / 中止なら急かさない）。 */
  export let status = undefined;

  $: displayDate = value || inheritedDate || "";
  $: isInherited = !value && !!inheritedDate;
  $: urgency = showUrgency ? dueDateUrgency(displayDate, status) : "none";
  $: borderColor =
    urgency === "overdue"
      ? "var(--theme-color-Error-main)"
      : urgency === "today" || urgency === "due-soon"
        ? "var(--theme-color-Warning-main)"
        : "var(--theme-color-Main-dark)";
  // 枠線は視認しやすい原色のまま（UI 要素は 3:1）、文字だけ AA を満たす
  // 濃さの変種にする。同じ色で両方やると 12px の日付が読めない。
  $: textColor =
    urgency === "overdue"
      ? "var(--theme-color-Error-text)"
      : urgency === "today" || urgency === "due-soon"
        ? "var(--theme-color-Warning-text)"
        : color;
  $: inputTitle = isInherited
    ? `親タスクの期限: ${inheritedDate}`
    : showUrgency
      ? dueDateUrgencyLabel(displayDate, status)
      : undefined;
</script>

<div
  class="Container"
  class:Overdue={urgency === "overdue"}
  class:DueSoon={urgency === "today" || urgency === "due-soon"}
  class:DueToday={urgency === "today"}
  style="--dark:{is_dark
    ? 'dark'
    : ''}; --backgroundColor: {backgroundColor}; --borderColor: {borderColor}; --color-datetime: {textColor};"
>
  <input
    {style}
    class="Date"
    class:Inherited={isInherited}
    id={id || undefined}
    type="date"
    {disabled}
    value={displayDate}
    title={inputTitle}
    aria-label={ariaLabel}
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
  .Container.Overdue .Date,
  .Container.DueSoon .Date {
    font-weight: 600;
  }
  /* Overdue used to be flagged with a leading ⚠ glyph that reserved 24px of
     padding inside the input. In a tree column that is ~96px wide it pushed
     the date itself out of view, so the urgency badge hid the very value it
     was flagging. The state is now carried by the red border, the bold red
     text, a thicker leading edge (a non-colour cue that survives a
     colour-vision deficiency) and the `期限切れ: …` tooltip.
     当日の期限も同じ太い縁を付ける。色だけだと「あと数日」と区別が付かず、
     今日出さないといけないものが埋もれるため。 */
  .Container.Overdue .Date,
  .Container.DueToday .Date {
    border-left-width: 3px;
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
