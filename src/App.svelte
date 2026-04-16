<script>
  import {
    selected_type,
    selected_id,
    init_store,
    showPageSearch,
    theme,
  } from "./stores.js";
  import { onMount, onDestroy, tick } from "svelte";
  import ProjectPage from "./components/ProjectPage.svelte";
  import Header from "./components/Header.svelte";
  import InfoPage from "./components/InfoPage.svelte";
  import Modal from "./components/Modal.svelte";
  import Button from "./components/Button.svelte";
  import PageSearchBox from "./components/PageSearchBox.svelte";
  let show = Array(4).fill(false);

  ////////////// Initial Settings //////////////
  init_store();

  // ページ内検索ショートカットキー設定
  let searchBox;
  let isSearchWindow = false;
  let isTaskWindow = false;
  let taskWindowData = { id: null, text: "" };

  async function loadTaskData() {
    try {
      if (window.electronAPI && window.electronAPI.getTaskData) {
        const data = await window.electronAPI.getTaskData();
        if (data) {
          taskWindowData = data;
          document.title = `タスク: ${data.text || "詳細"}`;
        }
      }
    } catch (error) {
      console.error("タスクデータ取得エラー:", error);
    }
  }

  // 検索ウィンドウでのテーマ初期化処理
  async function initSearchWindowTheme() {
    try {
      if (window.electronAPI && window.electronAPI.getCurrentTheme) {
        // メインウィンドウから現在のテーマを取得
        const currentTheme = await window.electronAPI.getCurrentTheme();
        if (currentTheme) {
          // テーマを設定
          theme.set(currentTheme);
        }
      }
    } catch (error) {
      console.error("テーマ初期化エラー:", error);
    }
  }

  function handleKeyDown(event) {
    // Ctrl+FまたはCmd+F (Macの場合)
    if ((event.ctrlKey || event.metaKey) && event.key === "f") {
      event.preventDefault();
      if (window.electronAPI && !isSearchWindow) {
        // 別ウィンドウで検索ボックスを開く
        window.electronAPI.openSearchWindow();
      } else {
        // 通常の検索ボックスを表示（検索ウィンドウの場合やAPIがない場合）
        $showPageSearch = true;
        searchBox?.focusInput();
      }
    }
  }

  onMount(async () => {
    // URLハッシュを確認してウィンドウタイプを判断
    const hash = window.location.hash;

    if (hash === "#search-window") {
      isSearchWindow = true;

      // 検索ウィンドウでは自動的に検索ボックスを表示
      $showPageSearch = true;
      await tick();
      searchBox?.focusInput();

      // ウィンドウサイズを検索ボックスに合わせる
      document.body.style.overflow = "hidden";
      document.querySelector(".Container").style.height = "auto";
      document.querySelector(".Main").style.display = "none";
      document.querySelector(".Header").style.display = "none";
    } else if (hash === "#task-window") {
      isTaskWindow = true;

      // タスクデータを取得
      await loadTaskData();
    }

    // テーマ初期化
    await initSearchWindowTheme();

    // テーマ変更通知のリスナー登録
    if (window.electronAPI && window.electronAPI.onThemeChanged) {
      window.electronAPI.onThemeChanged((newTheme) => {
        console.log("Received theme change:", newTheme);
        theme.set(newTheme);
      });
    }

    window.addEventListener("keydown", handleKeyDown);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown);
  });
</script>

<div class:Container={true}>
  <div class="Header">
    <Header />
  </div>
  <div class="Main">
    {#if isTaskWindow}
      <div class="TaskWindow">
        <h2 style="color:var(--theme-color-Sub-main); text-align:center;">
          {taskWindowData.text || "タスク詳細"}
        </h2>
        <div class="TaskContent">
          <p style="color:var(--theme-color-Sub-main); text-align:center;">
            タスクID: {taskWindowData.id || "不明"}
          </p>
          <!-- ここにタスクの詳細コンテンツを表示 -->
          <div class="TaskActions">
            <Button
              content="閉じる"
              on:click={() => {
                window.close();
              }}
            />
          </div>
        </div>
      </div>
    {:else}
      {#if !($selected_type && $selected_id)}
        <h1
          style="color:var(--theme-color-Sub-main); display:flex; justify-content:center"
        >
          No data.
        </h1>
      {/if}
      {#if $selected_type == "Projects"}
        <ProjectPage />
      {/if}
      {#if $selected_type == "Info"}
        <div
          style="height:100%; display: flex; flex-direction: column; justify-content: center; align-items: center;"
        >
          {#each [1, 2, 3, 4] as i}
            <Button
              content="Setp{i}"
              on:click={() => {
                show[i - 1] = !show[i - 1];
              }}
            />
            <Modal
              show={show[i - 1]}
              toggle={() => {
                show[i - 1] = !show[i - 1];
              }}
            >
              <InfoPage index={i} />
            </Modal>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- 検索ボックスを直接body直下に配置（他の要素と独立して） -->
<PageSearchBox
  bind:this={searchBox}
  show={$showPageSearch}
  on:close={() => {
    $showPageSearch = false;
    if (isSearchWindow && window.electronAPI) {
      // 検索ウィンドウの場合、閉じるボタンでウィンドウを閉じる
      window.close();
    }
  }}
  {isSearchWindow}
/>

<style>
  :global(html) {
    font-size: 75%;
  }
  :global(body) {
    font-family: "Roboto", "Helvetica", "Arial", sans-serif;
    padding: 0;
    margin: 0;
  }
  div.Container {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    width: 100%;
    background-color: var(--theme-color-Main-dark);
    margin: 0;
    padding: 0;
    overflow: auto;
    position: relative; /* 子要素のためのコンテキスト設定 */
  }
  div.Header {
    height: 3.5rem;
  }
  div.Main {
    display: flex;
    justify-content: center;
    align-items: center;
    height: calc(100% - 3.5rem);
    width: 100%;
    flex: 1;
  }

  /* タスクウィンドウのスタイル */
  .TaskWindow {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    box-sizing: border-box;
    color: var(--theme-color-Sub-main);
  }

  .TaskContent {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 1rem;
    background-color: var(--theme-color-Main-main);
    border-radius: 0.5rem;
    margin-top: 1rem;
  }

  .TaskActions {
    display: flex;
    justify-content: center;
    margin-top: 2rem;
  }
</style>
