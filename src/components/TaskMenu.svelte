<script>
  import { createEventDispatcher } from "svelte";

  export let menuItems = [];
  export let position = { x: 0, y: 0, position: "right" };
  export let show = false;
  export let taskText = "";

  const dispatch = createEventDispatcher();
  let menuElement;

  $: menuSideClass = position.position === "left" ? "menu-position-left" : "menu-position-right";
  $: submenuSideClass =
    position.position === "left" ? "submenu-position-left" : "submenu-position-right";

  function handleClickOutside(event) {
    if (show && menuElement && !menuElement.contains(event.target)) {
      dispatch("close");
    }
  }

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

<svelte:window on:click={handleClickOutside} />

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
    border-radius: 0.5rem;
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
    padding: 0.45rem 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-radius: 0;
    color: var(--theme-color-Sub-light);
    font-size: 0.85rem;
    margin: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    gap: 0.75rem;
  }

  .task-menu-item:hover:not(.disabled),
  .menu-item-shell:hover > .task-menu-item:not(.disabled) {
    background-color: var(--theme-color-Accent-dark);
  }

  .task-menu-item.disabled {
    opacity: 0.45;
    cursor: default;
  }

  .menu-item-content {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.5rem;
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
