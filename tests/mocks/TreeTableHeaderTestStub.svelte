<script>
  export let headers = [];
</script>

<div class="TableRow" data-testid="tree-table-header-stub">
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
