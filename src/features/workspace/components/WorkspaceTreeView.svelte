<script>
  import { projectGraphTree } from "@features/workspace/utils/graph_projection";
  /**
   * @typedef {Object} Props
   * @property {any} graph
   * @property {string} [selectedOccurrenceId]
   * @property {boolean} [showArchived]
   * @property {string} [persistenceKey]
   * @property {(detail?: any) => void} [onselect]
   */

  /** @type {Props} */
  let {
    graph,
    selectedOccurrenceId = "",
    showArchived = false,
    persistenceKey = "",
    onselect,
  } = $props();
  let expanded = $state(new Set()),
    restored = $state("");
  $effect.pre(() => {
    if (persistenceKey && restored !== persistenceKey) {
      restored = persistenceKey;
      try {
        expanded = new Set(
          JSON.parse(localStorage.getItem(`task-manage:tree-expanded:${persistenceKey}`) || "[]")
        );
      } catch {
        expanded = new Set();
      }
    }
  });
  let projection = $derived(projectGraphTree(graph));
  let visible = $derived(
    projection
      .filter(
        (r) => r.nodeId === graph.rootId || r.cycleReference || showArchived || !r.node.archived
      )
      .filter(
        (r) =>
          r.depth === 0 ||
          r.occurrenceId
            .split("/")
            .slice(0, -1)
            .every((_, i, a) => expanded.has(a.slice(0, i + 1).join("/")))
      )
  );
  function toggle(r, e) {
    e.stopPropagation();
    if (!r.expandable) return;
    const n = new Set(expanded);
    if (n.has(r.occurrenceId)) n.delete(r.occurrenceId);
    else n.add(r.occurrenceId);
    expanded = n;
    if (persistenceKey)
      localStorage.setItem(`task-manage:tree-expanded:${persistenceKey}`, JSON.stringify([...n]));
  }
</script>

<div class="tree" role="tree" aria-label="ツリー">
  {#each visible as row}<div
      class="row"
      class:selected={selectedOccurrenceId === row.occurrenceId}
      class:reference={row.cycleReference}
      role="treeitem"
      aria-selected={selectedOccurrenceId === row.occurrenceId}
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? expanded.has(row.occurrenceId) : undefined}
      style={`padding-left:${8 + row.depth * 20}px`}
    >
      <button
        class="twisty"
        type="button"
        aria-label={expanded.has(row.occurrenceId) ? "折りたたむ" : "展開する"}
        disabled={!row.expandable}
        onclick={(e) => toggle(row, e)}
        >{row.cycleReference
          ? "↪"
          : row.expandable
            ? expanded.has(row.occurrenceId)
              ? "▾"
              : "▸"
            : "·"}</button
      ><button class="label" type="button" onclick={() => onselect?.(row)}
        >{row.node.name}{#if row.cycleReference}<small>循環参照 — グラフで表示</small
          >{/if}{#if row.node.archived}<small>アーカイブ</small>{/if}</button
      >
    </div>{/each}
</div>

<style>
  .tree {
    max-width: 39rem;
  }
  .row {
    display: flex;
    align-items: center;
    border-radius: var(--shape-sm);
  }
  .row.selected {
    background: color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
  }
  .row.reference {
    font-style: italic;
  }
  .twisty,
  .label {
    border: 0;
    background: transparent;
    color: inherit;
    min-height: 1.6875rem;
  }
  .twisty {
    width: 1.5rem;
    padding: 0;
  }
  .label {
    flex: 1;
    text-align: left;
    cursor: pointer;
  }
  .label small {
    margin-left: 0.525rem;
    color: var(--theme-color-Sub-main);
  }
</style>
