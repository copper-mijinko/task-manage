<script>
  import { tick } from "svelte";
  import { table_selected_id } from "@stores";
  import { ripple, tooltip } from "@lib/actions";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import SegmentedControl from "@lib/primitives/SegmentedControl.svelte";
  import Memo from "@features/memos/components/Memo.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import { normalizeMemoFormat, isEmptyMemoContent } from "@features/memos/utils/memo_utils";

  export let memo = [];
  export let saveMemo;
  export let addMemo;
  export let deleteMemo;
  export let renameMemo;
  export let reorderMemo;
  export let saveMemoTags = null;
  export let changeMemoFormat = null;
  export let allTags = [];
  export let disabled = false;
  export let isWorkspaceProject = false;
  export let defaultMemoFormat = "quill";
  export let workspaceProjectDir = null;
  export let taskId = null;

  let show_confirm = false;
  let show_format_confirm = false;
  let name_confirm = "";
  let pendingFormat = null;
  let selectedMemoIndex = 0;
  let previousTaskId;
  let newMemoTitle = "memo";
  let inputs = Array(100).fill(null);
  let edit = false;
  const hasSelectedMemo = () => Boolean(memo[selectedMemoIndex]);
  const memoFormatOptions = [
    { value: "markdown", label: "Markdown", ariaLabel: "Use Markdown memo format" },
    { value: "quill", label: "Quill", ariaLabel: "Use Quill memo format" },
  ];

  const toggle_confirm = () => {
    show_confirm = !show_confirm;
  };

  const callback_confirm = () => {
    if (deleteMemo(selectedMemoIndex)) {
      selectedMemoIndex = selectedMemoIndex == 0 ? 0 : selectedMemoIndex - 1;
      edit = false;
    }
  };

  const toggle_format_confirm = () => {
    show_format_confirm = !show_format_confirm;
    if (!show_format_confirm) {
      pendingFormat = null;
    }
  };

  const callback_format_confirm = () => {
    const nextFormat = pendingFormat;
    if (nextFormat && changeMemoFormat) {
      changeMemoFormat(selectedMemoIndex, nextFormat);
    }
    pendingFormat = null;
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
  $: selectedMemoFormat = normalizeMemoFormat(selectedMemo?.format, defaultMemoFormat);
  $: currentTags = selectedMemo?.tags ?? [];
  $: suggestedTags = allTags.filter((tag) => !currentTags.includes(tag));
  $: normalizedTagQuery = normalizeTagInput(tagInput);
  $: visibleSuggestedTags = suggestedTags
    .filter((tag) => !normalizedTagQuery || tag.includes(normalizedTagQuery))
    .slice(0, 8);
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

  function requestMemoFormatChange(nextFormat) {
    if (!selectedMemo || !changeMemoFormat || nextFormat === selectedMemoFormat) return;
    pendingFormat = nextFormat;
    // 空メモなら装飾損失が発生し得ないので、確認ダイアログを出さず即変換
    if (isEmptyMemoContent(selectedMemo.content)) {
      callback_format_confirm();
      return;
    }
    show_format_confirm = true;
  }

  function handleMemoFormatChange(event) {
    requestMemoFormatChange(event.detail.value);
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
    <div class="memo-format-control">
      <SegmentedControl
        options={memoFormatOptions}
        value={selectedMemoFormat}
        ariaLabel="Memo format"
        size="md"
        disabled={disabled || !selectedMemo || !changeMemoFormat}
        on:change={handleMemoFormatChange}
      />
    </div>
    <div class="memotab-control">
      <IconButton
        tooltipContent="メモを追加"
        ariaLabel="メモを追加"
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
        tooltipContent="このメモを削除"
        ariaLabel="このメモを削除"
        variant="text"
        disabled={disabled || memo.length === 0}
        activeColor={"var(--theme-color-Error-main)"}
        normalColor={"var(--theme-color-Error-main)"}
        on:click={() => {
          if (!hasSelectedMemo()) {
            return;
          }
          show_confirm = true;
          name_confirm = memo[selectedMemoIndex].title;
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M3 6H21M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M10 11V17M14 11V17M5 6L6 20C6 20.6 6.4 21 7 21H17C17.6 21 18 20.6 18 20L19 6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </IconButton>
      <IconButton
        tooltipContent="名前を変更"
        ariaLabel="名前を変更"
        variant="text"
        disabled={disabled || memo.length === 0}
        activeColor={"var(--theme-color-Primary-main)"}
        normalColor={"var(--theme-color-Sub-main)"}
        on:click={toggleRename}
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M11 4H4C3.4 4 3 4.4 3 5V20C3 20.6 3.4 21 4 21H19C19.6 21 20 20.6 20 20V13"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M18.5 2.5C19.3284 1.67157 20.6716 1.67157 21.5 2.5C22.3284 3.32843 22.3284 4.67157 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </IconButton>
    </div>
  </div>

  {#if selectedMemo}
    <div class="tag-panel" aria-label="Memo tags">
      <!-- 追加済みタグ (Added tags) -->
      <div class="tag-row">
        <span class="tag-row-label">タグ</span>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="tag-chips" class:is-empty={currentTags.length === 0} on:click={focusTagInput}>
          {#each currentTags as tag (tag)}
            <span class="tag-chip">
              <span>{tag}</span>
              <button
                type="button"
                class="tag-chip-x"
                aria-label="Remove tag {tag}"
                on:click|stopPropagation={() => removeTag(tag)}
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
            placeholder={currentTags.length === 0 ? "タグを入力… (Enter)" : "タグを入力…"}
            aria-label="Memo tag"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>

      <!-- 候補タグ (Available tags) -->
      {#if visibleSuggestedTags.length > 0}
        <div class="tag-row">
          <span class="tag-row-label">候補</span>
          <div class="tag-available" aria-label="Suggested tags">
            {#each visibleSuggestedTags as tag (tag)}
              <button
                type="button"
                class="tag-pill"
                disabled={!saveMemoTags}
                on:click={() => addTag(tag)}
                aria-label="Add tag {tag}"
              >
                <span class="tag-pill-plus" aria-hidden="true">＋</span>#{tag}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <div class="memotab-content">
    {#if selectedMemo}
      {#key `${isWorkspaceProject ? "workspace" : "projects"}:${$table_selected_id ?? "none"}:${selectedMemoIndex}:${selectedMemoFormat}`}
        <Memo
          saveMemo={(editedContent) => saveMemo(editedContent, selectedMemoIndex)}
          content={editedContent}
          readOnly={disabled}
          memoTitles={memo.map((entry) => entry.title)}
          currentMemoTitle={selectedMemo?.title ?? ""}
          openMemoLink={selectMemoByTitle}
          {isWorkspaceProject}
          format={selectedMemoFormat}
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
<Dialog
  show={show_format_confirm}
  toggle={toggle_format_confirm}
  header="Memo format conversion"
  content={`Markdown と Quill の変換では、装飾や埋め込みなど一部の情報が損なわれる可能性があります。\n変換後は元に戻す / やり直しで取り消しできます。\n\nこのメモを ${pendingFormat === "markdown" ? "Markdown" : "Quill"} に変換しますか？`}
  callback={callback_format_confirm}
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
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
  }

  .container {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    height: 100%;
    min-height: 0;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .memotab-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    height: 2.5rem;
    width: 100%;
  }

  .memotab {
    display: flex;
    flex-direction: row;
    align-items: center;
    height: 2rem;
    padding: var(--sp1);
    overflow-x: auto;
    flex: 1;
  }

  .memo-format-control {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    margin: 0 var(--sp2);
  }

  .memotab-control {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--sp2);
    flex-shrink: 0;
    margin-left: auto;
    padding-right: var(--sp2);
  }

  .memotab-control :global(button) {
    width: 1.75rem;
    height: 1.75rem;
    margin: 0;
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
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
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
    padding: var(--sp1);
    flex: 1;
    justify-content: center;
    align-items: center;
    border-bottom: 0.2rem solid transparent;
    color: var(--theme-color-Sub-main);
    overflow: hidden;
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
    border-bottom-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Primary-main);
    font-weight: 500;
  }

  .drop-left {
    border-left: 0.15rem solid var(--theme-color-Primary-main);
  }

  .drop-right {
    border-right: 0.15rem solid var(--theme-color-Primary-main);
  }

  .tag-panel {
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-sizing: border-box;
    min-width: 0;
    padding: 2px var(--sp2);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 65%, transparent);
    background-color: transparent;
    container-type: inline-size;
    flex-shrink: 0;
  }
  /* Compact mode drops the divider between the tag bar and the editor
     so the memo area reads as one continuous edge-to-edge surface. */
  :global(.density-compact) .tag-panel {
    border-bottom: none;
  }

  /* Tag area — 2-section layout (追加済み / 候補) */
  .tag-row {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    width: 100%;
    min-width: 0;
  }

  .tag-row-label {
    flex: 0 0 auto;
    width: 2.75rem;
    min-width: 2.75rem;
    padding-top: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 600;
    line-height: 1.4;
    user-select: none;
  }

  .tag-chips {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px var(--sp1);
    min-width: 0;
    min-height: 1.5rem;
    padding: 1px var(--sp1);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    cursor: text;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  .tag-chips:focus-within {
    /* Only the outer ring colours — the inner border stays neutral so the
       focus indicator doesn't look like a double frame. */
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 30%, transparent);
  }

  .tag-chips.is-empty {
    padding-left: var(--sp1);
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    min-width: 0;
    max-width: min(14rem, 100%);
    min-height: 1.25rem;
    padding: 0 var(--sp1);
    border-radius: var(--shape-pill);
    border: 1px solid var(--theme-color-Primary-main);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    white-space: nowrap;
  }

  .tag-chip > span {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    flex-shrink: 0;
  }

  .tag-chip-x:hover {
    background-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Main-light);
  }

  .tag-chip-x svg {
    width: 0.7rem;
    height: 0.7rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tag-input {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
    line-height: 1.35;
    min-width: 0;
    max-width: 100%;
    width: auto;
    height: 1.25rem;
    flex: 1 1 4rem;
    outline: 0;
    padding: 0;
    margin-left: var(--sp1);
    text-align: left;
    cursor: text;
  }

  .tag-input::placeholder {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 50%, transparent);
  }

  /* 候補 (Available tags) */
  .tag-available {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px var(--sp1);
    min-width: 0;
    min-height: 1.5rem;
    padding: 1px var(--sp1);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 6%, transparent);
    border-radius: var(--shape-sm);
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    min-height: 1.25rem;
    padding: 0 var(--sp1);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 35%, transparent);
    border-radius: var(--shape-pill);
    background: transparent;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  .tag-pill:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
    border-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Primary-main);
  }

  .tag-pill:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tag-pill-plus {
    font-weight: 700;
    font-size: var(--font-label-sm);
  }

  @media (max-width: 600px) {
    .tag-row-label {
      width: 2.5rem;
      min-width: 2.5rem;
      font-size: var(--font-label-sm);
    }
  }

  .memotab-content {
    display: flex;
    box-sizing: border-box;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .memotab-content textarea {
    height: 100%;
    width: 100%;
    flex: 1;
    min-height: 0;
    resize: none;
    overflow: auto;
  }
</style>
