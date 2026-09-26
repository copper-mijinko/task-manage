<script>
  /**
   * @typedef {Object} Props
   * @property {any} [headers]
   * @property {number} [selectedCount]
   */

  /** @type {Props} */
  let { headers = [], selectedCount = 0 } = $props();
</script>

<div class="TableRow" data-testid="tree-table-header-stub" data-selected-count={selectedCount}>
  <div class="CheckboxHeaderCell" style="width: 28px;"></div>
  {#each headers as header}
    <div
      class="TableHeader"
      style="min-width: 4rem; width: 100px;"
      data-testid={"header-" + header.name}
    >
      {header.name}
    </div>
  {/each}
</div>
