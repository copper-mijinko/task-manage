<script>
  import { clickOutside } from "../common/common.js";
  import Card from "./Card.svelte";
  export let show = true;
  export let toggle;
  export let width = "90%";
  export let height = "90%";
  export let label = undefined;
  export let labelledBy = undefined;
  let modal; // bind

  let mask;

  const add = () => {
    mask = document.createElement("span");
    mask.style.position = "absolute";
    mask.style.left = "0";
    mask.style.top = "0";
    mask.style.width = "100%";
    mask.style.height = "100%";
    mask.style.backgroundColor = "rgba(0,0,0,0.5)";
    mask.style.zIndex = "9999";
    mask.style.padding = "0";
    mask.style.margin = "0";

    document.body.appendChild(mask);
    return mask;
  };

  $: if (show) {
    mask = add();
  } else {
    if (mask) {
      mask.remove();
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      toggle();
    }
  }
</script>

{#if show}
  <svelte:window on:keydown={handleKeydown} />
{/if}
{#if show}
  <div class="Mask"></div>
{/if}
<div
  class="Modal"
  class:Show={show}
  bind:this={modal}
  style="--width: {width}; --height: {height};"
  role="dialog"
  aria-modal={show ? "true" : undefined}
  aria-label={label}
  aria-labelledby={labelledBy}
  use:clickOutside
  on:outclick={toggle}
>
  <Card style="width: 100%; height:100%;">
    <slot>
      <h1 style="color:var(--theme-color-Sub-main); display:flex; justify-content:center">
        This is default modal.
      </h1>
    </slot>
  </Card>
</div>

<style>
  .Modal {
    display: flex;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 0;
    height: 0;
    z-index: 99999;
    overflow: auto;
  }
  .Show {
    width: var(--width);
    height: var(--height);
  }
</style>
