<script context="module">
  // Multi-id drag payload. For a single-row drag this contains exactly one id;
  // for a multi-select drag it contains the top-level selected ancestors in DFS
  // order. Shared module state so dragOver/drop can see what's being dragged.
  let dragged_ids = [];
</script>

<script>
  import { createEventDispatcher } from "svelte";
  import { selected_ids } from "@stores/ui";
  import { tree_data } from "@features/tasks/stores/tree";
  import { getNode, getTopLevelSelection } from "@features/tasks/utils/tree_control";
  import { ripple } from "@lib/actions";
  import TaskName from "@features/tasks/components/TaskName.svelte";
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
  import DateInput from "@lib/primitives/DateInput.svelte";

  export let row;
  export let headers = [];
  export let selected = false;
  export let isAnchor = false;
  export let anyMultiSelected = false;
  export let isDark = false;
  export let canDrop = () => false;
  export let canMoveUp = false;
  export let canMoveDown = false;
  export let canIndent = false;
  export let canOutdent = false;
  export let canOpenTaskFolder = false;
  export let inheritedDueDate = "";
  export let nodePath = "";
  // Capabilities for bulk operations (used when this row is part of multi-selection).
  export let bulkCanMove = false;
  export let bulkCanTreeOp = false;
  export let bulkCanOutdent = false;

  const dispatch = createEventDispatcher();
  let taskName;

  $: id = row.id;
  $: node = row.node;
  $: depth = row.depth;
  $: data = node.data;
  $: hasChildren = row.hasChildren;
  $: expanded = row.expanded;

  // When this row is part of an active multi-selection, the right-click menu
  // routes actions to the bulk handlers. Use bulk capability flags so the menu
  // accurately reflects what the bulk handler can actually do.
  $: inMulti = selected && anyMultiSelected;
  $: effectiveCanMoveUp = inMulti ? bulkCanMove : canMoveUp;
  $: effectiveCanMoveDown = inMulti ? bulkCanMove : canMoveDown;
  $: effectiveCanIndent = inMulti ? bulkCanTreeOp : canIndent;
  $: effectiveCanOutdent = inMulti ? bulkCanTreeOp && bulkCanOutdent : canOutdent;
  $: selectionCountForMenu = inMulti ? $selected_ids.size : 1;

  let dragOverType;
  let isDragging = false;
  let isMenuOpen = false;

  const DAYS_5_MS = 5 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function getDueDateUrgency(dueDate, status) {
    if (!dueDate || status === "Completed" || status === "Canceled") return null;
    const diff = new Date(dueDate) - new Date() + DAY_MS - 1;
    if (diff < 0) return "overdue";
    if (diff < DAYS_5_MS) return "due-soon";
    return null;
  }

  $: dueDateUrgency = getDueDateUrgency(data["due date"] || inheritedDueDate, data["status"]);

  function displayCellValue(headerName) {
    const value = data[headerName];
    if (headerName === "attachments" && value == null) {
      return 0;
    }
    return Array.isArray(value) ? value.length : (value ?? "");
  }

  function select(e) {
    e.stopPropagation();
    dispatch("select", {
      id,
      shiftKey: !!e.shiftKey,
      ctrlKey: !!(e.ctrlKey || e.metaKey),
    });
  }

  function toggleCheckbox(e) {
    e.stopPropagation();
    dispatch("toggleCheckbox", {
      id,
      shiftKey: !!e.shiftKey,
      ctrlKey: !!(e.ctrlKey || e.metaKey),
    });
  }

  function toggle(e) {
    e.stopPropagation();
    dispatch("toggle", { id });
  }

  function commitData(key, value) {
    dispatch("commit", {
      id,
      patch: {
        [key]: value,
      },
    });
  }

  function dragStart(e) {
    isDragging = true;

    // Multi-row drag: only when this row is part of an existing multi-selection.
    // Otherwise it's a single-row drag (and the selection is left alone).
    const treeRoot = $tree_data?.data;
    if (treeRoot && $selected_ids.has(id) && $selected_ids.size > 1) {
      dragged_ids = getTopLevelSelection(treeRoot, $selected_ids);
    } else {
      dragged_ids = [id];
    }

    const name_tag = document.createElement("div");
    name_tag.classList.add("NameTag");
    name_tag.innerText = dragged_ids.length > 1 ? `${dragged_ids.length}件のタスク` : data.name;
    document.body.appendChild(name_tag);

    const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    e.dataTransfer.setDragImage(name_tag, -rem, -rem);
  }

  function dragEnd() {
    dragOverType = undefined;
    isDragging = false;
    document.querySelector(".NameTag")?.remove();
  }

  function dragOver(e) {
    e.preventDefault();

    if (dragged_ids.length === 0 || !dragged_ids.every((did) => canDrop(did, id))) {
      dragOverType = undefined;
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    // Split the row into three zones:
    //  - top  third  → insert as elder sibling (before)
    //  - mid  third  → append as child
    //  - bot  third  → insert as younger sibling (after)
    if (y <= h / 3) {
      dragOverType = "DragOverTop";
    } else if (y >= (h * 2) / 3) {
      dragOverType = "DragOverBelow";
    } else {
      dragOverType = "DragOverBottom";
    }
  }

  function dragLeave() {
    dragOverType = undefined;
  }

  function dragDrop() {
    if (dragged_ids.length === 0 || !dragOverType) {
      return;
    }

    let mode;
    if (dragOverType === "DragOverTop") mode = "insert";
    else if (dragOverType === "DragOverBelow") mode = "insert_after";
    else mode = "append";

    dispatch("reorder", {
      draggedIds: [...dragged_ids],
      targetId: id,
      mode,
    });

    dragOverType = undefined;
    dragged_ids = [];
  }

  function openContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    // If this row is part of an existing multi-selection, keep the selection
    // intact and let the menu act on the whole set. Otherwise reduce to this row.
    if (!$selected_ids.has(id)) {
      dispatch("select", { id, shiftKey: false, ctrlKey: false });
    }
    taskName?.openMenuAt({
      x: e.clientX,
      y: e.clientY,
    });
  }
