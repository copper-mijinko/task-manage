<script>
  import IconButton from "@lib/primitives/IconButton.svelte";
  import { tooltip } from "@lib/actions";
  import { filter } from "@stores";

  let terms = []; // confirmed chips
  let search_text = ""; // current in-progress typing
  let search_box; //bind
  let memoSearchEnabled = false;
  let root_el; //bind

  const currentFullText = () => {
    const combined = search_text !== "" ? [...terms, search_text] : [...terms];
    return combined.length > 0 ? combined : null;
  };

  // Case-insensitive dedupe (matching itself is case-insensitive), keeping
  // the first occurrence's original casing/order.
  const dedupeTerms = (values) => {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const key = String(value).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  };

  const applyFilter = () => {
    $filter = {
      ...$filter,
      full_text: currentFullText(),
    };
  };

  const confirmChip = () => {
    const value = search_text.trim();
    if (value === "") return;
    // Dedupe case-insensitively (matching is itself case-insensitive), so
    // confirming a term that's already a chip just clears the input instead
    // of adding a duplicate chip.
    const isDuplicate = terms.some((term) => term.toLowerCase() === value.toLowerCase());
    if (!isDuplicate) {
      terms = [...terms, value];
    }
    search_text = "";
    applyFilter();
  };

  const removeLastChip = () => {
    if (terms.length === 0) return;
    terms = terms.slice(0, -1);
    applyFilter();
  };

  const removeChipAt = (index) => {
    terms = terms.filter((_, i) => i !== index);
    applyFilter();
  };

  const clearAll = () => {
    terms = [];
    search_text = "";
    applyFilter();
  };

  const toggleMemoSearch = () => {
    const next = !memoSearchEnabled;
    $filter = {
      ...$filter,
      search_memo: next ? ["1"] : null,
    };
  };

  // Sync FROM the store when it changes externally (e.g. cleared via
  // ActiveFilterBar) and the box isn't focused. Treat all entries as
  // confirmed chips with no in-progress text to keep things simple and
  // avoid feedback loops with applyFilter() above.
  $: {
    // Compare against the RAW stored value first (not deduped): while the
    // user is actively typing, applyFilter() writes [...terms, search_text]
    // verbatim, and search_text may legitimately equal an already-confirmed
    // term for a moment before Enter/dedupe decides whether to keep it. If
    // we deduped before this comparison, that in-progress state would look
    // like a mismatch and get clobbered.
    const stored = $filter?.full_text ?? [];
    const isFocused =
      typeof document !== "undefined" &&
      root_el &&
      (document.activeElement === search_box || root_el.contains(document.activeElement));
    if (!isFocused) {
      const same =
        stored.length === terms.length + (search_text !== "" ? 1 : 0) &&
        stored.every((v, i) => v === (i < terms.length ? terms[i] : search_text));
      if (!same) {
        // Only once we've established this is a real (external) change do we
        // dedupe, so a store value carrying a duplicate (e.g. round-tripped
        // through ActiveFilterBar) never renders as two identical chips.
        // Write the deduped value back to the store too, so the comparison
        // above converges instead of looping (a lingering raw duplicate
        // would otherwise never match the deduped terms length again) and so
        // ActiveFilterBar reflects the same de-duplicated list.
        const deduped = dedupeTerms(stored);
        terms = deduped;
        search_text = "";
        if (deduped.length !== stored.length) {
          $filter = { ...$filter, full_text: deduped.length > 0 ? deduped : null };
        }
      }
    }
  }

  $: memoSearchEnabled = ($filter?.search_memo?.length ?? 0) > 0;

  const params = {
    color: "var(--theme-color-Main-main)",
    backgroundColor: "var(--theme-color-Sub-main)",
    wrapped: true,
    force: true,
    content: "タスクをフィルタ（行を絞り込む）",
  };
</script>

