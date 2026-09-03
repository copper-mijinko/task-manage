<script>
  import { createEventDispatcher } from "svelte";
  import { normalizeTag, withTagAdded, withTagRemoved } from "@lib/utils/tags";

  /** 現在付いているタグ。 */
  export let tags = [];
  /** 候補として提示するタグ（プロジェクト内で既出のもの）。 */
  export let suggestions = [];
  export let disabled = false;
  export let label = "タグ";
  export let suggestionLabel = "候補";
  export let ariaLabel = "タグ";
  export let placeholder = "タグを入力…";
  export let emptyPlaceholder = "タグを入力… (Enter)";
  export let maxSuggestions = 8;
  /** ラベル列を出さずチップだけを描画する（詳細ペインなど省スペース用）。 */
  export let showLabels = true;

  const dispatch = createEventDispatcher();

  let input = "";
  let inputElement;

  $: currentTags = tags ?? [];
  $: normalizedQuery = normalizeTag(input);
  $: visibleSuggestions = (suggestions ?? [])
    .filter((tag) => !currentTags.includes(tag))
    .filter((tag) => !normalizedQuery || tag.includes(normalizedQuery))
    .slice(0, maxSuggestions);

  function commit(next) {
    if (disabled) return;
    if (next.length === currentTags.length && next.every((tag, i) => tag === currentTags[i])) {
      return;
    }
    dispatch("change", { tags: next });
  }

  function addTag(value) {
    const next = withTagAdded(currentTags, value);
    input = "";
    commit(next);
  }

  function removeTag(value) {
    commit(withTagRemoved(currentTags, value));
  }

  function handleKeydown(event) {
    if ((event.key === "Enter" || event.key === ",") && input.trim()) {
      event.preventDefault();
      addTag(input);
    } else if (event.key === "Backspace" && input === "" && currentTags.length > 0) {
      removeTag(currentTags[currentTags.length - 1]);
    }
  }

  function focusInput() {
    inputElement?.focus();
  }
</script>

<div class="tag-field" class:no-labels={!showLabels}>
  <div class="tag-row">
    {#if showLabels}
      <span class="tag-row-label">{label}</span>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tag-chips"
      class:is-empty={currentTags.length === 0}
      class:disabled
      on:click={focusInput}
    >
      {#each currentTags as tag (tag)}
        <span class="tag-chip">
          <span>{tag}</span>
          <button
            type="button"
            class="tag-chip-x"
            {disabled}
            aria-label={`タグ ${tag} を外す`}
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
        {disabled}
        bind:this={inputElement}
        bind:value={input}
        on:keydown={handleKeydown}
        on:blur={() => input.trim() && addTag(input)}
        placeholder={currentTags.length === 0 ? emptyPlaceholder : placeholder}
        aria-label={ariaLabel}
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  </div>

  {#if visibleSuggestions.length > 0}
    <div class="tag-row">
      {#if showLabels}
        <span class="tag-row-label">{suggestionLabel}</span>
      {/if}
      <div class="tag-available" aria-label="タグ候補">
        {#each visibleSuggestions as tag (tag)}
          <button
            type="button"
            class="tag-pill"
            {disabled}
            on:click={() => addTag(tag)}
            aria-label={`タグ ${tag} を追加`}
          >
            <span class="tag-pill-plus" aria-hidden="true">＋</span>#{tag}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .tag-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-sizing: border-box;
    min-width: 0;
    container-type: inline-size;
  }

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

  .tag-chips.disabled {
    cursor: default;
    opacity: 0.6;
  }

  .tag-chips:focus-within {
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

  .tag-chip-x:hover:not(:disabled) {
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

  .tag-pill:hover:not(:disabled) {
    border-color: var(--theme-color-Primary-main);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
  }

  .tag-pill:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .tag-pill-plus {
    font-weight: 700;
    font-size: var(--font-label-sm);
  }

  @container (max-width: 22rem) {
    .tag-row-label {
      width: 2.25rem;
      min-width: 2.25rem;
      font-size: var(--font-label-sm);
    }
  }
</style>
