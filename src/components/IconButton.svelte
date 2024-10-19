<script>
  import { ripple, tooltip } from '../common/common.js';
  export let activeColor = "var(--theme-color-Info-dark)";
  export let normalColor = "var(--theme-color-Info-main)";
  export let rippleColor = "var(--theme-color-Sub-main)";
  export let style = "";
  export let disabled = false;
  export let use_ripple = true;
  export let variant = "filled"; // "outlined", "text"
  export let tooltipContent = undefined;
  // tooltip
  let use_tooltip = tooltipContent === undefined? false: true;
  // colors
  // default "filled"
  let afcolor = disabled? "gray": "var(--theme-color-Main-light)";
  let abgcolor = disabled? "gray": activeColor;
  let abdcolor = disabled? "gray": "none";
  let fcolor = disabled? "gray": "var(--theme-color-Main-light)";
  let bgcolor = disabled? "gray": normalColor;
  let bdcolor = disabled? "gray": "none"; 
  // shadow
  let shadow = "0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);"
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
        break
      case "text":
        afcolor = activeColor;
        abgcolor = "var(--theme-color-Shadow-sub)";
        abdcolor = "none";
        fcolor = normalColor;
        bgcolor = "transparent";
        bdcolor = "none";
        shadow = "none";
        break
    }
  }
</script>

<button 
  class="IconButton" 
  {disabled} 
  use:ripple={{duration:350, color: disabled? "gray" : rippleColor, disable: !use_ripple}} 
  use:tooltip={{
    color:"var(--theme-color-Main-main)", 
    backgroundColor: "var(--theme-color-Sub-main)",
    wrapped: false,
    disable: !use_tooltip,
    content: tooltipContent,
    force: true
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
    height: 2rem;
    width: 2rem;
		border-radius: 50%;
    border: 0.1rem solid var(--borderColor);
    margin: 0.5rem;
    cursor: pointer;
    background-color: var(--backgroundColor);
    color: var(--fontColor);
    flex-shrink: 0;
  }
	button:focus-visible {
		outline: auto;
		z-index: 999;
    border: 0.1rem solid var(--activeBorderColor);
    background-color: var(--activeBackgroundColor);
    color: var(--activeFontColor);
    box-shadow: var(--shadow);
	}
  button:hover, button:active {
    border: 0.1rem solid var(--activeBorderColor);
    background-color: var(--activeBackgroundColor);
    color: var(--activeFontColor);
    box-shadow: var(--shadow);
  }
  .IconButton :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>