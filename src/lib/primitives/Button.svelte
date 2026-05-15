<script>
  import { ripple, tooltip } from "@lib/actions";
  export let content;
  export let activeColor = "var(--theme-color-Info-dark)";
  export let normalColor = "var(--theme-color-Info-main)";
  export let rippleColor = "var(--theme-color-Sub-main)";
  export let style = "";
  export let disabled = false;
  export let use_ripple = true;
  export let variant = "filled"; // "outlined", "text"
  export let tooltipContent = undefined;
  export let ariaLabel = undefined;
  // tooltip
  let use_tooltip = tooltipContent === undefined ? false : true;
  let afcolor = "gray";
  let abgcolor = "gray";
  let abdcolor = "gray";
  let fcolor = "gray";
  let bgcolor = "gray";
  let bdcolor = "gray";
  let shadow = "0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);";

  $: {
    afcolor = disabled ? "gray" : "var(--theme-color-Main-light)";
    abgcolor = disabled ? "gray" : activeColor;
    abdcolor = disabled ? "gray" : "none";
    fcolor = disabled ? "gray" : "var(--theme-color-Main-light)";
    bgcolor = disabled ? "gray" : normalColor;
    bdcolor = disabled ? "gray" : "none";
    shadow = "0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);";

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
  }
</script>

<button
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
  on:click
  style="--shadow:{shadow}; --activeFontColor: {afcolor}; --activeBorderColor: {abdcolor}; --activeBackgroundColor: {abgcolor}; --backgroundColor: {bgcolor}; --borderColor: {bdcolor}; --fontColor: {fcolor}; {style}"
>
  <span>{content}</span>
</button>

<style>
  button {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 2rem;
    min-height: 2rem;
    border-radius: var(--shape-pill);
    border: 1px solid var(--borderColor);
    margin: var(--sp1);
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
