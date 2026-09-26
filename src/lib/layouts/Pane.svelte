<script>
  /**
   * @typedef {Object} Props
   * @property {string} [style]
   * @property {import('svelte').Snippet} [children]
   */

  /** @type {Props} */
  let { style = "", children } = $props();
</script>

<div class:Pane={true} {style}>
  {@render children?.()}
</div>

<style>
  .Pane {
    display: flex;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    background-color: transparent;
    align-items: center;
    justify-content: center;
    overflow: auto;
    min-width: 1.5rem;
    padding: 0;
  }

  .Pane:has(:global(> :global(.Card))) {
    align-items: stretch;
    justify-content: stretch;
    overflow: hidden;
    padding: var(--pane-pad);
  }
</style>
