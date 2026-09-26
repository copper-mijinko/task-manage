<script>
  import { ripple, tooltip } from "@lib/actions";
  /**
   * @typedef {Object} Props
   * @property {any} content
   * @property {string} [activeColor]
   * @property {string} [normalColor]
   * @property {string} [rippleColor]
   * @property {string} [style]
   * @property {boolean} [disabled]
   * @property {boolean} [use_ripple]
   * @property {string} [variant] - "outlined", "text"
   * @property {any} [tooltipContent]
   * @property {any} [ariaLabel]
   * @property {string} [type]
   * @property {(detail?: any) => void} [onclick]
   */

  /** @type {Props} */
  let {
    content,
    activeColor = "var(--theme-color-Info-dark)",
    normalColor = "var(--theme-color-Info-main)",
    rippleColor = "var(--theme-color-Sub-main)",
    style = "",
    disabled = false,
    use_ripple = true,
    variant = "filled",
    tooltipContent = undefined,
    ariaLabel = undefined,
    type = "button",
    onclick,
  } = $props();
  // tooltip
  let use_tooltip = $derived(tooltipContent !== undefined);

  /**
   * 無効時の色。以前は文字も背景も同じ "gray" で、ラベルが背景に溶けて
   * まったく読めなかった（例: アーカイブ済みノードや Inbox での「所属先を追加」）。
   * 押せないことは薄い面で示し、文字は読める濃さを残す。
   */
  const DISABLED_FG = "var(--fg-muted)";
  const DISABLED_BG = "color-mix(in srgb, var(--fg-muted) 16%, transparent)";
  const DISABLED_BD = "color-mix(in srgb, var(--fg-muted) 28%, transparent)";

  // 変種と無効状態から決まる色。
  let { afcolor, abgcolor, abdcolor, fcolor, bgcolor, bdcolor, shadow } = $derived.by(() => {
    let afcolor, abgcolor, abdcolor, fcolor, bgcolor, bdcolor, shadow;
    afcolor = disabled ? DISABLED_FG : "var(--theme-color-Main-light)";
    abgcolor = disabled ? DISABLED_BG : activeColor;
    abdcolor = disabled ? DISABLED_BD : "none";
    fcolor = disabled ? DISABLED_FG : "var(--theme-color-Main-light)";
    bgcolor = disabled ? DISABLED_BG : normalColor;
    bdcolor = disabled ? DISABLED_BD : "none";
    shadow = disabled
      ? "none"
      : "0 0.15rem 0.375rem rgba(0,0,0,0.25), 0 .1em 0.1875rem rgba(0,0,0,0);";

    if (!disabled) {
      switch (variant) {
        case "outlined":
          afcolor = activeColor;
          abgcolor = "var(--theme-color-Shadow-sub)";
          abdcolor = activeColor;
          fcolor = normalColor;
          bgcolor = "transparent";
          bdcolor = normalColor;
          shadow = "none";
          break;
        case "text":
          afcolor = activeColor;
          abgcolor = "var(--theme-color-Shadow-sub)";
          abdcolor = "none";
          fcolor = normalColor;
          bgcolor = "transparent";
          bdcolor = "none";
          shadow = "none";
          break;
      }
    }
    return { afcolor, abgcolor, abdcolor, fcolor, bgcolor, bdcolor, shadow };
  });
</script>

<button
  {type}
  {disabled}
  aria-label={ariaLabel}
  use:ripple={{
    duration: 700,
    color: disabled ? "var(--theme-color-Shadow-sub)" : rippleColor,
    disable: !use_ripple,
  }}
  use:tooltip={{
    color: "var(--theme-color-Main-main)",
    backgroundColor: "var(--theme-color-Sub-main)",
    wrapped: false,
    disable: !use_tooltip,
    content: tooltipContent,
    force: true,
  }}
  {onclick}
  style="--shadow:{shadow}; --activeFontColor: {afcolor}; --activeBorderColor: {abdcolor}; --activeBackgroundColor: {abgcolor}; --backgroundColor: {bgcolor}; --borderColor: {bdcolor}; --fontColor: {fcolor}; {style}"
>
  <span>{content}</span>
</button>

<style>
  button {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 1.5rem;
    min-height: 1.5rem;
    border-radius: var(--shape-pill);
    border: 1px solid var(--borderColor);
    margin: var(--button-margin, 0);
    padding: var(--sp1) var(--sp4);
    font-size: var(--font-body-sm);
    font-weight: 500;
    cursor: pointer;
    background-color: var(--backgroundColor);
    color: var(--fontColor);
    flex-shrink: 0;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease,
      box-shadow 0.12s ease;
  }
  button:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
    z-index: 999;
    border: 1px solid var(--activeBorderColor);
    background-color: var(--activeBackgroundColor);
    color: var(--activeFontColor);
    box-shadow: var(--shadow);
  }
  button:hover,
  button:active {
    border: 1px solid var(--activeBorderColor);
    background-color: var(--activeBackgroundColor);
    color: var(--activeFontColor);
    box-shadow: var(--shadow);
  }
  span {
    width: 100%;
    line-height: 100%;
    flex-shrink: 0;
    flex-grow: 1;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    color: var(--fontColor);
  }
</style>
