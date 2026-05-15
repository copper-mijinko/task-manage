<script>
  import { tick, createEventDispatcher, onDestroy } from "svelte";
  import { debounce } from "lodash";
  import { ripple, tooltip } from "@lib/actions";
  import TaskMenu from "@features/tasks/components/TaskMenu.svelte";
  import { pageSearchQuery } from "@features/search/stores/search";
  import { copied_task } from "@stores/ui";
  import { activePanelId } from "@stores/panel_coordinator";

  export let text;
  export let color = "var(--theme-color-Sub-main)";
  export let backgroundColor = "transparent";
  export let hasChildren = false;
  export let expanded = false;
  export let isRoot = false;
  export let canMoveUp = false;
  export let canMoveDown = false;
  export let canIndent = false;
  export let canOutdent = false;
  let draftText = text ?? "";
  let input;
  let isEditing = false;
  let showMenu = false;
  let menuPosition = { x: 0, y: 0 };
  const menuOwnerId = Math.random().toString(36).slice(2);

  // メニュー項目の定義
  $: menuItems = [
    {
      title: "rename",
      action: "rename",
      icon: {
        viewBox: "-4 -4 32 32",
        path: "M18.111,2.293,9.384,11.021a.977.977,0,0,0-.241.39L8.052,14.684A1,1,0,0,0,9,16a.987.987,0,0,0,.316-.052l3.273-1.091a.977.977,0,0,0,.39-.241l8.728-8.727a1,1,0,0,0,0-1.414L19.525,2.293A1,1,0,0,0,18.111,2.293Z",
      },
    },
    ...(!isRoot
      ? [
          {
            title: "add task below",
            action: "addBelow",
            icon: {
              viewBox: "0 0 24 24",
              path: "M12 5V19M5 12H19",
            },
          },
        ]
      : []),
    {
      title: "add child task",
      action: "addChild",
      icon: {
        viewBox: "0 0 24 24",
        path: "M5 5V14H15M11 10L15 14L11 18M19 5V9M17 7H21",
      },
    },
    ...(!isRoot
      ? [
          {
            title: "copy",
            action: "copyTask",
            icon: {
              viewBox: "0 0 24 24",
              path: "M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2ZM4 8H2v12a2 2 0 0 0 2 2h8v-2H4Z",
            },
          },
        ]
      : []),
    {
      title: "paste as child",
      action: "pasteTask",
      disabled: $copied_task === null,
      icon: {
        viewBox: "0 0 24 24",
        path: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2",
      },
    },
    ...(hasChildren
      ? [
          {
            title: expanded ? "collapse" : "expand",
            action: "toggleExpand",
            icon: {
              viewBox: "0 0 24 24",
              path: expanded ? "M6 9L12 15L18 9" : "M9 6L15 12L9 18",
            },
          },
        ]
      : []),
    {
      title: "move up",
      action: "moveUp",
      disabled: !canMoveUp,
      icon: {
        viewBox: "0 0 24 24",
        path: "M12 5L6 11H10V19H14V11H18L12 5Z",
      },
    },
    {
      title: "move down",
      action: "moveDown",
      disabled: !canMoveDown,
      icon: {
        viewBox: "0 0 24 24",
        path: "M12 19L18 13H14V5H10V13H6L12 19Z",
      },
    },
    {
      title: "move right",
      action: "indentTask",
      disabled: !canIndent,
      icon: {
        viewBox: "0 0 24 24",
        path: "M4 6H14V8H4V6ZM4 11H14V13H4V11ZM4 16H14V18H4V16ZM12 9L17 14L12 19V16H8V12H12V9Z",
      },
    },
    {
      title: "move left",
      action: "outdentTask",
      disabled: !canOutdent,
      icon: {
        viewBox: "0 0 24 24",
        path: "M10 9L5 14L10 19V16H16V12H10V9ZM10 6H20V8H10V6ZM10 16H20V18H10V16Z",
      },
    },
    {
      title: "show details",
      action: "openTaskDetailWindow",
      icon: {
        viewBox: "0 0 24 24",
        path: "M12 4C7 4 2.73 7.11 1 12c1.73 4.89 6 8 11 8s9.27-3.11 11-8c-1.73-4.89-6-8-11-8Zm0 13a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8.2A3.2 3.2 0 1 0 12 15.2 3.2 3.2 0 0 0 12 8.8Z",
      },
    },
    ...(!isRoot
      ? [
          {
            title: "delete task",
            action: "deleteTask",
            icon: {
              viewBox: "0 0 48 48",
              path: "M13.05 42q-1.25 0-2.125-.875T10.05 39V10.5H8v-3h9.4V6h13.2v1.5H40v3h-2.05V39q0 1.2-.9 2.1-.9.9-2.1.9Zm21.9-31.5h-21.9V39h21.9Zm-16.6 24.2h3V14.75h-3Zm8.3 0h3V14.75h-3Zm-13.6-24.2V39Z",
            },
          },
        ]
      : []),
  ];

  const dispatch = createEventDispatcher();

  let lastSubmittedText = null;
  $: if (!isEditing) {
    draftText = text ?? "";
  }
  $: if ((text ?? "") === lastSubmittedText) {
    lastSubmittedText = null;
  }

  const params = {
    color: "var(--theme-color-Main-main)",
    backgroundColor: "var(--theme-color-Sub-main)",
    wrapped: true,
  };

  const spanTooltipParams = {
    color: "var(--theme-color-Main-main)",
    backgroundColor: "var(--theme-color-Sub-main)",
  };

  function splitHighlight(str, query) {
    if (!query) return [{ t: str ?? "", h: false }];
    const lower = (str ?? "").toLowerCase();
    const lowerQ = query.toLowerCase();
    const parts = [];
    let pos = 0;
    while (pos <= lower.length) {
      const idx = lower.indexOf(lowerQ, pos);
      if (idx === -1) {
        parts.push({ t: (str ?? "").slice(pos), h: false });
        break;
      }
      if (idx > pos) parts.push({ t: (str ?? "").slice(pos, idx), h: false });
      parts.push({ t: (str ?? "").slice(idx, idx + lowerQ.length), h: true });
      pos = idx + lowerQ.length;
    }
    return parts;
  }

  $: highlightParts =
    !isEditing && $pageSearchQuery ? splitHighlight(text, $pageSearchQuery) : null;

  const dispatchCommitIfChanged = () => {
    if (!draftText.trim()) {
      return;
    }
    const currentText = text ?? "";
    if (draftText === currentText || draftText === lastSubmittedText) {
      return;
    }

    lastSubmittedText = draftText;
    dispatch("commit", { value: draftText });
  };

  const debouncedCommit = debounce(dispatchCommitIfChanged, 300);

  onDestroy(() => {
    debouncedCommit.cancel();
  });

  const toggle = async () => {
    isEditing = !isEditing;
    if (isEditing) {
      await tick();
      input.focus();
    }
  };

  const flushCommit = () => {
    debouncedCommit.cancel();
    if (!draftText.trim()) {
      draftText = text ?? "";
      return;
    }
    dispatchCommitIfChanged();
  };

  const resetDraft = () => {
    debouncedCommit.cancel();
    draftText = text ?? "";
  };

  const getMenuPosition = (x, y) => {
    const viewportWidth = window.innerWidth;
    const menuWidth = 224; // 14rem at 16px base font, matches actual CSS min-width

    if (x + menuWidth > viewportWidth) {
      return {
        x,
        y,
        position: "left",
      };
    }

    return {
      x,
      y,
      position: "right",
    };
  };

  const setMenuVisibility = (open) => {
    if (showMenu === open) {
      return;
    }

    showMenu = open;
    dispatch("menuVisibilityChange", { open });
  };

  const closeMenu = () => {
    setMenuVisibility(false);
  };

  // Close this menu when another panel/menu becomes active
  $: if ($activePanelId !== null && $activePanelId !== menuOwnerId && showMenu) {
    closeMenu();
  }

  export async function openMenuAt(position) {
    activePanelId.set(menuOwnerId);
    menuPosition = getMenuPosition(position.x, position.y);
    setMenuVisibility(true);

    await tick();

    const menuEl = document.getElementById("task-menu");
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.bottom > viewportHeight) {
        const adjustedY = Math.max(0, menuPosition.y - (rect.bottom - viewportHeight));
        menuPosition = { ...menuPosition, y: adjustedY };
      }
    }
  }

  const openMenu = (e) => {
    e.stopPropagation();

    // Toggle: clicking the three-dot a second time should close the menu.
    if (showMenu) {
      closeMenu();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    openMenuAt({
      x: rect.right,
      y: rect.bottom,
    });
  };

  // メニューイベントハンドラ
  function handleMenuAction(event) {
    const data = event.detail;
    if (data && data.action === "rename") {
      toggle();
    } else if (data && data.action === "openTaskDetailWindow") {
      dispatch("openTaskDetailWindow", { text: text ?? draftText });
    } else if (data?.action) {
      dispatch(data.action, data);
    }
  }
</script>

<div style="--color:{color}; --backgroundColor:{backgroundColor};">
  {#if highlightParts}
    <span class="highlight-display" use:tooltip={spanTooltipParams}>
      {#each highlightParts as part}
        {#if part.h}<mark>{part.t}</mark>{:else}{part.t}{/if}
      {/each}
    </span>
  {/if}
  <input
    type="text"
    bind:this={input}
    value={draftText}
    disabled={!isEditing}
    draggable="true"
    class:hidden-by-highlight={highlightParts}
    on:blur={() => {
      if (!isEditing) {
        return;
      }
      flushCommit();
      isEditing = false;
    }}
    on:input={(e) => {
      draftText = e.currentTarget.value;
      debouncedCommit();
    }}
    on:click={(e) => {
      if (isEditing) {
        e.stopPropagation();
      }
    }}
    on:keydown={(e) => {
      if (!isEditing) {
        return;
      }
      if (e.key === "Enter") {
        flushCommit();
        isEditing = false;
      } else if (e.key === "Escape") {
        resetDraft();
        isEditing = false;
      }
    }}
    on:dragstart={(e) => {
      if (isEditing) {
        e.preventDefault();
        e.stopPropagation();
      }
    }}
    on:drag={(e) => {
      if (isEditing) {
        e.preventDefault();
        e.stopPropagation();
      }
    }}
    on:dragend={(e) => {
      if (isEditing) {
        e.preventDefault();
        e.stopPropagation();
      }
    }}
    use:tooltip={params}
  />

  <button
    class="menu-button"
    aria-label="Open task actions"
    data-task-menu-trigger={menuOwnerId}
    use:ripple={{ duration: 350, color: color }}
    on:click={openMenu}
  >
    <svg height="100%" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  </button>

  <TaskMenu
    {menuItems}
    position={menuPosition}
    show={showMenu}
    taskText={draftText}
    on:rename={handleMenuAction}
    on:addBelow={handleMenuAction}
    on:addChild={handleMenuAction}
    on:toggleExpand={handleMenuAction}
    on:moveUp={handleMenuAction}
    on:moveDown={handleMenuAction}
    on:indentTask={handleMenuAction}
    on:outdentTask={handleMenuAction}
    on:openTaskDetailWindow={handleMenuAction}
    on:deleteTask={handleMenuAction}
    on:close={closeMenu}
  />
</div>

<style>
  div {
    width: 100%;
    height: 100%;
    padding: 0 var(--sp2);
    margin: 0;
    display: flex;
    align-items: center;
    flex: 1;
    position: relative;
  }
  .highlight-display {
    position: relative;
    border: none;
    padding: 0;
    margin: 0;
    width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--color);
    background-color: var(--backgroundColor);
    font: inherit;
    cursor: default;
  }
  .highlight-display mark {
    background-color: color-mix(in srgb, #f5c518 60%, transparent);
    color: inherit;
    border-radius: var(--shape-xs);
    padding: 0 1px;
  }
  input.hidden-by-highlight {
    display: none;
  }
  input {
    appearance: none;
    background-color: var(--backgroundColor);
    border: none;
    color: var(--color);
    padding: 0;
    margin: 0;
    width: 100%;
    position: relative;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  input:disabled {
    background-color: var(--backgroundColor);
    color: var(--color);
    -webkit-text-fill-color: var(--color);
    opacity: 1;
    pointer-events: none;
  }
  button {
    width: 1.75rem;
    height: 1.75rem;
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    background-color: transparent !important;
    margin: 0 2px;
    padding: 0;
    color: var(--theme-color-Sub-main);
    transition: background-color 0.12s ease;
  }
  button:hover {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent) !important;
  }
  button:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  button svg {
    width: 1.15rem;
    height: 1.15rem;
    fill: currentColor;
  }
  .menu-button svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  :global(#task-menu) {
    position: fixed;
    z-index: 999999999999;
  }

  :global(.task-menu) {
    background: var(--theme-color-Main-dark);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-xs);
    box-shadow: var(--elevation-2);
    white-space: nowrap;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    min-width: fit-content;
    display: flex;
    flex-direction: column;
  }

  :global(.menu-right) {
    left: var(--menu-pos-x);
  }

  :global(.menu-left) {
    right: calc(100% - var(--menu-pos-x));
  }

  :global(.task-menu li) {
    margin: 0;
    padding: 0;
    width: 100%;
    display: block;
  }

  :global(.task-menu-item) {
    width: 100%;
    text-align: left;
    padding: 4px 6px;
    display: flex;
    align-items: center;
    border-radius: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    height: auto;
    aspect-ratio: auto;
    margin: 0;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  :global(.task-menu-item:hover) {
    background-color: var(--theme-color-Theme-dark);
  }

  :global(.task-menu-item svg) {
    margin-right: 4px;
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    fill: var(--theme-color-Sub-main);
  }

  :global(.task-menu-item span) {
    flex: 0 1 auto;
  }
</style>
