<script>
  import { projectFinderRows } from "@features/workspace/utils/graph_projection";
  /**
   * @typedef {Object} Props
   * @property {any} graph
   * @property {string} [selectedOccurrenceId]
   * @property {boolean} [showArchived]
   * @property {string} [persistenceKey]
   * @property {(detail?: any) => void} [onselect]
   * @property {(detail?: any) => void} [onshowgraph]
   */

  /** @type {Props} */
  let {
    graph,
    selectedOccurrenceId = "",
    showArchived = false,
    persistenceKey = "",
    onselect,
    onshowgraph,
  } = $props();
  let path = $state([]),
    restored = $state("");
  $effect.pre(() => {
    if (graph && restored !== persistenceKey) {
      restored = persistenceKey;
      try {
        const saved = JSON.parse(
          localStorage.getItem(`task-manage:finder-path:${persistenceKey}`) || "[]"
        );
        path = saved[0] === graph.rootId ? saved : [graph.rootId];
      } catch {
        path = [graph.rootId];
      }
    }
  });
  let columns = $derived(
    path.map((parentId, index) => ({
      parentId,
      index,
      rows: projectFinderRows(graph, parentId, path.slice(0, index)).filter(
        (r) => r.cycleReference || showArchived || !r.node.archived
      ),
    }))
  );
  function choose(row, index) {
    onselect?.(row);
    path = [...path.slice(0, index + 1), row.nodeId];
    if (persistenceKey)
      localStorage.setItem(`task-manage:finder-path:${persistenceKey}`, JSON.stringify(path));
    if (row.cycleReference) onshowgraph?.(row.nodeId);
  }
</script>

<div class="finder" aria-label="Finder">
  {#each columns as column}<section
      class="column"
      aria-label={`${graph.nodes[column.parentId]?.name || "ノード"} の子`}
    >
      {#if column.rows.length === 0}<p class="empty">
          子ノードはありません
        </p>{/if}{#each column.rows as row}<button
          type="button"
          class:selected={selectedOccurrenceId === row.occurrenceId}
          class:reference={row.cycleReference}
          onclick={() => choose(row, column.index)}
          ><span>{row.node.name}</span><span
            >{row.cycleReference ? "循環参照 ↗" : row.expandable ? "›" : ""}</span
          ></button
        >{/each}
    </section>{/each}
</div>

<style>
  .finder {
    display: flex;
    min-width: max-content;
    height: 100%;
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-md);
    overflow: hidden;
  }
  .column {
    width: 12rem;
    overflow: auto;
    border-right: 1px solid var(--theme-color-Sub-dark);
    padding: 0.2625rem;
  }
  .column:last-child {
    border-right: 0;
  }
  .column button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    border: 0;
    border-radius: var(--shape-sm);
    background: transparent;
    color: inherit;
    padding: 0.4125rem;
    text-align: left;
  }
  .column button.selected {
    background: var(--theme-color-Primary-main);
    color: white;
  }
  .column button.reference {
    font-style: italic;
  }
  .empty {
    padding: 0.45rem;
    color: var(--theme-color-Sub-main);
    font-size: 0.6rem;
  }
</style>
