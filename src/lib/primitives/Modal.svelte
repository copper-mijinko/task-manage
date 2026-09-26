<script>
  import Card from "@lib/primitives/Card.svelte";
  import { modalLayer } from "@lib/actions/modal_layer";

  /**
   * @typedef {Object} Props
   * @property {boolean} [show]
   * @property {any} toggle
   * @property {string} [width]
   * @property {string} [height]
   * @property {any} [label]
   * @property {any} [labelledBy]
   * @property {import('svelte').Snippet} [children]
   */

  /** @type {Props} */
  let {
    show = true,
    toggle,
    width = "90%",
    height = "90%",
    label = undefined,
    labelledBy = undefined,
    children,
  } = $props();
  let layer = $state();

  function handleKeydown(event) {
    if (show && !layer?.hasAttribute("inert") && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
    }
  }
</script>

<svelte:window onkeydowncapture={handleKeydown} />

{#if show}
  <div class="ModalLayer" bind:this={layer} use:modalLayer data-page-search-skip>
    <button
      type="button"
      class="Mask"
      aria-label="ダイアログを閉じる"
      tabindex="-1"
      onclick={toggle}
    ></button>
    <div
      class="Modal"
      style="--width: {width}; --height: {height};"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      tabindex="-1"
    >
      <Card style="width: 100%; height:100%;">
        {#if children}{@render children()}{:else}
          <h1 style="color:var(--theme-color-Sub-main); display:flex; justify-content:center">
            This is default modal.
          </h1>
        {/if}
      </Card>
    </div>
  </div>
{/if}

<style>
  .ModalLayer {
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: grid;
    place-items: center;
  }
  .Mask {
    position: absolute;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
  }
  .Modal {
    position: relative;
    display: flex;
    width: var(--width);
    height: var(--height);
    max-width: calc(100vw - 1.5rem);
    max-height: calc(100vh - 1.5rem);
    overflow: auto;
    z-index: 1;
  }
</style>
