<script>
    import { onMount, onDestroy, createEventDispatcher, tick } from "svelte";
    import IconButton from "./IconButton.svelte";

    export let show = false;
    export let isSearchWindow = false;

    let searchInputElement; // bind element
    let searchText = ""; //bind value
    let matchCount = 0;
    let activeMatchOrdinal = 0;
    let lastSearchText = "";

    const dispatch = createEventDispatcher();

    export async function focusInput() {
        await tick();
        searchInputElement?.focus();
        console.log("called focustInput");
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
        console.log("Clear in closing search box");
        searchText = ""; // search box内をクリア
        lastSearchText = ""; // ステータスをクリア
        window.electronAPI.stopFindInPage(); // matchCount, activeMatchOrdinalはMainから0が通知される
    }

    // search
    async function executeSearch() {
        console.log("Execute Search:", searchText);

        // empty, clear
        if (!searchText || !searchText.trim()) {
            console.log("Clear when empty search box");
            lastSearchText = ""; // ステータスをクリア
            window.electronAPI.stopFindInPage(); // matchCount, activeMatchOrdinalはMainから0が通知される
            return;
        }

        try {
            // 検索キック
            await window.electronAPI.findInPage(searchText.trim(), {});
            console.log("Finished findInPage");
            // 検索文字列を保存（検索文字列変更を判定するため）
            lastSearchText = searchText;
        } catch (error) {
            console.error("Search Error:", error);
        }
    }

    // on click search
    function handleSearchButtonClick() {
        console.log("Clicked Search Button");
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
        console.log("Execute findInPageNext");
        window.electronAPI.findInPageNext(searchText.trim());
    }

    // on click prev
    function findPrevious() {
        if (!searchText.trim()) return;
        // if searchText is changed, kick new search.
        if (searchText != lastSearchText) {
            checkAndExecuteSearch();
        }
        console.log("Execute findInPagePrevious");
        window.electronAPI.findInPagePrevious(searchText.trim());
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

    // すべてのツールチップを削除する関数
    function removeAllTooltips() {
        // bodyの直下の要素をすべて取得
        const allElements = document.body.children;

        // ツールチップの特徴に一致する要素を検索して削除
        Array.from(allElements).forEach((el) => {
            if (el instanceof HTMLElement) {
                // ツールチップの特徴: position: fixed, 高いz-index, padding
                const style = window.getComputedStyle(el);
                const isTooltip =
                    style.position === "fixed" &&
                    parseInt(style.zIndex, 10) > 9000 &&
                    !el.classList.contains("search-box-container");

                if (isTooltip) {
                    document.body.removeChild(el);
                }
            }
        });
    }

    // 検索ボックスを閉じる
    function closeSearch() {
        console.log("Close SearchBox");
        window.electronAPI.stopFindInPage();
        removeAllTooltips();
        show = false;
        dispatch("close");
    }

    // 検索結果をクリア - シンプル版
    function clearSearch() {
        console.log("Clear search result");
        window.electronAPI.stopFindInPage();
        searchText = "";
        matchCount = 0;
        activeMatchOrdinal = 0;
        focusInput();
    }

    // コンポーネントが表示された時
    onMount(() => {
        // メインプロセスからの検索結果更新メッセージを受け取るリスナーを設定
        window.electronAPI.onSearchResultUpdated((result) => {
            console.log("Receive onSearchResultUpdated:", result);

            // 検索結果の件数と現在位置を設定
            matchCount = result.matches || 0;
            activeMatchOrdinal = result.activeMatchOrdinal || 0;

            if (matchCount === 0) {
                console.log("No result");
            } else {
                console.log(`Result: ${activeMatchOrdinal}/${matchCount}`);
            }
        });

        // ESCキーイベントをグローバルに追加してツールチップを削除
        const handleGlobalEscape = (e) => {
            if (e.key === "Escape") {
                removeAllTooltips();
            }
        };
        // イベントハンドラの登録
        window.addEventListener("keydown", handleGlobalEscape);

        return () => {
            window.removeEventListener("keydown", handleGlobalEscape);
        };
    });

    // コンポーネントが破棄される時
    onDestroy(() => {
        window.electronAPI.stopFindInPage();
        removeAllTooltips();
    });
</script>

<div class:search-window-mode={isSearchWindow} class:hidden={!show}>
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
                    <button
                        class="search-button"
                        on:click={handleSearchButtonClick}
                    >
                        Search
                    </button>
                </div>

                <div class="count-display">
                    {#if searchText}
                        <span class="result-count">
                            {matchCount > 0 ? activeMatchOrdinal || 0 : 0} / {matchCount ||
                                0}
                        </span>
                    {:else}
                        <span class="result-count">0 / 0</span>
                    {/if}
                </div>

                <div class="controls">
                    <IconButton
                        on:click={findPrevious}
                        tooltipContent="Prev"
                        style="width: 24px; height: 24px; padding: 0;"
                        normalColor="var(--theme-color-Primary-main)"
                        activeColor="var(--theme-color-Primary-dark)"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
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
                        style="width: 24px; height: 24px; padding: 0;"
                        normalColor="var(--theme-color-Primary-main)"
                        activeColor="var(--theme-color-Primary-dark)"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
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
                        style="width: 24px; height: 24px; padding: 0;"
                        normalColor="var(--theme-color-Success-main)"
                        activeColor="var(--theme-color-Success-dark)"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
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
                        style="width: 24px; height: 24px; padding: 0;"
                        normalColor="var(--theme-color-Error-main)"
                        activeColor="var(--theme-color-Error-dark)"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
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

    /* 検索ウィンドウモードのスタイル */
    :global(.search-window-mode) .search-box-container {
        position: relative;
        top: 0;
        left: 0;
        right: 0;
        width: 100%;
        border-radius: 0;
        border: none;
        box-shadow: none;
        padding: 10px;
        box-sizing: border-box;
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
