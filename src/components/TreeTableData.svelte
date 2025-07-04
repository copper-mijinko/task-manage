<script context="module">
  let dragged_id; // Share this in TreeTableData components.
</script>

<script>
  import { onMount } from "svelte";
  import { tree_data, table_selected_id, closed_node_ids } from "../stores.js";
  import {
    isChild,
    reorderTree,
    setNode,
    getNode,
  } from "../common/tree_control.ts";
  import { ripple } from "../common/common.js";
  import { theme } from "../stores.js";
  import TextInput from "./TextInput.svelte";
  import StatusSelect from "./StatusSelect.svelte";
  import DateInput from "./DateInput.svelte";

  // node;
  export let node;
  $: id = node.id;
  $: data = node.data;
  $: children = node.children;

  export let depth = 0;

  let table_row; //Bind

  $: HasChildren = children.length > 0;
  $: Expanded = !$closed_node_ids.has(id);
  $: Selected = $table_selected_id == id;

  $: is_dark = $theme == "dark";

  function select(e) {
    e.stopPropagation();
    $table_selected_id = id;
  }

  function toggle(e) {
    e.stopPropagation();
    console.log("ノード開閉操作:", id, $closed_node_ids.has(id));
    try {
      if ($closed_node_ids.has(id)) {
        console.log("閉じたノードを開く:", id);
        closed_node_ids.delete(id);
      } else {
        console.log("開いたノードを閉じる:", id);
        closed_node_ids.add(id);
      }
      // 状態更新の確認
      setTimeout(() => {
        console.log("操作後の状態:", id, $closed_node_ids.has(id));
      }, 10);
    } catch (error) {
      console.error("ノード開閉処理エラー:", error);
    }
  }

  const changeData = (node, key, value) => {
    const id = node.id;
    node = getNode(id, $tree_data.data);
    node = { ...node, data: { ...node.data, [key]: value } };
    let data = setNode(node, $tree_data.data);
    $tree_data = { ...$tree_data, data: data };
  };

  onMount(() => {
    // set z-index
    let datas = table_row.querySelectorAll(".TableData");
    datas.forEach((data, index) => {
      data.style.zIndex = index + 100;
    });

    // set drag'n drop
    setDND();
  });

  // drag'n drop
  let dragOverType;
  function dragStart(e) {
    this.classList.add("Dragging");

    const name_text = this.querySelector(
      "div:first-child div:last-child input",
    ).value;
    const name_tag = document.createElement("div");
    name_tag.classList.add("NameTag");
    name_tag.innerText = name_text;
    document.body.appendChild(name_tag);

    const rem = parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    );
    e.dataTransfer.setDragImage(name_tag, -rem, -rem);

    dragged_id = e.currentTarget.id;
  }

  function dragEnd() {
    dragOverType = undefined;
    this.classList.remove("Dragging");
    document.querySelector(".NameTag").remove();
  }

  function dragOver(e) {
    e.preventDefault();
    if (
      !this.classList.contains("Dragging") &&
      !isChild(this.id, dragged_id, $tree_data.data) &&
      this.id != $tree_data.data.id
    ) {
      const rect = this.getBoundingClientRect();
      const y = e.clientY;
      if (y <= rect.top + rect.height / 2) {
        if (dragOverType != "DragOverTop") {
          dragOverType = "DragOverTop";
          this.classList.remove("DragOverBottom");
          this.classList.add("DragOverTop");
        }
      } else if (dragOverType != "DragOverBottom") {
        dragOverType = "DragOverBottom";
        this.classList.remove("DragOverTop");
        this.classList.add("DragOverBottom");
      }
    }
  }

  function dragLeave() {
    dragOverType = undefined;
    this.classList.remove("DragOverTop");
    this.classList.remove("DragOverBottom");
  }

  function dragDrop() {
    switch (dragOverType) {
      case "DragOverTop":
        $tree_data.data = reorderTree(
          dragged_id,
          this.id,
          $tree_data.data,
          "insert",
        );
        this.classList.remove("DragOverTop");
        break;
      case "DragOverBottom":
        $tree_data.data = reorderTree(
          dragged_id,
          this.id,
          $tree_data.data,
          "append",
        );
        this.classList.remove("DragOverBottom");
        break;
    }
    dragOverType = undefined;
    dragged_id = undefined;
  }

  function setDND() {
    // drag item
    table_row.addEventListener("dragstart", dragStart);
    table_row.addEventListener("dragend", dragEnd);

    // drop area
    table_row.addEventListener("dragover", dragOver);
    table_row.addEventListener("dragleave", dragLeave);
    table_row.addEventListener("drop", dragDrop);
  }
</script>

<button
  bind:this={table_row}
  {id}
  class:TableRow={true}
  class:Selected
  use:ripple
  on:click={select}
  draggable="true"
>
  {#each $tree_data.headers as header, i}
    <div class:TableData={true} class:HasChildren>
      {#if header.name == "name"}
        {#each [...Array(depth)].map((_, i) => i) as i}
          <div class:TreeLine={true} style="flex-shrink: 0" />
        {/each}
        {#if HasChildren}
          <button
            class:Expanded
            class:ExpandButton={true}
            style="flex-shrink: 0"
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
        <TextInput
          text={data[header.name]}
          on:input={(e) => {
            changeData(node, "name", e.target.value);
          }}
        />
      {:else if header.name == "status"}
        <StatusSelect {node} status={data[header.name]} />
      {:else if header.name == "due date"}
        <DateInput
          {is_dark}
          id="due-date"
          backgroundColor={"var(--backgroundColor)"}
          value={data[header.name]}
          on:change={(e) => {
            changeData(node, "due date", e.target.value);
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
</button>
{#if Expanded}
  {#each children as child}
    <div style="display: flex; flex-direction: column">
      <svelte:self depth={depth + 1} node={child} />
    </div>
  {/each}
{/if}

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
  .TableRow:global(.Dragging) {
    opacity: 0.6;
  }
  .TableRow:global(.DragOverTop):before {
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
  .TableRow:global(.DragOverBottom):before {
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
