<script>
  import { tick } from "svelte";
  import { table_selected_id } from "../stores.ts";
  import { ripple, tooltip } from "../common/common.js";
  import IconButton from "./IconButton.svelte";
  import Button from "./Button.svelte";
  import Memo from "./Memo.svelte";
  import Dialog from "./Dialog.svelte";

  let show_confirm = false;
  const toggle_confirm = () => {
    show_confirm = !show_confirm;
  };
  let name_confirm = "";
  const callback_confirm = () => {
    if (deleteMemo(selectedMemoIndex)) {
      selectedMemoIndex = selectedMemoIndex == 0 ? 0 : selectedMemoIndex - 1;
    }
  };

  export let memo = [];
  export let saveMemo;
  export let addMemo;
  export let deleteMemo;
  export let renameMemo;
  export let disabled = false;
  export let workspaceProjectDir = null;
  export let taskId = null;

  let selectedMemoIndex = 0;
  let previousTaskId;

  $: if ($table_selected_id !== previousTaskId) {
    previousTaskId = $table_selected_id;
    selectedMemoIndex = 0;
    edit = false;
  }

  $: if (selectedMemoIndex >= memo.length && memo.length > 0) {
    selectedMemoIndex = memo.length - 1;
  }

  $: editedContent = memo.length > selectedMemoIndex ? memo[selectedMemoIndex].content : "";

  let newMemoTitle = "memo";
  let inputs = Array(100).fill(null);
  let edit = false;
  const hasSelectedMemo = () => Boolean(memo[selectedMemoIndex]);

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

  const toggle = async () => {
    if (memo.length > 0) {
      edit = !edit;
      if (edit) {
        await tick();
        if (inputs[selectedMemoIndex]) {
          inputs[selectedMemoIndex].focus();
        }
      }
    }
  };

  const createFirstMemo = async () => {
    if (addMemo(newMemoTitle)) {
      await tick();
      selectedMemoIndex = memo.length - 1;
    }
  };
</script>

<div class="container">
  <div class="memotab-container">
    <div class="memotab">
      {#if memo.length == 0}
        <span class="memotab-item empty-tab-label">No notes yet</span>
      {:else}
        {#each memo as memo, i (memo.id)}
          <button
            use:ripple={{ duration: 350, color: "var(--theme-color-Sub-main)" }}
            class="memotab-item"
            class:selected={i == selectedMemoIndex}
            aria-label={`Select memo ${memo.title}`}
            on:click={() => {
              selectedMemoIndex = i;
            }}
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
                e.stopPropagation();
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
        tooltipContent="Create a note."
        ariaLabel="Add a memo"
        {disabled}
        activeColor={"var(--theme-color-Primary-dark)"}
        normalColor={"var(--theme-color-Primary-main)"}
        on:click={createFirstMemo}
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
        on:click={toggle}
        content="rename"
      />
    </div>
  </div>

  <div class="memotab-content">
    {#if memo[selectedMemoIndex]}
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
      <div class="empty-state" data-testid="memo-empty-state">
        <p class="eyebrow">Notes</p>
        <h2>Create the first note for this task</h2>
        <p class="empty-copy">
          Capture context, next steps, or research here. Notes stay with the task so they are easy
          to revisit later.
        </p>
        <Button
          content="Create first note"
          ariaLabel="Create first note"
          activeColor={"var(--theme-color-Primary-dark)"}
          normalColor={"var(--theme-color-Primary-main)"}
          on:click={createFirstMemo}
        />
      </div>
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
    border: none;
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
    background-color: transparent;
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

  .empty-tab-label {
    opacity: 0.8;
  }

  .memotab-item:hover {
    cursor: pointer;
  }

  .selected {
    border-bottom: 0.2rem solid var(--theme-color-Accent-main);
  }

  .memotab-content {
    display: flex;
    box-sizing: border-box;
    height: calc(100% - 5.5rem);
    flex: 1;
    overflow: hidden;
  }

  .empty-state {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 2rem;
    border: 0.1rem dashed var(--theme-color-Shadow-main);
    border-radius: 1rem;
    margin: 1rem;
    background:
      linear-gradient(135deg, var(--theme-color-Shadow-sub), transparent 70%),
      var(--theme-color-Main-main);
    color: var(--theme-color-Sub-main);
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.8rem;
  }

  .empty-state h2 {
    margin: 0;
    color: var(--theme-color-Primary-main);
  }

  .empty-copy {
    margin: 0;
    max-width: 34rem;
    line-height: 1.5;
  }
</style>
