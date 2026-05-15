<script>
  import { createEventDispatcher, onDestroy } from "svelte";

  export let menuItems = [];
  export let position = { x: 0, y: 0, position: "right" };
  export let show = false;
  export let taskText = "";

  const dispatch = createEventDispatcher();
  let menuElement;
  let listenersAttached = false;

  $: menuSideClass = position.position === "left" ? "menu-position-left" : "menu-position-right";
  $: submenuSideClass =
    position.position === "left" ? "submenu-position-left" : "submenu-position-right";

  function handleOutsideEvent(event) {
    if (!show) return;
    if (menuElement && menuElement.contains(event.target)) return;
    // Ignore mousedowns on a three-dot trigger button. The button's own click
    // handler is responsible for toggling its menu, so if we closed here the
    // subsequent click would just re-open it (a "won't ever close" loop).
    if (
      event.target instanceof Element &&
      event.target.closest("[data-task-menu-trigger]")
    ) {
      return;
    }
    dispatch("close");
  }

  function attachListeners() {
    if (listenersAttached || typeof document === "undefined") return;
    // Use capture-phase pointerdown/mousedown so other buttons that call
    // stopPropagation in their click handlers still close the menu before
    // they fire. pointerdown also catches disabled buttons, whose mousedown
    // event is suppressed by Chromium.
    document.addEventListener("pointerdown", handleOutsideEvent, true);
    document.addEventListener("mousedown", handleOutsideEvent, true);
    document.addEventListener("contextmenu", handleOutsideEvent, true);
    window.addEventListener("blur", handleOutsideEvent);
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached || typeof document === "undefined") return;
    document.removeEventListener("pointerdown", handleOutsideEvent, true);
    document.removeEventListener("mousedown", handleOutsideEvent, true);
    document.removeEventListener("contextmenu", handleOutsideEvent, true);
    window.removeEventListener("blur", handleOutsideEvent);
    listenersAttached = false;
  }

  $: if (show) {
    attachListeners();
  } else {
    detachListeners();
  }

  onDestroy(() => {
    detachListeners();
  });

  function triggerAction(item, event) {
    event.preventDefault();
    event.stopPropagation();

    if (item.disabled || item.children?.length) {
      return;
    }

    dispatch(item.action, {
      ...item,
      text: taskText,
    });
    dispatch("close");
  }

  function portal(node) {
    document.body.appendChild(node);

    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }
</script>

{#if show}
  <div
    bind:this={menuElement}
    id="task-menu"
    class={menuSideClass}
    use:portal
    style:top={`${position.y}px`}
    style:left={position.position === "right" ? `${position.x}px` : undefined}
    style:right={position.position === "left" ? `calc(100vw - ${position.x}px)` : undefined}
  >
    <ul class="task-menu" role="menu" aria-label="Task actions">
      {#each menuItems as item}
        <li class="menu-item-shell">
          <button
            class="task-menu-item"
            class:disabled={item.disabled}
            class:has-children={item.children?.length > 0}
            disabled={item.disabled}
            role="menuitem"
            aria-disabled={item.disabled ? "true" : undefined}
            on:click={(event) => triggerAction(item, event)}
          >
            <span class="menu-item-content">
              {#if item.icon}
                <svg
                  viewBox={item.icon.viewBox}
                  xmlns="http://www.w3.org/2000/svg"
                  class="menu-icon"
                >
                  <path d={item.icon.path}></path>
                </svg>
              {/if}
              <span class="menu-label">{item.title}</span>
            </span>
            {#if item.children?.length}
              <span class="submenu-arrow">›</span>
            {/if}
          </button>

          {#if item.children?.length}
            <div class={`submenu ${submenuSideClass}`}>
              <ul class="task-menu" role="menu">
                {#each item.children as child}
                  <li class="menu-item-shell">
                    <button
                      class="task-menu-item"
                      role="menuitem"
                      on:click={(event) => triggerAction(child, event)}
                    >
                      <span class="menu-item-content">
                        {#if child.icon}
                          <svg
                            viewBox={child.icon.viewBox}
                            xmlns="http://www.w3.org/2000/svg"
                            class="menu-icon"
                          >
                            <path d={child.icon.path}></path>
                          </svg>
                        {/if}
                        <span class="menu-label">{child.title}</span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  #task-menu {
    position: fixed;
    z-index: 999999999999;
  }

  .task-menu {
    background: var(--theme-color-Main-main);
    border-radius: var(--shape-sm);
    box-shadow: 0 0.2rem 0.5rem rgba(0, 0, 0, 0.25);
    white-space: nowrap;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    min-width: 14rem;
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .menu-item-shell {
    position: relative;
    margin: 0;
    padding: 0;
    width: 100%;
    display: block;
  }

  .task-menu-item {
    width: 100%;
    text-align: left;
    padding: var(--sp2) var(--sp3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-radius: 0;
    color: var(--theme-color-Sub-light);
    font-size: var(--font-body-sm);
    margin: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    gap: var(--sp3);
  }

  .task-menu-item:hover:not(.disabled),
  .menu-item-shell:hover > .task-menu-item:not(.disabled) {
    background-color: var(--theme-color-Primary-dark);
  }

  .task-menu-item.disabled {
    opacity: 0.45;
    cursor: default;
  }

  .menu-item-content {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--sp2);
  }

  .menu-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu-icon {
    width: 0.95rem;
    height: 0.95rem;
    flex-shrink: 0;
    fill: var(--theme-color-Sub-light);
    stroke: var(--theme-color-Sub-light);
    stroke-width: 1.5;
  }

  .submenu-arrow {
    font-size: 1rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .submenu {
    position: absolute;
    top: 0;
    display: none;
    padding-inline: 0.35rem;
  }

  .submenu-position-right {
    left: 100%;
  }

  .submenu-position-left {
    right: 100%;
  }

  .menu-item-shell:hover > .submenu {
    display: block;
  }
</style>
