<script>
  import { tick } from "svelte";
  import { table_selected_id } from "../stores.ts";
  import { ripple, tooltip } from "../common/common.js";
  import IconButton from "./IconButton.svelte";
  import Button from "./Button.svelte";
  import Memo from "./Memo.svelte";
  import Dialog from "./Dialog.svelte";

  export let memo = [];
  export let saveMemo;
  export let addMemo;
  export let deleteMemo;
  export let renameMemo;
  export let reorderMemo;
  export let disabled = false;
  export let workspaceProjectDir = null;
  export let taskId = null;

  let show_confirm = false;
  let name_confirm = "";
  let selectedMemoIndex = 0;
  let previousTaskId;
  let newMemoTitle = "memo";
  let inputs = Array(100).fill(null);
  let edit = false;
  const hasSelectedMemo = () => Boolean(memo[selectedMemoIndex]);

  const toggle_confirm = () => {
    show_confirm = !show_confirm;
  };

  const callback_confirm = () => {
    if (deleteMemo(selectedMemoIndex)) {
      selectedMemoIndex = selectedMemoIndex == 0 ? 0 : selectedMemoIndex - 1;
      edit = false;
    }
  };

  function normalizeMemoTitle(title) {
    return String(title || "")
      .trim()
      .toLocaleLowerCase();
  }

  const selectMemoByTitle = (title) => {
    const nextIndex = memo.findIndex(
      (entry) => normalizeMemoTitle(entry.title) === normalizeMemoTitle(title)
    );

    if (nextIndex >= 0) {
      selectedMemoIndex = nextIndex;
      edit = false;
      return true;
    }

    return false;
  };

  const toggleRename = async () => {
    if (memo.length > 0) {
      edit = !edit;
      if (edit) {
        await tick();
        inputs[selectedMemoIndex]?.focus();
      }
    }
  };

  const createMemo = async () => {
    if (addMemo(newMemoTitle)) {
      await tick();
      selectedMemoIndex = memo.length - 1;
    }
  };

  $: if ($table_selected_id !== previousTaskId) {
    previousTaskId = $table_selected_id;
    selectedMemoIndex = 0;
    edit = false;
  }

  $: if (selectedMemoIndex >= memo.length && memo.length > 0) {
    selectedMemoIndex = memo.length - 1;
  }

  $: editedContent = memo.length > selectedMemoIndex ? memo[selectedMemoIndex].content : "";
  $: selectedMemo = memo[selectedMemoIndex];

  let draggingIndex = -1;
  let dragOverIndex = -1;
  let dragOverSide = null; // "left" | "right"

  const handleDragStart = (e, i) => {
    draggingIndex = i;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, i) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    dragOverSide = e.clientX <= rect.left + rect.width / 2 ? "left" : "right";
    dragOverIndex = i;
  };

  const handleDragLeave = () => {
    dragOverIndex = -1;
    dragOverSide = null;
  };

  const handleDrop = (e, i) => {
    e.preventDefault();
    if (draggingIndex !== -1 && draggingIndex !== i) {
      const rect = e.currentTarget.getBoundingClientRect();
      const side = e.clientX <= rect.left + rect.width / 2 ? "left" : "right";
      let insertAt = side === "left" ? i : i + 1;
      if (draggingIndex < i) insertAt -= 1;
      reorderMemo(draggingIndex, insertAt);
      selectedMemoIndex = insertAt;
    }
    draggingIndex = -1;
    dragOverIndex = -1;
    dragOverSide = null;
  };

  const handleDragEnd = () => {
    draggingIndex = -1;
    dragOverIndex = -1;
    dragOverSide = null;
  };
</script>

