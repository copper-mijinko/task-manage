<script>
  import { ripple, tooltip } from "@lib/actions";
  export let activeColor = "var(--theme-color-Info-dark)";
  export let normalColor = "var(--theme-color-Info-main)";
  export let rippleColor = "var(--theme-color-Sub-main)";
  export let style = "";
  export let disabled = false;
  export let use_ripple = true;
  export let variant = "filled"; // "outlined", "text"
  export let tooltipContent = undefined;
  export let ariaLabel = undefined;
  export let ariaPressed = undefined;
  export let type = "button";
  // tooltip — keep reactive so a parent toggling tooltipContent (e.g. the
  // sidebar hamburger flipping its label between "open" and "close") is
  // picked up by the tooltip action's `update()` lifecycle.
  $: use_tooltip = tooltipContent !== undefined;
  let afcolor = "gray";
  let abgcolor = "gray";
  let abdcolor = "gray";
  let fcolor = "gray";
  let bgcolor = "gray";
  let bdcolor = "gray";
  let shadow = "0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);";

  $: {
    // Defaults for "filled" variant (used when no variant set)
    afcolor = "var(--theme-color-Main-light)";
    abgcolor = activeColor;
    abdcolor = "none";
    fcolor = "var(--theme-color-Main-light)";
    bgcolor = normalColor;
    bdcolor = "none";
    shadow = "0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);";

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

    // Apply disabled overlay: keep variant shape but visually mute via opacity.
    // (color-only changes here ensure text/outlined variants don't become a solid gray block.)
    if (disabled) {
      shadow = "none";
    }
  }
</script>

<button
  class="IconButton"
  {type}
  {disabled}
  aria-label={ariaLabel}
  aria-pressed={ariaPressed}
  use:ripple={{
    duration: 350,
    color: disabled ? "var(--theme-color-Sub-dark)" : rippleColor,
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
  <slot />
</button>

<style>
  button {
    display: flex;
    justify-content: center;
    align-items: center;
    height: var(--icon-button-size, 2rem);
    width: var(--icon-button-size, 2rem);
    padding: var(--icon-button-padding, 2px);
    border-radius: var(--icon-button-radius, var(--shape-sm));
    border: 1px solid var(--borderColor);
    margin: var(--button-margin, 0);
    cursor: pointer;
    background-color: var(--backgroundColor);
    color: var(--fontColor);
    flex-shrink: 0;
    box-sizing: border-box;
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
  button:disabled {
    cursor: not-allowed;
    opacity: 0.38;
  }
  button:disabled:hover {
    background-color: var(--backgroundColor);
    border-color: var(--borderColor);
    color: var(--fontColor);
    box-shadow: var(--shadow);
  }
  .IconButton :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
