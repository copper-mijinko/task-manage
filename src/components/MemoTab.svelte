<script>
  import { tick } from "svelte";
  import { table_selected_id } from "../stores.ts";
  import { ripple } from "../common/common.js";
  import IconButton from "./IconButton.svelte";
  import Button from "./Button.svelte";
  import Memo from "./Memo.svelte";
  import Dialog from "./Dialog.svelte";

  export let memo = [];
  export let saveMemo;
  export let addMemo;
  export let deleteMemo;
  export let renameMemo;
  export let disabled = false;
  export let workspaceProjectDir = null;
  export let taskId = null;

  let show_confirm = false;
  let name_confirm = "";
  let selectedMemoIndex = 0;
  let previousTaskId;
  let renamingIndex = null;
  let draftTitle = "";
  let renameInput;

  const toggle_confirm = () => {
    show_confirm = !show_confirm;
  };

  const hasSelectedMemo = () => Boolean(memo[selectedMemoIndex]);

  function normalizeMemoTitle(title) {
    return String(title || "")
      .trim()
      .toLocaleLowerCase();
  }

  function cancelRename() {
    renamingIndex = null;
    draftTitle = "";
  }

  function commitRename() {
    if (renamingIndex === null) {
      return;
    }

    const index = renamingIndex;
    const nextTitle = draftTitle.trim();
    renamingIndex = null;

    if (nextTitle && nextTitle !== memo[index]?.title) {
      renameMemo(nextTitle, index);
    }
  }

  const callback_confirm = () => {
    if (deleteMemo(selectedMemoIndex)) {
      selectedMemoIndex = selectedMemoIndex == 0 ? 0 : selectedMemoIndex - 1;
      cancelRename();
    }
  };

  function buildNextMemoTitle() {
    const existingTitles = new Set(memo.map((entry) => normalizeMemoTitle(entry.title)));
    const baseTitle = "Note";

    if (!existingTitles.has(normalizeMemoTitle(baseTitle))) {
      return baseTitle;
    }

    let suffix = memo.length + 1;
    let title = `${baseTitle} ${suffix}`;
    while (existingTitles.has(normalizeMemoTitle(title))) {
      suffix += 1;
      title = `${baseTitle} ${suffix}`;
    }
    return title;
  }

  function selectMemo(index) {
    if (renamingIndex !== null && renamingIndex !== index) {
      commitRename();
    }
    selectedMemoIndex = index;
  }

  const beginRename = async (index = selectedMemoIndex) => {
    if (disabled || !memo[index]) {
      return;
    }

    selectedMemoIndex = index;
    draftTitle = memo[index].title || "";
    renamingIndex = index;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  };

  const selectMemoByTitle = (title) => {
    const nextIndex = memo.findIndex(
      (entry) => normalizeMemoTitle(entry.title) === normalizeMemoTitle(title)
    );

    if (nextIndex >= 0) {
      commitRename();
      selectedMemoIndex = nextIndex;
      return true;
    }

    return false;
  };

  const createFirstMemo = async () => {
    if (addMemo(buildNextMemoTitle())) {
      await tick();
      selectedMemoIndex = memo.length - 1;
      await beginRename(selectedMemoIndex);
    }
  };

  $: if ($table_selected_id !== previousTaskId) {
    previousTaskId = $table_selected_id;
    selectedMemoIndex = 0;
    cancelRename();
  }

  $: if (selectedMemoIndex >= memo.length && memo.length > 0) {
    selectedMemoIndex = memo.length - 1;
  }

  $: editedContent = memo.length > selectedMemoIndex ? memo[selectedMemoIndex].content : "";
  $: selectedMemo = memo[selectedMemoIndex];
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
              selectMemo(i);
            }}
            on:dblclick={() => {
              beginRename(i);
            }}
          >
            {#if renamingIndex === i}
              <input
                class="tab-rename"
                type="text"
                bind:this={renameInput}
                bind:value={draftTitle}
                aria-label={`Rename memo ${memo.title}`}
                on:click|stopPropagation
                on:blur={commitRename}
                on:keydown={(e) => {
                  if (e.key == "Enter") {
                    commitRename();
                  }
                  if (e.key == "Escape") {
                    cancelRename();
                  }
                }}
              />
            {:else}
              <span class="tab-title" title={memo.title}>{memo.title || "Untitled"}</span>
            {/if}
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
        tooltipContent="Rename the selected note."
        ariaLabel="Rename the selected memo"
        disabled={disabled || memo.length === 0}
        activeColor={"var(--theme-color-Info-dark)"}
        normalColor={"var(--theme-color-Info-main)"}
        on:click={() => {
          beginRename();
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
          ><path
            d="M4 20H20M5 16.5L6 12.5L15.5 3L19 6.5L9.5 16L5 16.5Z"
            stroke="var(--theme-color-Main-main)"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path></svg
        >
      </IconButton>
      <IconButton
        tooltipContent="Delete the selected note."
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
      <div class="empty-state" data-testid="memo-empty-state">
        <h2>Create a note</h2>
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
  header="Delete note?"
  content={`Delete "${name_confirm}"?`}
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
    height: 3.25rem;
    width: 100%;
    border-bottom: 1px solid var(--theme-color-Shadow-main);
    background-color: var(--theme-color-Main-main);
  }

  .memotab {
    display: flex;
    flex-direction: row;
    align-items: center;
    height: 100%;
    padding: 0.35rem 0.5rem;
    gap: 0.35rem;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    scrollbar-width: none;
  }

  .memotab::-webkit-scrollbar {
    display: none;
  }

  .memotab-control {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    margin-left: auto;
    gap: 0.1rem;
    padding: 0 0.35rem;
    border-left: 1px solid var(--theme-color-Shadow-main);
  }

  .memotab-control :global(button.IconButton) {
    margin: 0.35rem 0.2rem;
  }

  .tab-rename {
    box-sizing: border-box;
    border: 1px solid transparent;
    padding: 0.15rem 0.25rem;
    margin: 0;
    width: 100%;
    min-width: 0;
    text-align: left;
    color: var(--theme-color-Sub-light);
    background-color: var(--theme-color-Main-dark);
    border-radius: 4px;
    cursor: text !important;
  }

  .tab-rename:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--theme-color-Primary-main) 70%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
  }

  .memotab-item {
    display: flex;
    box-sizing: border-box;
    height: 2.25rem;
    width: clamp(7rem, 16vw, 13rem);
    min-width: 7rem;
    padding: 0.35rem 0.65rem;
    flex: 0 0 auto;
    justify-content: flex-start;
    align-items: center;
    color: var(--theme-color-Sub-main);
    border-radius: 0.45rem;
    border: 1px solid transparent;
    background-color: transparent;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
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

  .tab-title {
    min-width: 0;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font-size: 0.9rem;
  }

  .empty-tab-label {
    opacity: 0.8;
  }

  .memotab-item:hover {
    cursor: pointer;
    background-color: var(--theme-color-Shadow-sub);
    color: var(--theme-color-Sub-light);
  }

  .selected {
    border-color: color-mix(in srgb, var(--theme-color-Primary-main) 55%, transparent);
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-light);
    box-shadow: inset 0 -0.16rem 0 var(--theme-color-Primary-main);
  }

  .memotab-content {
    display: flex;
    box-sizing: border-box;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .empty-state {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 0.85rem;
    padding: 2rem;
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-main);
  }

  .empty-state h2 {
    margin: 0;
    color: var(--theme-color-Sub-light);
    font-size: 1.1rem;
  }
</style>
