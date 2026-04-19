<script context="module">
  let dragged_id;
</script>

<script>
  import { createEventDispatcher } from "svelte";
  import { selected_id } from "../stores.ts";
  import { ripple } from "../common/common.js";
  import TaskName from "./TaskName.svelte";
  import StatusSelect from "./StatusSelect.svelte";
  import DateInput from "./DateInput.svelte";

  export let row;
  export let headers = [];
  export let selected = false;
  export let isDark = false;
  export let canDrop = () => false;
  export let canMoveUp = false;
  export let canMoveDown = false;
  export let canIndent = false;
  export let canOutdent = false;

  const dispatch = createEventDispatcher();
  let taskName;

  $: id = row.id;
  $: node = row.node;
  $: depth = row.depth;
  $: data = node.data;
  $: hasChildren = row.hasChildren;
  $: expanded = row.expanded;

  let dragOverType;
  let isDragging = false;
  let isMenuOpen = false;

  function select(e) {
    e.stopPropagation();
    dispatch("select", { id });
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

  function openTaskDetailInWindow(taskText) {
    try {
      if (window.electronAPI && window.electronAPI.openTaskDetailWindow) {
        window.electronAPI.openTaskDetailWindow({
          projectId: $selected_id,
          taskId: id,
          taskName: taskText,
        });
      }
    } catch {
      // ignore error opening task detail window
    }
  }

  function dragStart(e) {
    isDragging = true;

    const name_tag = document.createElement("div");
    name_tag.classList.add("NameTag");
    name_tag.innerText = data.name;
    document.body.appendChild(name_tag);

    const rem = parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    );
    e.dataTransfer.setDragImage(name_tag, -rem, -rem);

    dragged_id = id;
  }

  function dragEnd() {
    dragOverType = undefined;
    isDragging = false;
    document.querySelector(".NameTag")?.remove();
  }

  function dragOver(e) {
    e.preventDefault();

    if (!canDrop(dragged_id, id)) {
      dragOverType = undefined;
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY;
    dragOverType =
      y <= rect.top + rect.height / 2 ? "DragOverTop" : "DragOverBottom";
  }

  function dragLeave() {
    dragOverType = undefined;
  }

  function dragDrop() {
    if (!dragged_id || !dragOverType) {
      return;
    }

    dispatch("reorder", {
      draggedId: dragged_id,
      targetId: id,
      mode: dragOverType === "DragOverTop" ? "insert" : "append",
    });

    dragOverType = undefined;
    dragged_id = undefined;
  }

  function openContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    select(e);
    taskName?.openMenuAt({
      x: e.clientX,
      y: e.clientY,
    });
  }
</script>

<div
  {id}
  role="button"
  class:TableRow={true}
  class:Selected={selected}
  class:Dragging={isDragging}
  class:MenuOpen={isMenuOpen}
  class:DragOverTop={dragOverType === "DragOverTop"}
  class:DragOverBottom={dragOverType === "DragOverBottom"}
  use:ripple
  tabindex="0"
  draggable="true"
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
  {#each headers as header, i}
    <div class:TableData={true} style:z-index={i + 100}>
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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
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
          {canMoveUp}
          {canMoveDown}
          {canIndent}
          {canOutdent}
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
          on:menuVisibilityChange={({ detail }) => {
            isMenuOpen = detail.open;
          }}
          on:openTaskDetailWindow={({ detail }) => {
            openTaskDetailInWindow(detail.text);
          }}
        />
      {:else if header.name == "status"}
        <StatusSelect
          status={data[header.name]}
          on:change={(e) => {
            commitData("status", e.target.value);
          }}
        />
      {:else if header.name == "due date"}
        <DateInput
          is_dark={isDark}
          id="due-date"
          backgroundColor={"var(--backgroundColor)"}
          value={data[header.name]}
          on:change={(e) => {
            commitData("due date", e.target.value);
          }}
        />
      {:else}
        <span class:TextOverFlow={true}
          >{header.name == "memo"
            ? data[header.name].length
            : data[header.name]}</span
        >
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
  :global(.NameTag) {
    position: absolute;
    top: -1000rem;
    display: inline;
    background-color: var(--theme-color-Accent-dark);
    border: 1px solid var(--theme-color-Accent-dark);
    color: var(--theme-color-Sub-main);
    padding: 0 0.5rem;
  }
  .TableRow.Dragging {
    opacity: 0.6;
  }
  .TableRow.DragOverTop:before {
    border-top: 0.2rem solid var(--theme-color-Accent-dark);
    position: absolute;
    content: "";
    height: 2rem;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999999999;
    pointer-events: none;
  }
  .TableRow.DragOverBottom:before {
    border: 0.2rem solid var(--theme-color-Accent-dark);
    position: absolute;
    content: "";
    height: 2rem;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999999999;
    pointer-events: none;
  }
  .TableRow {
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    position: relative;
    height: 2rem;
    padding: 0;
    width: 100%;
  }
  .TableRow.MenuOpen {
    z-index: 9999;
  }
  .TableRow :global(*) {
    --backgroundColor: var(--theme-color-Main-light);
  }
  .TableRow:focus-visible {
    outline: auto;
    z-index: 999;
  }
  .TableRow:hover :global(*),
  .TableRow.Selected :global(*) {
    --backgroundColor: var(--theme-color-Main-main);
  }
  .TableRow:hover .TableData {
    background-color: var(--backgroundColor);
  }
  .TableRow:hover::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 0.2rem;
    height: 100%;
    background-color: var(--theme-color-Accent-dark);
    z-index: 999;
  }
  .TableRow.Selected::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 0.2rem;
    height: 100%;
    background-color: var(--theme-color-Accent-dark);
    z-index: 999;
  }
  .TableData {
    display: flex;
    position: relative;
    box-sizing: border-box;
    height: 100%;
    min-width: 4rem;
    background-color: var(--backgroundColor);
    padding: 0 0.5rem;
    align-items: center;
    color: var(--theme-color-Sub-light);
  }
  .TableData span {
    flex: 1;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .TreeLine {
    position: relative;
    display: inline-block;
    height: 100%;
    width: 0.6rem;
    margin-left: 0.3rem;
    border-left: 1px solid gray;
  }
  .ExpandButton:focus-visible {
    outline: auto;
    z-index: 999;
  }
  .ExpandButton {
    cursor: pointer;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    transform: rotate(0deg);
    transition: all 0.05s ease;
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
