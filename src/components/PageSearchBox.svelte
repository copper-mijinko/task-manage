<script>
  import { onMount, onDestroy, createEventDispatcher, tick } from "svelte";
  import IconButton from "./IconButton.svelte";
  import { pageSearchQuery } from "../stores/search";
  import * as platform from "../lib/platform";

  export let show = false;

  let searchInputElement; // bind element
  let searchText = ""; //bind value
  let matchCount = 0;
  let activeMatchOrdinal = 0;
  let lastSearchText = "";

  const dispatch = createEventDispatcher();

  export async function focusInput() {
    await tick();
    searchInputElement?.focus();
  }

  // focus when the search box is shown.
  $: if (show) {
    focusInput();
  }

  // 検索実行前に実際に検索テキストがあるか確認
  function checkAndExecuteSearch() {
    // 検索テキストが空の場合は検索を実行しない
    if (!searchText || !searchText.trim()) {
      return;
    }
    executeSearch();
  }

  // clear in closing the search box.
  $: if (show === false) {
    searchText = ""; // search box内をクリア
    lastSearchText = ""; // ステータスをクリア
    pageSearchQuery.set("");
    platform.stopFindInPage(); // matchCount, activeMatchOrdinalはMainから0が通知される
  }

  $: pageSearchQuery.set(show && searchText.trim() ? searchText.trim() : "");

  // search
  async function executeSearch() {
    // empty, clear
    if (!searchText || !searchText.trim()) {
      lastSearchText = ""; // ステータスをクリア
      platform.stopFindInPage(); // matchCount, activeMatchOrdinalはMainから0が通知される
      return;
    }

    try {
      // 検索キック
      await platform.findInPage(searchText.trim(), {});
      // 検索文字列を保存（検索文字列変更を判定するため）
      lastSearchText = searchText;
    } catch {
      // ignore search error
    }
  }

  // on click search
  function handleSearchButtonClick() {
    checkAndExecuteSearch();
  }

  // on click next
  function findNext() {
    // if empty, return
    if (!searchText.trim()) return;
    // if searchText is changed, kick new search.
    if (searchText != lastSearchText) {
      checkAndExecuteSearch();
    }
    platform.findInPageNext(searchText.trim());
  }

  // on click prev
  function findPrevious() {
    if (!searchText.trim()) return;
    // if searchText is changed, kick new search.
    if (searchText != lastSearchText) {
      checkAndExecuteSearch();
    }
    platform.findInPagePrevious(searchText.trim());
  }

  // キー入力ハンドラ
  function handleKeydown(event) {
    if (event.key === "Escape") {
      closeSearch();
    } else if (event.key === "Enter") {
      if (event.shiftKey) {
        findPrevious();
      } else {
        findNext();
      }
    }
  }

  // 検索ボックスを閉じる
  function closeSearch() {
    platform.stopFindInPage();
    show = false;
    dispatch("close");
  }

  // 検索結果をクリア - シンプル版
  function clearSearch() {
    platform.stopFindInPage();
    searchText = "";
    matchCount = 0;
    activeMatchOrdinal = 0;
    pageSearchQuery.set("");
    focusInput();
  }

  // コンポーネントが表示された時
  onMount(() => {
    // メインプロセスからの検索結果更新メッセージを受け取るリスナーを設定
    platform.onSearchResultUpdated((result) => {
      // 検索結果の件数と現在位置を設定
      matchCount = result.matches || 0;
      activeMatchOrdinal = result.activeMatchOrdinal || 0;
    });
  });

  // コンポーネントが破棄される時
  onDestroy(() => {
    platform.stopFindInPage();
  });
</script>

<div class:hidden={!show}>
  <div class="search-box-container">
    <div class="search-box">
      <div class="search-input-container">
        <input
          type="text"
          bind:this={searchInputElement}
          bind:value={searchText}
          on:keydown={handleKeydown}
          placeholder="search..."
          autocomplete="off"
          spellcheck="false"
        />
        <button class="search-button" on:click={handleSearchButtonClick}> Search </button>
      </div>

      <div class="count-display">
        {#if searchText}
          <span class="result-count">
            {matchCount > 0 ? activeMatchOrdinal || 0 : 0} / {matchCount || 0}
          </span>
        {:else}
          <span class="result-count">0 / 0</span>
        {/if}
      </div>

      <div class="controls">
        <IconButton
          on:click={findPrevious}
          tooltipContent="Prev"
          ariaLabel="Previous match"
          style="width: 24px; height: 24px; padding: 0;"
          normalColor="var(--theme-color-Primary-main)"
          activeColor="var(--theme-color-Primary-dark)"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M15 18L9 12L15 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </IconButton>

        <IconButton
          on:click={findNext}
          tooltipContent="Next"
          ariaLabel="Next match"
          style="width: 24px; height: 24px; padding: 0;"
          normalColor="var(--theme-color-Primary-main)"
          activeColor="var(--theme-color-Primary-dark)"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M9 6L15 12L9 18"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </IconButton>

        <IconButton
          on:click={clearSearch}
          tooltipContent="Clear"
          ariaLabel="Clear search"
          style="width: 24px; height: 24px; padding: 0;"
          normalColor="var(--theme-color-Success-main)"
          activeColor="var(--theme-color-Success-dark)"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M15 9L9 15M9 9L15 15"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </IconButton>

        <IconButton
          on:click={closeSearch}
          tooltipContent="Close(Esc)"
          ariaLabel="Close search"
          style="width: 24px; height: 24px; padding: 0;"
          normalColor="var(--theme-color-Error-main)"
          activeColor="var(--theme-color-Error-dark)"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M18 6L6 18M6 6L18 18"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </IconButton>
      </div>
    </div>
  </div>
</div>

<style>
  .hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .search-box-container {
    position: fixed;
    top: 4rem;
    right: 1rem;
    z-index: 9999;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    background-color: var(--theme-color-Main-main);
    border: 1px solid var(--theme-color-Shadow-main);
  }

  .search-box {
    display: flex;
    align-items: center;
    padding: 0.5rem;
    gap: 0.5rem;
  }

  .search-input-container {
    display: flex;
    min-width: 250px;
    height: 2rem;
  }

  input {
    flex: 1;
    height: 100%;
    padding: 0 0.5rem;
    border: 1px solid var(--theme-color-Shadow-main);
    border-radius: 4px 0 0 4px;
    font-size: 0.9rem;
    border-right: none;
  }

  .search-button {
    height: 100%;
    padding: 0 0.75rem;
    background-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Main-main);
    border: none;
    border-radius: 0 4px 4px 0;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .search-button:hover {
    background-color: var(--theme-color-Primary-dark);
  }

  .count-display {
    min-width: 60px;
    font-size: 0.9rem;
    color: var(--theme-color-Sub-main);
    text-align: center;
    font-weight: 500;
    padding: 0 0.25rem;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .result-count {
    color: var(--theme-color-Primary-main);
    font-weight: bold;
  }

  .controls {
    display: flex;
    gap: 0.25rem;
  }
</style>
