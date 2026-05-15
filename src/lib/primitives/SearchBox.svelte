<script>
  import IconButton from "@lib/primitives/IconButton.svelte";
  import { tooltip } from "@lib/actions";
  import { filter } from "@stores";

  let search_text = "";
  let search_box; //bind
  let memoSearchEnabled = false;

  const applySearch = (value = search_text) => {
    search_text = value;
    $filter = {
      ...$filter,
      full_text: search_text !== "" ? [search_text] : null,
    };
  };

  const toggleMemoSearch = () => {
    const next = !memoSearchEnabled;
    $filter = {
      ...$filter,
      search_memo: next ? ["1"] : null,
    };
  };

  $: if (($filter?.full_text?.[0] ?? "") !== search_text && document.activeElement !== search_box) {
    search_text = $filter?.full_text?.[0] ?? "";
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

<div class="SearchBoxRoot" data-page-search-skip>
  <input
    class="SearchBoxInput"
    type="text"
    bind:this={search_box}
    bind:value={search_text}
    draggable="false"
    placeholder="filter tasks..."
    on:input={(e) => {
      applySearch(e.currentTarget.value);
    }}
    on:click={(e) => {
      e.stopPropagation();
    }}
    on:keydown={(e) => {
      if ("Enter" == e.key) {
        applySearch(search_text);
      } else if ("Escape" == e.key) {
        applySearch("");
        search_box.focus();
      }
    }}
    use:tooltip={params}
  />
  <IconButton
    on:click={() => {
      applySearch(search_text);
      search_box?.focus();
    }}
    ariaLabel="Search tasks"
    tooltipContent="フィルタを適用"
    variant="text"
    use_ripple={true}
    normalColor="var(--theme-color-Sub-main)"
    activeColor="var(--theme-color-Sub-main)"
    style={"margin: 0; box-shadow: none; width: 1.75rem; height: 1.75rem; --backgroundColor: transparent;"}
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
    style={"margin: 0; box-shadow: none; width: 1.75rem; height: 1.75rem; --backgroundColor: transparent;"}
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
    height: 2rem;
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
  .SearchBoxInput {
    box-sizing: border-box;
    margin: 0;
    padding: 0 var(--sp2);
    height: 100%;
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
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
