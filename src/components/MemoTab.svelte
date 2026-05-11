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
  export let saveMemoTags = null;
  export let allTags = [];
  export let disabled = false;
  export let isWorkspaceProject = false;
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
  $: currentTags = selectedMemo?.tags ?? [];
  $: suggestedTags = allTags.filter((tag) => !currentTags.includes(tag));
  $: normalizedTagQuery = normalizeTagInput(tagInput);
  $: visibleSuggestedTags = suggestedTags
    .filter((tag) => !normalizedTagQuery || tag.includes(normalizedTagQuery))
    .slice(0, 8);
  $: tagScopeLabel = isWorkspaceProject ? "Markdown" : "Quill";

  let tagInput = "";
  let tagInputElement;

  function normalizeTagInput(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function addTag(value) {
    const newTag = normalizeTagInput(value);
    if (newTag && !currentTags.includes(newTag) && saveMemoTags) {
      saveMemoTags(selectedMemoIndex, [...currentTags, newTag]);
    }
    tagInput = "";
  }

  function addTagFromInput() {
    addTag(tagInput);
  }

  function handleTagInput(e) {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      addTagFromInput();
    } else if (e.key === "Backspace" && tagInput === "" && currentTags.length > 0 && saveMemoTags) {
      saveMemoTags(selectedMemoIndex, currentTags.slice(0, -1));
    }
  }

  function focusTagInput(e) {
    if (e.target?.closest?.("button")) return;
    tagInputElement?.focus();
  }

  function removeTag(tag) {
    if (saveMemoTags) {
      saveMemoTags(
        selectedMemoIndex,
        currentTags.filter((t) => t !== tag)
      );
    }
  }

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

  {#if selectedMemo}
    <div class="tag-panel" aria-label="Memo tags">
      <div class="tag-editor">
        <div class="tag-title" aria-hidden="true">
          <span class="tag-mark">#</span>
          <span class="tag-title-copy">
            <span>Tags</span>
            <span class="tag-scope">{tagScopeLabel}</span>
          </span>
        </div>

        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="tag-field" class:is-empty={currentTags.length === 0} on:click={focusTagInput}>
          {#each currentTags as tag (tag)}
            <span class="tag-chip">
              <span>{tag}</span>
              <button
                class="tag-remove"
                type="button"
                on:click={() => removeTag(tag)}
                aria-label="Remove tag {tag}"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 7L17 17M17 7L7 17" />
                </svg>
              </button>
            </span>
          {/each}
          <input
            class="tag-input"
            type="text"
            bind:this={tagInputElement}
            bind:value={tagInput}
            on:keydown={handleTagInput}
            placeholder="Add tag"
            aria-label="Memo tag"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <button
          class="tag-add"
          type="button"
          aria-label="Add tag"
          disabled={!tagInput.trim() || !saveMemoTags}
          on:click={addTagFromInput}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5V19M5 12H19" />
          </svg>
          <span>Add</span>
        </button>
      </div>

      {#if visibleSuggestedTags.length > 0}
        <div class="tag-suggestions" aria-label="Suggested tags">
          {#each visibleSuggestedTags as tag (tag)}
            <button
              type="button"
              class="tag-suggestion"
              disabled={!saveMemoTags}
              on:click={() => addTag(tag)}
            >
              #{tag}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="memotab-content">
    {#if selectedMemo}
      {#key `${isWorkspaceProject ? "workspace" : "projects"}:${$table_selected_id ?? "none"}:${selectedMemoIndex}`}
        <Memo
          saveMemo={(editedContent) => saveMemo(editedContent, selectedMemoIndex)}
          content={editedContent}
          memoTitles={memo.map((entry) => entry.title)}
          openMemoLink={selectMemoByTitle}
          {isWorkspaceProject}
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

  .tag-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 65%, transparent);
    background-color: color-mix(in srgb, var(--theme-color-Main-dark) 90%, transparent);
    flex-shrink: 0;
  }

  .tag-editor {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .tag-title {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex: 0 0 auto;
    min-width: 5.5rem;
    color: var(--theme-color-Sub-main);
    font-size: 0.82rem;
    font-weight: 700;
  }

  .tag-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 8px;
    color: var(--theme-color-Accent-main);
    background-color: color-mix(in srgb, var(--theme-color-Accent-main) 13%, transparent);
  }

  .tag-title-copy {
    display: flex;
    flex-direction: column;
    gap: 0.08rem;
    line-height: 1.1;
  }

  .tag-scope {
    display: block;
    min-height: 0;
    padding: 0;
    border-radius: 0;
    color: var(--theme-color-Sub-main);
    background-color: transparent;
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0;
    white-space: nowrap;
    opacity: 0.78;
  }

  .tag-field {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    min-height: 2.75rem;
    padding: 0.35rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 40%, transparent);
    border-radius: 8px;
    background-color: var(--theme-color-Main-light);
    box-shadow: inset 0 0 0 1px transparent;
    cursor: text;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease,
      background-color 0.12s ease;
  }

  .tag-field:focus-within {
    border-color: var(--theme-color-Accent-main);
    box-shadow: inset 0 0 0 1px var(--theme-color-Accent-main);
    background-color: var(--theme-color-Main-light);
  }

  .tag-field.is-empty {
    padding-left: 0.7rem;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2rem;
    max-width: 14rem;
    padding: 0 0.35rem 0 0.75rem;
    border-radius: 8px;
    border: none;
    background-color: color-mix(
      in srgb,
      var(--theme-color-Accent-main) 24%,
      var(--theme-color-Main-light)
    );
    color: var(--theme-color-Sub-light);
    font-size: 0.84rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .tag-chip span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-remove {
    background: none;
    border: none;
    color: var(--theme-color-Sub-main);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border-radius: 50%;
  }

  .tag-remove:hover {
    color: var(--theme-color-Sub-light);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
  }

  .tag-remove svg {
    width: 0.85rem;
    height: 0.85rem;
  }

  .tag-remove path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .tag-input {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--theme-color-Sub-light);
    font-size: 0.84rem;
    min-width: 5rem;
    flex: 1 1 7rem;
    outline: 0;
    padding: 0;
    text-align: left;
    width: auto;
    cursor: text;
  }

  input.tag-input:focus,
  input.tag-input:hover {
    outline: 0;
    cursor: text;
  }

  .tag-input::placeholder {
    color: var(--theme-color-Sub-dark);
  }

  .tag-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex: 0 0 auto;
    min-height: 2.5rem;
    padding: 0 1rem;
    border: 1px solid color-mix(in srgb, var(--theme-color-Accent-main) 35%, transparent);
    border-radius: 8px;
    color: var(--theme-color-Main-main);
    background-color: var(--theme-color-Accent-dark);
    cursor: pointer;
    box-shadow: 0 0.15rem 0.35rem rgba(0, 0, 0, 0.18);
    transition:
      background-color 0.12s ease,
      box-shadow 0.12s ease,
      opacity 0.12s ease;
  }

  .tag-add:hover:not(:disabled),
  .tag-add:focus-visible {
    color: var(--theme-color-Main-main);
    background-color: var(--theme-color-Accent-main);
    box-shadow: 0 0.25rem 0.55rem rgba(0, 0, 0, 0.24);
  }

  .tag-add:disabled {
    cursor: default;
    color: var(--theme-color-Sub-dark);
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 18%, transparent);
    border-color: color-mix(in srgb, var(--theme-color-Sub-dark) 26%, transparent);
    box-shadow: none;
    opacity: 1;
  }

  .tag-add svg {
    width: 1rem;
    height: 1rem;
  }

  .tag-add span {
    font-size: 0.82rem;
    font-weight: 700;
    line-height: 1;
  }

  .tag-add path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tag-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    width: 100%;
    min-width: 0;
    padding-left: 6.25rem;
    box-sizing: border-box;
  }

  .tag-suggestion {
    display: inline-flex;
    align-items: center;
    max-width: 12rem;
    min-height: 2rem;
    padding: 0 0.65rem;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 24%, transparent);
    border-radius: 8px;
    color: var(--theme-color-Sub-main);
    background-color: color-mix(in srgb, var(--theme-color-Main-light) 70%, transparent);
    font-size: 0.72rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .tag-suggestion:hover:not(:disabled),
  .tag-suggestion:focus-visible {
    color: var(--theme-color-Sub-light);
    border-color: var(--theme-color-Accent-main);
    background-color: color-mix(in srgb, var(--theme-color-Accent-main) 12%, transparent);
  }

  .tag-suggestion:disabled {
    cursor: default;
    opacity: 0.5;
  }

  @media (max-width: 760px) {
    .tag-panel {
      padding: 0.6rem;
    }

    .tag-editor {
      grid-template-columns: 1fr;
      align-items: stretch;
      gap: 0.55rem;
    }

    .tag-title {
      min-width: 0;
    }

    .tag-suggestions {
      padding-left: 0;
    }
  }

  .memotab-content {
    display: flex;
    box-sizing: border-box;
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
