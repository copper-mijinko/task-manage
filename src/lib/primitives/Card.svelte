<script>
  /** Optional title shown in a header bar above the content. */
  export let title = "";
  /** Outer style overrides. */
  export let style = "";
  /** When true, the inner content area gets default padding. Default true. */
  export let padded = true;
</script>

<div class="Card" {style}>
  {#if title}
    <header class="CardHeader">
      <span class="CardHeaderTitle">{title}</span>
      <slot name="header-actions" />
    </header>
  {/if}
  <div class="CardBody" class:padded>
    <slot />
  </div>
</div>

<style>
  .Card {
    display: flex;
    flex-direction: column;
    box-shadow: var(--elevation-2);
    border-radius: var(--shape-sm);
    overflow: hidden;
    box-sizing: border-box;
    background-color: var(--theme-color-Main-main);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
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
    padding: var(--sp2) var(--sp4);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 20%, transparent);
    background-color: color-mix(
      in srgb,
      var(--theme-color-Primary-main) 12%,
      var(--theme-color-Main-main)
    );
  }
  .CardHeaderTitle {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-title-md);
    font-weight: 600;
    color: var(--theme-color-Sub-main);
    line-height: 1.2;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .CardBody {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }
  .CardBody.padded {
    padding: var(--sp3);
  }
</style>