<div class="SearchBoxRoot" data-page-search-skip bind:this={root_el}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="SearchChips"
    class:is-empty={terms.length === 0}
    on:click={(e) => {
      if (e.target?.closest?.("button")) return;
      search_box?.focus();
    }}
  >
    {#each terms as term, i (i + ":" + term)}
      <span class="SearchChip">
        <span>{term}</span>
        <button
          type="button"
          class="SearchChipX"
          aria-label={`「${term}」を削除`}
          title={`「${term}」を削除`}
          on:click|stopPropagation={() => removeChipAt(i)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7L17 17M17 7L7 17" />
          </svg>
        </button>
      </span>
    {/each}
    <input
      class="SearchBoxInput"
      type="text"
      bind:this={search_box}
      bind:value={search_text}
      draggable="false"
      placeholder={terms.length === 0 ? "filter tasks..." : ""}
      on:input={() => {
        applyFilter();
      }}
      on:click={(e) => {
        e.stopPropagation();
      }}
      on:keydown={(e) => {
        if ("Enter" == e.key) {
          confirmChip();
        } else if ("Backspace" == e.key && search_text === "") {
          removeLastChip();
        } else if ("Escape" == e.key) {
          clearAll();
          search_box.focus();
        }
      }}
      use:tooltip={params}
    />
  </div>
  <IconButton
    on:click={() => {
      confirmChip();
      search_box?.focus();
    }}
    ariaLabel="Search tasks"
    tooltipContent="フィルタを適用"
    variant="text"
    use_ripple={true}
    normalColor="var(--theme-color-Sub-main)"
    activeColor="var(--theme-color-Sub-main)"
    style={"margin: 0; box-shadow: none; width: 1.75rem; height: 1.75rem; --backgroundColor: transparent; flex-shrink: 0;"}
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
      ><path
        d="M15.7955 15.8111L21 21M18 10.5C18 14.6421 14.6421 18 10.5 18C6.35786 18 3 14.6421 3 10.5C3 6.35786 6.35786 3 10.5 3C14.6421 3 18 6.35786 18 10.5Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  </IconButton>
  <IconButton
    on:click={toggleMemoSearch}
    ariaLabel={memoSearchEnabled ? "Disable memo search" : "Enable memo search"}
    aria-pressed={memoSearchEnabled}
    variant="text"
    use_ripple={true}
    normalColor={memoSearchEnabled
      ? "var(--theme-color-Primary-main)"
      : "var(--theme-color-Sub-main)"}
    activeColor={memoSearchEnabled
      ? "var(--theme-color-Primary-main)"
      : "var(--theme-color-Sub-main)"}
    tooltipContent={memoSearchEnabled ? "メモを検索対象から除外" : "メモも検索対象に含める"}
    style={"margin: 0; box-shadow: none; width: 1.75rem; height: 1.75rem; --backgroundColor: transparent; flex-shrink: 0;"}
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
      ><path
        d="M9 12h6M9 16h6M7 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2M9 4h6a1 1 0 010 2H9a1 1 0 010-2z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  </IconButton>
</div>

<style>
  .SearchBoxRoot {
    width: clamp(9rem, 100%, 22rem);
    max-width: 100%;
    min-height: 2rem;
    height: auto;
    margin: 0;
    display: flex;
    flex-direction: row;
    align-items: center;
    box-sizing: border-box;
    min-width: 0;
    gap: var(--sp1);
    /* Match Task Detail input style */
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }
  .SearchBoxRoot:focus-within {
    border-color: var(--theme-color-Primary-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
  }
  .SearchChips {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px var(--sp1);
    min-width: 0;
    min-height: 2rem;
    padding: 1px 0 1px var(--sp1);
    box-sizing: border-box;
    cursor: text;
  }
  .SearchChips.is-empty {
    padding-left: var(--sp2);
  }
  .SearchChip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    min-width: 0;
    max-width: min(10rem, 100%);
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
  .SearchChip > span {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .SearchChipX {
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
  .SearchChipX:hover {
    background-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Main-light);
  }
  .SearchChipX svg {
    width: 0.7rem;
    height: 0.7rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .SearchBoxInput {
    box-sizing: border-box;
    margin: 0;
    padding: 0 var(--sp2) 0 0;
    height: 1.5rem;
    flex: 1 1 auto;
    width: auto;
    min-width: 4rem;
    border: none;
    background: transparent;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-md);
    outline: none;
  }
  .SearchBoxInput::placeholder {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 55%, transparent);
  }
</style>
