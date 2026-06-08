<script>
  export let style = "";
</script>

<div class:Pane={true} {style}>
  <slot />
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
    min-width: 2rem;
    padding: 0;
  }

  .Pane:has(> :global(.Card)) {
    align-items: stretch;
    justify-content: stretch;
    overflow: hidden;
    padding: var(--pane-pad);
  }
</style>