</script>

<div
  {id}
  role="row"
  class:TableRow={true}
  class:Selected={selected}
  class:Anchor={isAnchor && anyMultiSelected}
  class:Dragging={isDragging}
  class:MenuOpen={isMenuOpen}
  class:DragOverTop={dragOverType === "DragOverTop"}
  class:DragOverBottom={dragOverType === "DragOverBottom"}
  class:DragOverBelow={dragOverType === "DragOverBelow"}
  class:OverdueRow={dueDateUrgency === "overdue"}
  class:DueSoonRow={dueDateUrgency === "due-soon"}
  use:ripple
  tabindex="0"
  draggable="true"
  aria-level={depth + 1}
  aria-selected={selected}
  aria-expanded={hasChildren ? expanded : undefined}
  on:click={select}
  on:keydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(e);
    }
  }}
  on:dragstart={dragStart}
  on:dragend={dragEnd}
  on:dragover={dragOver}
  on:dragleave={dragLeave}
  on:drop={dragDrop}
  on:contextmenu={openContextMenu}
>
  <div
    class="CheckboxCell"
    class:Visible={selected || anyMultiSelected}
    role="gridcell"
    tabindex="-1"
    draggable="false"
    on:click|stopPropagation
    on:keydown|stopPropagation
    on:dragstart|preventDefault|stopPropagation
  >
    {#if depth > 0}
      <input
        type="checkbox"
        class="RowCheckbox"
        checked={selected}
        aria-label="タスクを選択"
        tabindex="-1"
        on:click={toggleCheckbox}
        on:keydown|stopPropagation
      />
    {/if}
  </div>
  {#each headers as header, i}
    <div class:TableData={true} role="gridcell" style:z-index={i + 100}>
      {#if header.name == "name"}
        {#each Array(depth) as _}
          <div class:TreeLine={true} style="flex-shrink: 0"></div>
        {/each}
        {#if hasChildren}
          <button
            class:Expanded={expanded}
            class:ExpandButton={true}
            style="flex-shrink: 0"
            aria-label={expanded ? "Collapse task" : "Expand task"}
            on:click={toggle}
          >
            <svg viewBox="-12 0 32 32" xmlns="http://www.w3.org/2000/svg"
              ><path
                d="M0.88 23.28c-0.2 0-0.44-0.080-0.6-0.24-0.32-0.32-0.32-0.84 0-1.2l5.76-5.84-5.8-5.84c-0.32-0.32-0.32-0.84 0-1.2 0.32-0.32 0.84-0.32 1.2 0l6.44 6.44c0.16 0.16 0.24 0.36 0.24 0.6s-0.080 0.44-0.24 0.6l-6.4 6.44c-0.2 0.16-0.4 0.24-0.6 0.24z"
              ></path>
            </svg>
          </button>
        {:else}
          <div class:Space={true}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M9 8H15M9 12H15M9 16H12M8.2 21H15.8C16.9201 21 17.4802 21 17.908 20.782C18.2843 20.5903 18.5903 20.2843 18.782 19.908C19 19.4802 19 18.9201 19 17.8V6.2C19 5.0799 19 4.51984 18.782 4.09202C18.5903 3.71569 18.2843 3.40973 17.908 3.21799C17.4802 3 16.9201 3 15.8 3H8.2C7.0799 3 6.51984 3 6.09202 3.21799C5.71569 3.40973 5.40973 3.71569 5.21799 4.09202C5 4.51984 5 5.07989 5 6.2V17.8C5 18.9201 5 19.4802 5.21799 19.908C5.40973 20.2843 5.71569 20.5903 6.09202 20.782C6.51984 21 7.07989 21 8.2 21Z"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ></path>
            </svg>
          </div>
        {/if}
        <TaskName
          bind:this={taskName}
          text={data[header.name]}
          {hasChildren}
          {expanded}
          isRoot={depth === 0}
          canMoveUp={effectiveCanMoveUp}
          canMoveDown={effectiveCanMoveDown}
          canIndent={effectiveCanIndent}
          canOutdent={effectiveCanOutdent}
          {canOpenTaskFolder}
          selectionCount={selectionCountForMenu}
          {nodePath}
          on:commit={(e) => {
            commitData("name", e.detail.value);
          }}
          on:addBelow={() => {
            dispatch("addBelow", { id });
          }}
          on:addChild={() => {
            dispatch("addChild", { id });
          }}
          on:toggleExpand={() => {
            dispatch("toggle", { id });
          }}
          on:moveUp={() => {
            dispatch("moveUp", { id });
          }}
          on:moveDown={() => {
            dispatch("moveDown", { id });
          }}
          on:indentTask={() => {
            dispatch("indentTask", { id });
          }}
          on:outdentTask={() => {
            dispatch("outdentTask", { id });
          }}
          on:deleteTask={() => {
            dispatch("deleteTask", { id });
          }}
          on:copyTask={() => {
            dispatch("copyTask", { id });
          }}
          on:pasteTask={() => {
            dispatch("pasteTask", { id });
          }}
          on:menuVisibilityChange={({ detail }) => {
            isMenuOpen = detail.open;
          }}
          on:openTaskFolder={() => {
            dispatch("openTaskFolder", { id });
          }}
        />
      {:else if header.name == "status"}
        <StatusSelect
          status={data[header.name]}
          on:change={(e) => {
            commitData("status", e.detail.value);
          }}
        />
      {:else if header.name == "start date"}
        <DateInput
          is_dark={isDark}
          id="start-date"
          backgroundColor={"var(--backgroundColor)"}
          value={data[header.name]}
          on:change={(e) => {
            commitData("start date", e.target.value);
          }}
        />
      {:else if header.name == "due date"}
        <DateInput
          is_dark={isDark}
          id="due-date"
          backgroundColor={"var(--backgroundColor)"}
          value={data[header.name]}
          inheritedDate={inheritedDueDate}
          on:change={(e) => {
            commitData("due date", e.target.value);
          }}
        />
      {:else}
        <span class:TextOverFlow={true}>{displayCellValue(header.name)}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  button {
    border: none;
    padding: 0;
    margin: 0;
    border-radius: 0;
    background-color: transparent;
  }
  button:active {
    background-color: transparent;
  }
  :global(.NameTag) {
    position: absolute;
    top: -1000rem;
    display: inline;
    background-color: var(--theme-color-Primary-dark);
    border: 1px solid var(--theme-color-Primary-dark);
    color: var(--theme-color-Sub-main);
    padding: 0 var(--sp2);
  }
  .TableRow.Dragging {
    opacity: 0.6;
  }
  .TableRow.DragOverTop:before {
    /* Insert as elder sibling: blue line on top edge */
    border-top: 0.2rem solid var(--theme-color-Primary-dark);
    position: absolute;
    top: 0;
    left: 0;
    content: "";
    height: 0;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999999999;
    pointer-events: none;
  }
  .TableRow.DragOverBottom:before {
    /* Append as child: outline around the entire row */
    border: 0.2rem solid var(--theme-color-Primary-dark);
    position: absolute;
    top: 0;
    left: 0;
    content: "";
    height: 100%;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999999999;
    pointer-events: none;
  }
  .TableRow.DragOverBelow:before {
    /* Insert as younger sibling: blue line on bottom edge */
    border-bottom: 0.2rem solid var(--theme-color-Primary-dark);
    position: absolute;
    top: 0;
    left: 0;
    content: "";
    height: 100%;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999999999;
    pointer-events: none;
  }
  /* Row enter/leave animation when a node is expanded/collapsed.
     Pure CSS (no Svelte transitions) so virtualisation stays cheap. */
  @keyframes RowEnter {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .TableRow {
    animation: RowEnter 0.16s ease-out;
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    position: relative;
    height: 2.5rem;
    min-height: 2.5rem;
    max-height: 2.5rem;
    padding: 0;
    width: 100%;
    border-bottom: 1px solid var(--theme-color-Main-dark);
  }
  .TableRow.MenuOpen {
    z-index: 9999;
  }
  .TableRow {
    --backgroundColor: var(--theme-color-Main-light);
  }
  .TableRow.OverdueRow {
    --backgroundColor: color-mix(
      in srgb,
      var(--theme-color-Error-main) 10%,
      var(--theme-color-Main-light)
    );
  }
  .TableRow.DueSoonRow {
    --backgroundColor: color-mix(
      in srgb,
      var(--theme-color-Warning-main) 10%,
      var(--theme-color-Main-light)
    );
  }
  .TableRow:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
    z-index: 999;
  }
  .TableRow:hover {
    --backgroundColor: var(--theme-color-Main-main);
  }
  .TableRow.Selected {
    --backgroundColor: color-mix(
      in srgb,
      var(--theme-color-Primary-main) 14%,
      var(--theme-color-Main-light)
    );
  }
  .TableRow:hover .TableData {
    background-color: var(--backgroundColor);
  }
  .TableRow.Selected::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 0.2rem;
    height: 100%;
    background-color: var(--theme-color-Primary-main);
    z-index: 999;
    pointer-events: none;
  }
  .TableRow.Anchor::after {
    background-color: var(--theme-color-Primary-dark);
    width: 0.3rem;
  }
  .CheckboxCell {
    flex: 0 0 1.75rem;
    width: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    visibility: hidden;
    background-color: var(--backgroundColor);
    border-right: 1px solid var(--theme-color-Main-dark);
  }
  .TableRow:hover .CheckboxCell,
  .CheckboxCell.Visible {
    visibility: visible;
  }
  .RowCheckbox {
    width: 0.95rem;
    height: 0.95rem;
    margin: 0;
    cursor: pointer;
    accent-color: var(--theme-color-Primary-dark);
  }
  .TableData {
    display: flex;
    position: relative;
    box-sizing: border-box;
    height: 100%;
    min-width: 8rem;
    background-color: var(--backgroundColor);
    padding: var(--sp1) var(--sp2);
    align-items: center;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-md);
    border-right: 1px solid var(--theme-color-Main-dark);
  }
  .TableData:last-child {
    border-right: none;
  }
  .TableData span {
    flex: 1;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  /* Indent line — stretched to fill the full row height (including cell padding
     and the row's bottom border) so adjacent rows show one continuous vertical line */
  .TreeLine {
    position: relative;
    display: inline-block;
    align-self: stretch;
    width: 0.6rem;
    margin-top: calc(-1 * var(--sp1));
    margin-bottom: calc(-1 * var(--sp1) - 1px);
    margin-left: var(--sp1);
    border-left: 1px solid color-mix(in srgb, var(--theme-color-Sub-light) 40%, transparent);
    flex-shrink: 0;
  }
  .ExpandButton:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
    z-index: 999;
  }
  .ExpandButton {
    cursor: pointer;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    transform: rotate(0deg);
    /* Smooth chevron rotation while the rows themselves fade-in (see RowEnter
       keyframes below). Keep this longer than RowEnter so the chevron motion
       reads as the cause. */
    transition:
      transform 0.18s ease-out,
      background-color 0.12s ease;
  }
  .ExpandButton svg {
    width: 100%;
    height: 100%;
    fill: var(--theme-color-Sub-light);
  }
  .ExpandButton.Expanded {
    transform: rotate(90deg);
  }
  .Space {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .Space svg {
    stroke: var(--theme-color-Sub-light);
  }
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
</style>
