<script>
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import IconButton from "./IconButton.svelte";

    export let show = false;

    let searchText = "";
    let matchCount = 0;
    let activeMatchOrdinal = 0;
    let caseSensitive = false;
    let searchInputElement;
    let hasSearchedOnce = false;
    let lastRequestId = 0;

    const dispatch = createEventDispatcher();

    // 検索ボックスが表示されたらフォーカスするだけ（検索は実行しない）
    $: if (show) {
        console.log("検索ボックス表示:", show);
        if (searchInputElement) {
            setTimeout(() => {
                searchInputElement.focus();
            }, 100);
        }
    }

    // showがfalseになったときにハイライトを確実に消去
    $: if (show === false) {
        console.log("検索ボックス非表示によるハイライトクリア");
        window.electronAPI.stopFindInPage("clearSelection");
    }

    // 大文字小文字設定変更時のみ検索を実行（検索ボタン押下済みの場合のみ）
    let previousCaseSensitive = caseSensitive;
    $: if (show && hasSearchedOnce && caseSensitive !== previousCaseSensitive) {
        console.log("大文字小文字設定変更:", caseSensitive);
        previousCaseSensitive = caseSensitive;
        if (searchText && searchText.trim()) {
            executeSearch();
        }
    }

    // 検索処理を実行する関数 - シンプル実装
    async function executeSearch() {
        console.log("検索処理開始:", searchText);

        // 検索文字列が空の場合はクリア
        if (!searchText || !searchText.trim()) {
            console.log("検索テキストが空のためクリア");
            window.electronAPI.stopFindInPage("clearSelection");
            matchCount = 0;
            activeMatchOrdinal = 0;
            return;
        }

        try {
            // 検索実行 - 結果はイベントで取得
            const result = await window.electronAPI.findInPage(searchText, {
                forward: true,
                findNext: false,
                matchCase: caseSensitive,
            });

            console.log("検索リクエスト完了:", result);

            // リクエストIDを保存（古い結果を無視するため）
            if (result && result.requestId) {
                lastRequestId = result.requestId;
            }
        } catch (error) {
            console.error("検索エラー:", error);
        }
    }

    // 検索ボタンクリック時のハンドラ - 改良版
    function handleSearchButtonClick() {
        console.log("検索ボタンがクリックされました");

        // 検索ボタンクリック時に即座に検索結果を更新（UX向上）
        if (searchText && searchText.trim()) {
            // 検索実行前に仮の検索結果を表示
            matchCount = 1;
            activeMatchOrdinal = 1;
        }

        executeSearch();
        hasSearchedOnce = true;
    }

    // 大文字小文字設定変更ハンドラ
    function toggleCaseSensitive() {
        console.log("大文字小文字設定変更:", !caseSensitive);
        caseSensitive = !caseSensitive;
        // リアクティブな検出で自動的に実行される
    }

    // 次を検索 - シンプル版
    function findNext() {
        if (!searchText.trim()) return;
        console.log("次を検索実行");
        window.electronAPI.findInPageNext(searchText.trim());
    }

    // 前を検索 - シンプル版
    function findPrevious() {
        if (!searchText.trim()) return;
        console.log("前を検索実行");
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
        console.log("検索ボックスを閉じる");
        window.electronAPI.stopFindInPage("clearSelection");
        removeAllTooltips();
        show = false;
        dispatch("close");
    }

    // 検索結果をクリア - シンプル版
    function clearSearch() {
        console.log("検索結果をクリア");
        window.electronAPI.stopFindInPage("clearSelection");
        searchText = "";
        matchCount = 0;
        activeMatchOrdinal = 0;
        if (searchInputElement) {
            searchInputElement.focus();
        }
    }

    // コンポーネントが表示された時
    onMount(() => {
        // メインプロセスからのハイライトクリアメッセージを受け取るリスナーを設定
        window.electronAPI.onClearHighlights((data) => {
            console.log("ハイライトクリアイベント受信:", data);
        });

        // メインプロセスからの検索結果更新メッセージを受け取るリスナーを設定
        window.electronAPI.onSearchResultUpdated((result) => {
            console.log("検索結果更新イベント受信:", result);

            // 古い検索結果は無視（検索IDによる判定）
            if (result.requestId && result.requestId < lastRequestId) {
                console.log("古い検索結果を無視します");
                return;
            }

            // 検索がクリアされた場合
            if (result.cleared) {
                matchCount = 0;
                activeMatchOrdinal = 0;
                console.log("検索結果クリア");
                return;
            }

            // 検索結果の件数と現在位置を設定
            matchCount = result.matches || 0;
            activeMatchOrdinal = result.activeMatchOrdinal || 0;

            if (matchCount === 0) {
                console.log("検索結果なし");
            } else {
                console.log(`検索結果: ${activeMatchOrdinal}/${matchCount}`);
            }

            // 検索が成功したらフラグを立てる
            if (matchCount > 0) {
                hasSearchedOnce = true;
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
        window.electronAPI.stopFindInPage("clearSelection");
        removeAllTooltips();
    });
</script>

{#if show}
    <div class="search-box-container">
        <div class="search-box">
            <div class="search-input-container">
                <input
                    type="text"
                    bind:this={searchInputElement}
                    bind:value={searchText}
                    on:keydown={handleKeydown}
                    placeholder="検索..."
                    autocomplete="off"
                    spellcheck="false"
                    autofocus
                />
                <button
                    class="search-button"
                    on:click={handleSearchButtonClick}
                >
                    検索
                </button>
            </div>

            <div class="count-display">
                {#if searchText}
                    <!-- 検索結果表示の強調（改良版） -->
                    <span class="result-count">
                        {matchCount > 0 ? activeMatchOrdinal || 1 : 0} / {matchCount ||
                            1}
                    </span>
                {:else}
                    <span class="result-count">0 / 0</span>
                {/if}
            </div>

            <div class="controls">
                <IconButton
                    on:click={findPrevious}
                    tooltipContent="前を検索 (Shift+Enter)"
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
                    tooltipContent="次を検索 (Enter)"
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
                    tooltipContent="検索をクリア"
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
                    tooltipContent="閉じる (Esc)"
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
{/if}

<style>
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
