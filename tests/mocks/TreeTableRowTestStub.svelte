<script>
  /**
   * @typedef {Object} Props
   * @property {any} row
   * @property {any} [headers]
   * @property {boolean} [selected]
   * @property {boolean} [bulkSelectionActive]
   * @property {boolean} [isDark]
   * @property {any} [canDrop]
   * @property {boolean} [canMoveUp]
   * @property {boolean} [canMoveDown]
   * @property {boolean} [canIndent]
   * @property {boolean} [canOutdent]
   * @property {boolean} [canOpenTaskFolder]
   * @property {boolean} [isTabStop]
   * @property {boolean} [isEchoRow]
   * @property {boolean} [isPrimaryOccurrence]
   * @property {(detail?: any) => void} [onnavigate]
   * @property {(detail?: any) => void} [ontogglecheckbox]
   * @property {(detail?: any) => void} [onselect]
   * @property {(detail?: any) => void} [ontoggle]
   * @property {(detail?: any) => void} [onopentaskfolder]
   */

  /** @type {Props} */
  let {
    row,
    headers = [],
    selected = false,
    bulkSelectionActive = false,
    isDark = false,
    canDrop = () => false,
    canMoveUp = false,
    canMoveDown = false,
    canIndent = false,
    canOutdent = false,
    canOpenTaskFolder = false,
    isTabStop = false,
    isEchoRow = false,
    isPrimaryOccurrence = true,
    onnavigate,
    ontogglecheckbox,
    onselect,
    ontoggle,
    onopentaskfolder,
  } = $props();

  const NAVIGATION_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
  ]);
</script>

<div
  id={isPrimaryOccurrence ? row.id : undefined}
  data-node-id={row.id}
  data-row-path={row.path}
  role="row"
  class="TableRow"
  data-testid={"row-" + row.id}
  data-dark={isDark ? "true" : "false"}
  data-can-drop={canDrop("", "") ? "true" : "false"}
  data-can-move-up={canMoveUp ? "true" : "false"}
  data-can-move-down={canMoveDown ? "true" : "false"}
  data-can-indent={canIndent ? "true" : "false"}
  data-can-outdent={canOutdent ? "true" : "false"}
  data-selected={selected ? "true" : "false"}
  data-tab-stop={isTabStop ? "true" : "false"}
  data-echo={isEchoRow ? "true" : "false"}
  tabindex={isTabStop ? 0 : -1}
  onkeydown={(e) => {
    if (!NAVIGATION_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    onnavigate?.({ id: row.id, path: row.path, key: e.key, shiftKey: e.shiftKey });
  }}
>
  <div class="CheckboxCell" style="width: 28px;">
    {#if row.depth > 0}
      <input
        type="checkbox"
        data-testid={"bulk-select-" + row.id}
        checked={bulkSelectionActive && selected}
        onclick={() => ontogglecheckbox?.({ id: row.id })}
      />
    {/if}
  </div>
  {#each headers as header}
    <div class="TableData" style="width: 100px;">
      {#if header.name === "name"}
        <span>{row.node.data.name}</span>
        <button
          type="button"
          data-testid={"select-" + row.id}
          onclick={() => {
            onselect?.({ id: row.id, path: row.path });
          }}
        >
          select
        </button>
        {#if row.hasChildren}
          <button
            type="button"
            data-testid={"toggle-" + row.id}
            onclick={() => {
              ontoggle?.({ id: row.id, path: row.path });
            }}
          >
            {row.expanded ? "collapse" : "expand"}
          </button>
        {/if}
        {#if canOpenTaskFolder}
          <button
            type="button"
            data-testid={"open-folder-" + row.id}
            onclick={() => {
              onopentaskfolder?.({ id: row.id });
            }}
          >
            open folder
          </button>
        {/if}
      {:else}
        <span data-testid={"cell-" + row.id + "-" + header.name}>
          {Array.isArray(row.node.data[header.name])
            ? row.node.data[header.name].length
            : (row.node.data[header.name] ?? "")}
        </span>
      {/if}
    </div>
  {/each}
</div>
