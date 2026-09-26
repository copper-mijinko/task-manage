<script>
  /**
   * @typedef {Object} Props
   * @property {string} [title] - Optional title shown in a header bar above the content.
   * @property {string} [style] - Outer style overrides.
   * @property {boolean} [padded] - When true, the inner content area gets default padding.
   * @property {import("svelte").Snippet} [headerActions] - Controls shown at the right of the title.
   * @property {import("svelte").Snippet} [children]
   */

  /** @type {Props} */
  let { title = "", style = "", padded = true, headerActions, children } = $props();
</script>

<div class="Card" {style}>
  {#if title}
    <header class="CardHeader">
      <span class="CardHeaderTitle">{title}</span>
      {@render headerActions?.()}
    </header>
  {/if}
  <div class="CardBody" class:padded>
    {@render children?.()}
  </div>
</div>

<style>
  .Card {
    display: flex;
    flex-direction: column;
    box-shadow: var(--elevation-2);
    border-radius: var(--card-radius);
    overflow: hidden;
    box-sizing: border-box;
    background-color: var(--theme-color-Main-main);
    border: 1px solid
      color-mix(in srgb, var(--theme-color-Sub-main) var(--card-border-alpha), transparent);
    transition:
      box-shadow 0.18s ease,
      transform 0.18s ease;
  }
  .Card:hover {
    box-shadow: var(--elevation-3);
  }
  .CardHeader {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    flex-shrink: 0;
    min-height: var(--card-header-min-h);
    padding: var(--card-header-pad-y) var(--sp3);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 20%, transparent);
    background-color: var(--card-header-bg);
  }
  .CardHeaderTitle {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--card-header-font);
    font-weight: 600;
    color: var(--theme-color-Sub-main);
    line-height: 1.2;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .CardHeader :global(button) {
    margin: 0;
  }
  .CardBody {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }
  .CardBody.padded {
    padding: var(--card-pad);
  }
</style>
