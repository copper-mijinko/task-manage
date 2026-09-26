<script>
  import {
    selected_type,
    selected_id,
    init_store,
    autoSelectInitialProject,
    showPageSearch,
    theme,
    saveStatus,
    workspace_store,
    navigation_history,
  } from "@stores";
  import { onMount, onDestroy, tick } from "svelte";
  import * as platform from "@lib/ipc/platform";
  import { workspaceApplication } from "@features/workspace/application/workspace";
  import Header from "@features/navigation/components/Header.svelte";
  import MenuList from "@features/navigation/components/MenuList.svelte";
  import { showQuickCapture, showWorkspaceSetup } from "@stores/ui";
  import Loading from "@lib/primitives/Loading.svelte";
  import PageSearchBox from "@features/search/components/PageSearchBox.svelte";
  import { sidebarCollapsed } from "@stores";
  import { startAutoRescan, stopAutoRescan } from "@features/search/utils/page_search_highlighter";
  import { registerDateTimeShortcuts } from "@lib/utils/datetime_shortcuts";
  let saveErrorMessage = $state(null);
  let unregisterDateTimeShortcuts = null;
  let WorkspaceTreeGridPageComponent = $state(null);
  let QuickCaptureComponent = $state(null);
  let workspaceTreeGridPageLoading = null;
  let quickCaptureLoading = null;

  init_store();

  /**
   * サイドバーを本文と併置できる幅か。
   *
   * 狭いときはオーバーレイのドロワー、広いときは常時表示のレールにする。
   * CSS 側の @media (min-width: 1000px) と同じ閾値。スクリムの有無は
   * マークアップで決める必要があるので、こちらでも幅を見る。
   */
  let viewportWidth = $state(typeof window !== "undefined" ? window.innerWidth : 1280);
  let wideLayout = $derived(viewportWidth >= 1000);

  function loadWorkspaceTreeGridPage() {
    if (WorkspaceTreeGridPageComponent || workspaceTreeGridPageLoading)
      return workspaceTreeGridPageLoading;
    workspaceTreeGridPageLoading =
      import("@features/workspace/components/WorkspaceTreeGridPage.svelte").then((module) => {
        WorkspaceTreeGridPageComponent = module.default;
      });
    return workspaceTreeGridPageLoading;
  }

  function loadQuickCapture() {
    if (QuickCaptureComponent || quickCaptureLoading) return quickCaptureLoading;
    quickCaptureLoading = import("@features/inbox/components/QuickCapture.svelte").then(
      (module) => {
        QuickCaptureComponent = module.default;
      }
    );
    return quickCaptureLoading;
  }

  $effect.pre(() => {
    if ($selected_type === "WorkspaceProject") void loadWorkspaceTreeGridPage();
  });
  $effect.pre(() => {
    if ($showQuickCapture) void loadQuickCapture();
  });

  // capture-phase で window keydown を捕まえているため、CodeMirror や Quill、
  // ネイティブの input / textarea / contenteditable にフォーカスがある状態で
  // Ctrl+Z / Ctrl+Y を叩くと、エディタの undo/redo より先にノードツリー側の
  // 履歴が動いてしまう。フォーカスがそれらの編集面の中にある間はグローバルの
  // undo/redo をスキップし、エディタ自身のキーマップに処理を委ねる。
  function isInsideEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(".cm-editor")) return true;
    if (target.closest(".ql-editor")) return true;
    if (target.closest('[contenteditable=""], [contenteditable="true"]')) return true;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return false;
  }

  function handleKeyDown(event) {
    // Ctrl+F is handled by Header.svelte (focuses the inline search input)

    // Ctrl+Shift+I はどこからでもクイック追加を開く。編集中でも受け付けるので、
    // 書きかけの内容を失わずに思いつきを Inbox へ入れられる。
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      (event.key === "I" || event.key === "i")
    ) {
      if (!$workspace_store.activeWorkspacePath) return;
      event.preventDefault();
      event.stopPropagation();
      $showQuickCapture = true;
      return;
    }

    if (isInsideEditableTarget(event.target)) return;

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === "z") {
      event.preventDefault();
      event.stopPropagation();
      void workspaceApplication.undo().catch((error) => (saveErrorMessage = error.message));
      return;
    }

    if (
      ((event.ctrlKey || event.metaKey) && event.key === "y") ||
      ((event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        (event.key === "z" || event.key === "Z"))
    ) {
      event.preventDefault();
      event.stopPropagation();
      void workspaceApplication.redo().catch((error) => (saveErrorMessage = error.message));
      return;
    }

    // Browser-style "back / forward" through the visited-page history.
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigation_history.back();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        navigation_history.forward();
      }
    }
  }

  // Mouse XButtons (back / forward thumb buttons on most mice).
  // Browsers fire `mouseup` with `button === 3` (back) / `4` (forward).
  function handleMouseUp(event) {
    if (event.button === 3) {
      event.preventDefault();
      navigation_history.back();
    } else if (event.button === 4) {
      event.preventDefault();
      navigation_history.forward();
    }
  }

  async function reportInitialWorkspaceVisible() {
    try {
      await tick();
      const report = () =>
        platform.reportPerformanceMilestone({
          name: "startup.initialWorkspaceVisible",
          durationMs: performance.now(),
        });
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(report);
      } else {
        report();
      }
    } catch {
      // Performance reporting must never affect startup.
    }
  }

  onMount(async () => {
    try {
      performance.mark("app-mounted");
      performance.measure("renderer-to-mount", "renderer-start", "app-mounted");
    } catch {
      // renderer-start not set (e.g. test environment)
    }

    platform.reportPerformanceMilestone({
      name: "startup.mounted",
      durationMs: performance.now(),
    });
    void autoSelectInitialProject().then(
      () => reportInitialWorkspaceVisible(),
      () => reportInitialWorkspaceVisible()
    );

    try {
      const currentTheme = await platform.getCurrentTheme();
      if (currentTheme) theme.applyExternal(currentTheme);
    } catch {
      // ignore theme initialization error
    }
    platform.onThemeChanged((newTheme) => theme.applyExternal(newTheme));

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("mouseup", handleMouseUp);

    platform.onSaveError((message) => {
      saveErrorMessage = message;
      saveStatus.set("error");
    });

    // Start the document-wide page-search highlighter. It watches the whole
    // document for changes and re-applies CSS Custom Highlight ranges.
    startAutoRescan();

    unregisterDateTimeShortcuts = registerDateTimeShortcuts();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("mouseup", handleMouseUp);
    stopAutoRescan();
    unregisterDateTimeShortcuts?.();
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<div class:Container={true}>
  <div class="notification-stack">
    {#if saveErrorMessage}
      <div class="save-error-banner" role="alert">
        <span>{saveErrorMessage}</span>
        <button
          onclick={() => {
            saveErrorMessage = null;
            $saveStatus = "idle";
          }}>×</button
        >
      </div>
    {/if}
  </div>
  <div class="Header">
    <Header />
  </div>
  <div class="Body">
    <aside
      class="Sidebar"
      class:Collapsed={$sidebarCollapsed}
      aria-label="ナビゲーション"
      aria-hidden={$sidebarCollapsed ? "true" : undefined}
      inert={$sidebarCollapsed}
    >
      <MenuList />
    </aside>
    <div class="Main">
      {#if !($selected_type && $selected_id)}
        <section class="EmptyStart" aria-labelledby="empty-start-title">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7.5h7l2 2h9v9.5H3V7.5Z" />
            <path d="M7 14h10M12 9v10" />
          </svg>
          <h1 id="empty-start-title">ワークスペースを追加して始めましょう</h1>
          <p>保存先のフォルダーを設定すると、プロジェクトとメモを作成できます。</p>
          <button
            type="button"
            onclick={() => {
              $sidebarCollapsed = false;
              $showWorkspaceSetup = true;
            }}>ワークスペースを設定</button
          >
        </section>
      {/if}
      {#if $selected_type == "WorkspaceProject"}
        {#if WorkspaceTreeGridPageComponent}
          {#key $workspace_store.activeWorkspacePath}<WorkspaceTreeGridPageComponent />{/key}
        {:else}
          <Loading variant="h1" />
        {/if}
      {/if}
      {#if !$sidebarCollapsed && !wideLayout}
        <!-- 狭いときだけオーバーレイ。広いときはレールとして併置するので
             スクリムは出さない（出すと併置している意味がなくなる）。 -->
        <button
          type="button"
          class="SidebarMask"
          aria-label="サイドバーを閉じる"
          onclick={() => ($sidebarCollapsed = true)}
        ></button>
      {/if}
    </div>
  </div>
</div>

<!-- 検索ボックスを直接body直下に配置（他の要素と独立して） -->
<PageSearchBox
  show={$showPageSearch}
  onclose={() => {
    $showPageSearch = false;
  }}
/>

{#if QuickCaptureComponent}
  <QuickCaptureComponent
    show={$showQuickCapture}
    onclose={() => {
      $showQuickCapture = false;
    }}
  />
{/if}

<style>
  .notification-stack {
    position: fixed;
    top: 2.25rem;
    right: 0.75rem;
    width: min(24rem, calc(100vw - 1.5rem));
    max-height: calc(100vh - 3rem);
    overflow-y: auto;
    z-index: 10000;
    display: grid;
    gap: var(--sp2);
    pointer-events: none;
  }
  .notification-stack > :global(div) {
    pointer-events: auto;
    border-radius: var(--shape-sm);
    box-shadow: var(--elevation-3);
    overflow-wrap: anywhere;
  }
  :global(html) {
    overflow: hidden;
  }
  :global(body) {
    font-family: "Roboto", "Helvetica", "Arial", sans-serif;
    padding: 0;
    margin: 0;
    overflow: hidden;
  }
  div.Container {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100vh;
    width: 100vw;
    background-color: var(--theme-color-Main-dark);
    margin: 0;
    padding: 0;
    overflow: hidden;
    position: relative;
  }
  div.Header {
    height: 2.0625rem;
  }
  div.Body {
    position: relative;
    display: flex;
    flex-direction: row;
    flex: 1;
    min-height: 0;
    width: 100%;
    height: calc(100% - 2.0625rem);
    overflow: hidden;
  }
  /* 狭い幅ではオーバーレイのドロワー。広い幅では下の media query で
     本文と併置するレールになる。 */
  aside.Sidebar {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 1001;
    width: 13.5rem;
    max-width: 90%;
    height: 100%;
    background-color: var(--canvas-subtle);
    box-shadow: var(--elevation-1);
    transition:
      transform 0.18s ease,
      visibility 0.18s;
    overflow: hidden;
    box-sizing: border-box;
  }
  aside.Sidebar.Collapsed {
    transform: translateX(-100%);
    box-shadow: none;
    visibility: hidden;
    pointer-events: none;
  }

  /* 本文と併置できる幅では、サイドバーを常時表示のレールにする。
     オーバーレイのままだと、1280px でも 216px のサイドバーを開くだけで
     残り 1064px のツリーと詳細がスクリムで覆われて操作できなくなり、
     ツリーを見ながらプロジェクトを切り替える・ドラッグする、ができなかった。
     モバイル向けのパターンをデスクトップに持ち込んでいた形。 */
  @media (min-width: 1000px) {
    aside.Sidebar {
      position: relative;
      inset: auto;
      z-index: auto;
      flex: 0 0 13.5rem;
      box-shadow: none;
      border-right: 1px solid var(--border-muted);
      transform: none;
      transition: none;
    }
    aside.Sidebar.Collapsed {
      display: none;
    }
  }
  div.Main {
    display: flex;
    justify-content: center;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    position: relative;
  }
  .EmptyStart {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 24rem;
    padding: var(--sp6);
    color: var(--theme-color-Sub-main);
    text-align: center;
  }
  .EmptyStart svg {
    width: 2.25rem;
    height: 2.25rem;
    margin-bottom: var(--sp3);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.72;
  }
  .EmptyStart h1 {
    margin: 0;
    color: var(--theme-color-Sub-light);
    font-size: var(--font-title-lg);
  }
  .EmptyStart p {
    margin: var(--sp2) 0 var(--sp4);
    font-size: var(--font-body-md);
  }
  .EmptyStart button {
    min-height: 1.875rem;
    padding: 0 var(--sp4);
    border: 1px solid var(--theme-color-Primary-main);
    border-radius: var(--shape-sm);
    color: var(--on-theme-primary);
    background: var(--theme-color-Primary-main);
    font-weight: 700;
    cursor: pointer;
  }
  .EmptyStart button:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  /* SplitPanes 内の Resizer は z-index: 999。マスクはそれより上に置く。 */
  .SidebarMask {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background-color: rgba(0, 0, 0, 0.35);
    cursor: pointer;
    z-index: 1000;
  }
  .SidebarMask:focus {
    outline: none;
  }
  .save-error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp1) var(--sp3);
    background-color: var(--theme-color-Error-main);
    color: #fff;
    font-size: var(--font-body-sm);
    flex-shrink: 0;
    z-index: 10000;
  }
  .save-error-banner button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: var(--font-body-md);
    line-height: 1;
    padding: 0 var(--sp1);
  }
</style>