<div class="container">
  <div class="memotab-container">
    <div class="memotab">
      {#if memo.length == 0}
        <span class="memotab-item">{"Tabs here"}</span>
      {:else}
        {#each memo as memo, i (memo.id)}
          <button
            use:ripple={{ duration: 350, color: "var(--theme-color-Sub-main)" }}
            class="memotab-item"
            class:selected={i == selectedMemoIndex}
            class:drop-left={dragOverIndex === i && draggingIndex !== i && dragOverSide === "left"}
            class:drop-right={dragOverIndex === i &&
              draggingIndex !== i &&
              dragOverSide === "right"}
            aria-label={`Select memo ${memo.title}`}
            draggable="true"
            on:click={() => {
              selectedMemoIndex = i;
            }}
            on:dragstart={(e) => handleDragStart(e, i)}
            on:dragover={(e) => handleDragOver(e, i)}
            on:dragleave={handleDragLeave}
            on:drop={(e) => handleDrop(e, i)}
            on:dragend={handleDragEnd}
          >
            <input
              type="text"
              value={memo.title}
              bind:this={inputs[i]}
              disabled={!edit || i != selectedMemoIndex}
              on:blur={() => {
                edit = false;
              }}
              on:input={(e) => {
                renameMemo(e.target.value, selectedMemoIndex);
              }}
              on:click={(e) => {
                if (edit && i == selectedMemoIndex) {
                  e.stopPropagation();
                }
              }}
              on:keydown={(e) => {
                if (e.key == "Enter") {
                  edit = false;
                }
              }}
              use:tooltip={{
                color: "var(--theme-color-Main-main)",
                backgroundColor: "var(--theme-color-Sub-main)",
                wrapped: true,
              }}
            />
          </button>
        {/each}
      {/if}
    </div>
    <div class="memotab-control">
      <IconButton
        tooltipContent="Add a memo."
        ariaLabel="Add a memo"
        {disabled}
        activeColor={"var(--theme-color-Primary-dark)"}
        normalColor={"var(--theme-color-Primary-main)"}
        on:click={createMemo}
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
          ><path
            d="M12 5V19M5 12H19"
            stroke="var(--theme-color-Main-main)"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path></svg
        >
      </IconButton>
      <IconButton
        tooltipContent="Delete the selected memo."
        ariaLabel="Delete the selected memo"
        disabled={disabled || memo.length === 0}
        activeColor={"var(--theme-color-Error-dark)"}
        normalColor={"var(--theme-color-Error-main)"}
        on:click={() => {
          if (!hasSelectedMemo()) {
            return;
          }
          show_confirm = true;
          name_confirm = memo[selectedMemoIndex].title;
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="var(--theme-color-Main-main)"
          viewBox="0 0 48 48"
          ><path
            stroke="var(--theme-color-Main-main)"
            d="M13.05 42q-1.25 0-2.125-.875T10.05 39V10.5H8v-3h9.4V6h13.2v1.5H40v3h-2.05V39q0 1.2-.9 2.1-.9.9-2.1.9Zm21.9-31.5h-21.9V39h21.9Zm-16.6 24.2h3V14.75h-3Zm8.3 0h3V14.75h-3Zm-13.6-24.2V39Z"
          /></svg
        >
      </IconButton>
      <Button
        disabled={disabled || memo.length === 0}
        variant={"text"}
        activeColor={"var(--theme-color-Info-dark)"}
        normalColor={"var(--theme-color-Info-main)"}
        on:click={toggleRename}
        content="rename"
      />
    </div>
  </div>

  <div class="memotab-content">
    {#if selectedMemo}
      {#key `${$table_selected_id ?? "none"}:${selectedMemoIndex}`}
        <Memo
          saveMemo={(editedContent) => saveMemo(editedContent, selectedMemoIndex)}
          content={editedContent}
          memoTitles={memo.map((entry) => entry.title)}
          openMemoLink={selectMemoByTitle}
          {workspaceProjectDir}
          {taskId}
        />
      {/key}
    {:else}
      <textarea placeholder="No page" disabled></textarea>
    {/if}
  </div>
</div>

<Dialog
  show={show_confirm}
  toggle={toggle_confirm}
  header="Confirm."
  content={`Do you really delete "${name_confirm}"?`}
  callback={callback_confirm}
/>

<style>
  button {
    border: none;
    padding: 0;
    margin: 0;
    border-radius: 0;
    background-color: transparent;
  }

  button:focus-visible {
    outline: auto;
  }

  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
  }

  .memotab-container {
    display: flex;
    flex-direction: row;
    height: 3rem;
    width: 100%;
  }

  .memotab {
    display: flex;
    flex-direction: row;
    height: 2rem;
    padding: 0.5rem;
    overflow-x: auto;
    flex: 1;
  }

  .memotab-control {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    margin-left: auto;
  }

  input {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--theme-color-Sub-main);
    padding: 0;
    margin: 0;
    width: 100%;
    text-align: center;
  }

  input:focus {
    outline: auto;
    cursor: text !important;
  }

  input:disabled {
    color: var(--theme-color-Sub-main);
    -webkit-text-fill-color: var(--theme-color-Sub-main);
    background-color: transparent;
    opacity: 1;
    pointer-events: none;
  }

  input:hover {
    cursor: pointer;
  }

  .memotab-item {
    display: flex;
    box-sizing: border-box;
    height: 100%;
    min-width: 5rem;
    max-width: 10rem;
    padding: 0.5rem;
    flex: 1;
    justify-content: center;
    align-items: center;
    color: var(--theme-color-Sub-main);
  }

  span.memotab-item {
    display: inline-block;
    vertical-align: middle;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    line-height: 100%;
    cursor: default !important;
  }

  .memotab-item:hover {
    cursor: pointer;
  }

  .selected {
    border-bottom: 0.2rem solid var(--theme-color-Accent-main);
  }

  .drop-left {
    border-left: 0.15rem solid var(--theme-color-Accent-main);
  }

  .drop-right {
    border-right: 0.15rem solid var(--theme-color-Accent-main);
  }

  .memotab-content {
    display: flex;
    box-sizing: border-box;
    height: calc(100% - 5.5rem);
    flex: 1;
    overflow: hidden;
  }

  .memotab-content textarea {
    height: 100%;
    width: 100%;
    flex: 1;
    resize: none;
  }
</style>
