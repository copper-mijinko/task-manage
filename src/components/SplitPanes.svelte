<script>
  import { onDestroy, onMount } from "svelte";

  export let defaultRatio = [];

  let split_pane_root; // Bind

  // Resize
  let resizers = [];
  let handlers = [];
  let resize_observer;
  let mutation_observer;
  let paneCount = 0;

  // Min width
  let minWidth;

  onMount(() => {
    refreshLayout();

    mutation_observer = new MutationObserver((mutations) => {
      const paneChanged = mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) => node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("Pane")
        )
      );
      if (paneChanged) {
        refreshLayout(true);
      }
    });
    mutation_observer.observe(split_pane_root, {
      childList: true,
    });
  });

  onDestroy(() => {
    mutation_observer?.disconnect();
    resize_observer?.disconnect();
    unsetResizerEvents(resizers, handlers);
  });

  const refreshLayout = (preserveWidths = false) => {
    unsetResizerEvents(resizers, handlers);
    handlers = [];
    resizers.forEach((resizer) => resizer.remove());
    resizers = [];

    const panes = [...split_pane_root.querySelectorAll(":scope > .Pane")];
    const canPreserveWidths = preserveWidths && panes.length === paneCount;
    paneCount = panes.length;
    minWidth = `${4 * panes.length}rem`; // magic number 4rem.

    if (!panes.length) {
      resize_observer?.disconnect();
      resize_observer = undefined;
      return;
    }

    const rootWidth = split_pane_root.getBoundingClientRect().width;
    const widths = getPaneWidths(panes, rootWidth, canPreserveWidths);

    panes.forEach((pane, index) => {
      pane.style.width = `${widths[index]}px`;
    });

    resizers = createResizers(panes, widths);
    handlers = setResizersEvents(resizers, panes);
    observeRootResize(panes);
  };

  const getPaneWidths = (panes, rootWidth, preserveWidths) => {
    if (preserveWidths) {
      const currentWidths = panes.map((pane) => pane.getBoundingClientRect().width);
      const currentTotal = currentWidths.reduce((partialSum, width) => partialSum + width, 0);
      if (currentTotal > 0) {
        return currentWidths.map((width) => (width * rootWidth) / currentTotal);
      }
    }

    let ratios = defaultRatio;
    if (panes.length > ratios.length) {
      ratios = ratios.concat(new Array(panes.length - ratios.length).fill(1));
    } else if (panes.length < ratios.length) {
      ratios = ratios.slice(0, panes.length);
    }
    const ratioSum = ratios.reduce((partialSum, ratio) => partialSum + ratio, 0) || panes.length;
    return ratios.map((ratio) => (rootWidth * ratio) / ratioSum);
  };

  const createResizers = (panes, paneWidths) => {
    const nextResizers = [];
    let left = 0;

    panes.forEach((pane, index) => {
      if (index == 0) {
        return;
      }
      const resizer = document.createElement("div");
      resizer.classList.add("Resizer");
      resizer.style.left = `${left + paneWidths[index - 1] - 3}px`;
      left += paneWidths[index - 1];
      pane.parentNode.insertBefore(resizer, pane);
      nextResizers.push(resizer);
    });

    return nextResizers;
  };

  const observeRootResize = (panes) => {
    resize_observer?.disconnect();
    resize_observer = new ResizeObserver((entries) => {
      // Width setting
      let root_width = 0;
      panes.forEach((pane) => {
        root_width += pane.getBoundingClientRect().width;
      });
      if (root_width === 0) {
        return;
      }
      let new_root_width = entries[0].contentRect.width;
      let new_pane_widths = [];
      panes.forEach((pane) => {
        new_pane_widths.push((pane.getBoundingClientRect().width * new_root_width) / root_width);
      });
      panes.forEach((pane, index) => {
        pane.style.width = `${new_pane_widths[index]}px`;
      });
      let left = 0;
      resizers.forEach((resizer, index) => {
        resizer.style.left = `${left + new_pane_widths[index] - 3}px`;
        left += new_pane_widths[index];
      });
    });
    resize_observer.observe(split_pane_root);
  };

  const setResizersEvents = (resizers, panes) => {
    const handlers = [];
    // Create resizers and their events
    for (let i = 0; i < resizers.length; i++) {
      const pane = panes[i];
      const pane_r = panes[i + 1];
      const resizer = resizers[i];

      const style_min_w = window.getComputedStyle(pane).minWidth;
      const min_w = style_min_w.includes("%")
        ? (parseFloat(window.getComputedStyle(pane).minWidth, 10) / 100) *
          split_pane_root.getBoundingClientRect().width
        : parseFloat(window.getComputedStyle(pane).minWidth, 10) || 10;
      const style_min_wr = window.getComputedStyle(pane_r).minWidth;
      const min_wr = style_min_wr.includes("%")
        ? (parseFloat(window.getComputedStyle(pane_r).minWidth, 10) / 100) *
          split_pane_root.getBoundingClientRect().width
        : parseFloat(window.getComputedStyle(pane_r).minWidth, 10) || 10;

      // Track the current position of mouse
      let x = 0;
      let w = 0;
      let wr = 0;
      let l = 0;

      const mouseDownHandler = function (e) {
        let cssText = document.body.style.cssText;
        document.body.style.cssText = cssText + "cursor: col-resize !important;";

        // Add HandlingResizer class
        resizer.classList.add("HandlingResizer");

        // Get the current mouse position
        x = e.clientX;

        // Calculate the current width of column
        w = pane.getBoundingClientRect().width;
        wr = pane_r.getBoundingClientRect().width;

        // Calculate the curent left of resizer
        l = resizer.getBoundingClientRect().left - resizer.parentNode.getBoundingClientRect().left;

        // Attach listeners for document's events
        document.addEventListener("mousemove", mouseMoveHandler);
        document.addEventListener("mouseup", mouseUpHandler);
      };

      const mouseMoveHandler = function (e) {
        // Determine how far the mouse has been moved
        let dx = e.clientX - x;
        let new_width = w + dx;
        let new_widthr = wr - dx;

        if (new_width < min_w) {
          new_widthr = w + wr - min_w;
          new_width = min_w;
          dx = new_width - w;
        }
        if (new_widthr < min_wr) {
          new_width = w + wr - min_wr;
          new_widthr = min_wr;
          dx = new_width - w;
        }

        // Update the width of column
        pane.style.width = `${new_width}px`;
        pane_r.style.width = `${new_widthr}px`;

        // Update resizer pos
        resizer.style.left = `${l + dx}px`;
      };

      // When user releases the mouse, remove the existing event listeners
      const mouseUpHandler = function (e) {
        document.body.style.cursor = "";

        // Remove HandlingResizer class
        resizer.classList.remove("HandlingResizer");

        document.removeEventListener("mousemove", mouseMoveHandler);
        document.removeEventListener("mouseup", mouseUpHandler);
      };

      resizer.addEventListener("mousedown", mouseDownHandler);
      handlers.push(mouseDownHandler);
    }
    return handlers;
  };
  const unsetResizerEvents = (resizers, handlers) => {
    if (!handlers) {
      return;
    }
    resizers.forEach((resizer, index) => {
      resizer.removeEventListener("mousedown", handlers[index]);
    });
  };
</script>

<div bind:this={split_pane_root} class:SplitPaneRoot={true} style="--minWidth: {minWidth}">
  <slot />
</div>

<style>
  .SplitPaneRoot {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    min-width: var(--minWidth);
    position: relative;
  }
  .SplitPaneRoot > :global(.Resizer) {
    position: absolute;
    top: 0;
    bottom: 0;
    height: 100%;
    width: 5px;
    cursor: col-resize;
    user-select: none;
    z-index: 999;
  }
  .SplitPaneRoot > :global(.Resizer::before) {
    content: "";
    position: absolute;
    top: 0;
    left: 2px;
    width: 1px;
    height: 100%;
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 28%, transparent);
    opacity: 0.7;
  }
  .SplitPaneRoot > :global(.HandlingResizer),
  .SplitPaneRoot > :global(.Resizer:hover) {
    background-color: transparent;
  }
  .SplitPaneRoot > :global(.HandlingResizer::before),
  .SplitPaneRoot > :global(.Resizer:hover::before) {
    width: 2px;
    background-color: var(--theme-color-Accent-main);
    opacity: 0.9;
  }
</style>
