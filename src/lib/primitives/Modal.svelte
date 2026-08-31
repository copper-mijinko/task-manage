<script>
  import Card from "@lib/primitives/Card.svelte";
  import { modalLayer } from "@lib/actions/modal_layer";

  export let show = true;
  export let toggle;
  export let width = "90%";
  export let height = "90%";
  export let label = undefined;
  export let labelledBy = undefined;

  function handleKeydown(event) {
    if (show && event.key === "Escape") {
      event.preventDefault();
      toggle();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
  <div class="ModalLayer" use:modalLayer data-page-search-skip>
    <button
      type="button"
      class="Mask"
      aria-label="ダイアログを閉じる"
      tabindex="-1"
      on:click={toggle}
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
        <slot>
          <h1 style="color:var(--theme-color-Sub-main); display:flex; justify-content:center">
            This is default modal.
          </h1>
        </slot>
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
    max-width: calc(100vw - 2rem);
    max-height: calc(100vh - 2rem);
    overflow: auto;
    z-index: 1;
  }
</style>
