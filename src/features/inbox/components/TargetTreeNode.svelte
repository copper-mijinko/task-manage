<script>
  import { createEventDispatcher } from "svelte";
  import { ripple } from "@lib/actions";

  /**
   * Single tree node row inside ProjectTargetPicker. Recurses into its own
   * children. Lightweight by design — we do not need full TreeTable
   * affordances (D&D, gantt, filters, sort) here, just expand/collapse and
   * selection.
   *
   * @typedef {{ id: string; data: { name?: string }; children?: TreeData[] }} TreeData
   */

  /** @type {TreeData} */
  export let node;
  /** Depth in the tree (0 for the project root). */
  export let depth = 0;
  /** Currently-selected parent id within the picker. */
  export let selectedId = null;
  /** Set of node ids whose children are currently expanded. */
  export let expandedIds;
  /** Optional filter: when set, only matching nodes (and their ancestors) are visible. */
  export let filterMatches = null;
  /** True when this node is the project root row (visually distinct). */
  export let isRoot = false;

  const dispatch = createEventDispatcher();

  $: hasChildren = Array.isArray(node.children) && node.children.length > 0;
  $: isExpanded = expandedIds.has(node.id);
  $: isSelected = selectedId === node.id;
  $: name = node.data?.name || "(no name)";

  // When filtering, hide nodes that don't match AND have no matching
  // descendants. Ancestors of matches stay visible to preserve context.
  $: hidden = (() => {
    if (!filterMatches) return false;
    return !filterMatches.has(node.id);
  })();

  function toggleExpand(e) {
    e.stopPropagation();
    if (!hasChildren) return;
    const next = new Set(expandedIds);
    if (next.has(node.id)) {
      next.delete(node.id);
    } else {
      next.add(node.id);
    }
    dispatch("expandedchange", next);
  }

  function selectThis() {
    dispatch("select", node.id);
  }
</script>

{#if !hidden}
  <button
    type="button"
    class="TreeRow"
    class:Root={isRoot}
    class:Selected={isSelected}
    style:padding-left={`${0.5 + depth * 1.25}rem`}
    on:click={selectThis}
    use:ripple
    aria-current={isSelected ? "true" : undefined}
  >
    {#if hasChildren}
      <span
        class="Chevron"
        class:Expanded={isExpanded}
        on:click={toggleExpand}
        on:keydown={(e) => {
          if (e.key === "Enter" || e.key === " ") toggleExpand(e);
        }}
        role="button"
        tabindex="0"
        aria-label={isExpanded ? "折りたたむ" : "展開"}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M4 2L8 6L4 10"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    {:else}
      <span class="Spacer" aria-hidden="true"></span>
    {/if}
    <span class="NodeName" title={name}>{name}</span>
    {#if isRoot}
      <span class="RootBadge">ルート</span>
    {/if}
  </button>

  {#if hasChildren && (isExpanded || filterMatches)}
    {#each node.children as child (child.id)}
      <svelte:self
        node={child}
        depth={depth + 1}
        {selectedId}
        {expandedIds}
        {filterMatches}
        on:select
        on:expandedchange
      />
    {/each}
  {/if}
{/if}

<style>
  .TreeRow {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    width: 100%;
    min-height: 1.9rem;
    padding-right: var(--sp2);
    border: none;
    background-color: transparent;
    color: var(--theme-color-Sub-main);
    text-align: left;
    cursor: pointer;
    font-size: var(--font-body-sm);
  }
  .TreeRow:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 8%, transparent);
  }
  .TreeRow:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
  }
  .TreeRow.Root {
    font-weight: 600;
    background-color: color-mix(in srgb, var(--theme-color-Info-main) 8%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 14%, transparent);
  }
  .TreeRow.Selected {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 20%, transparent);
    color: var(--theme-color-Primary-dark);
    font-weight: 600;
  }
  .TreeRow.Selected.Root {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 24%, transparent);
  }
  .Chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 55%, transparent);
    transition: transform 0.12s ease;
    cursor: pointer;
    border-radius: var(--shape-xs);
  }
  .Chevron:hover {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    color: var(--theme-color-Sub-main);
  }
  .Chevron.Expanded {
    transform: rotate(90deg);
  }
  .Chevron svg {
    width: 0.75rem;
    height: 0.75rem;
  }
  .Spacer {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .NodeName {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .RootBadge {
    flex-shrink: 0;
    padding: 0 var(--sp1);
    border-radius: var(--shape-pill);
    background-color: color-mix(in srgb, var(--theme-color-Info-main) 18%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-sm);
    font-weight: 600;
  }
</style>
