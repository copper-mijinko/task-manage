<script>
  import { onDestroy, onMount } from "svelte";

  export let defaultRatio = [];
  export let direction = "horizontal";

  let split_pane_root; // Bind

  // Resize
  let resizers = [];
  let handlers = [];
  let resize_observer;
  let mutation_observer;
  let paneCount = 0;

  // Min width
  let minWidth = "auto";
  let minHeight = "auto";

  $: isVertical = direction === "vertical";
  $: primaryDimension = isVertical ? "height" : "width";
  $: primaryClient = isVertical ? "clientY" : "clientX";
  $: primaryCursor = isVertical ? "row-resize" : "col-resize";

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
    minWidth = isVertical ? "0" : `${4 * panes.length}rem`; // magic number 4rem.
    minHeight = isVertical ? `${4 * panes.length}rem` : "0";

    if (!panes.length) {
      resize_observer?.disconnect();
      resize_observer = undefined;
      return;
    }

    const rootSize = split_pane_root.getBoundingClientRect()[primaryDimension];
    const sizes = getPaneSizes(panes, rootSize, canPreserveWidths);

    panes.forEach((pane, index) => {
      pane.style[primaryDimension] = `${sizes[index]}px`;
    });

    resizers = createResizers(panes, sizes);
    handlers = setResizersEvents(resizers, panes);
    observeRootResize(panes);
  };

  const getPaneSizes = (panes, rootSize, preserveWidths) => {
    if (preserveWidths) {
      const currentSizes = panes.map((pane) => pane.getBoundingClientRect()[primaryDimension]);
      const currentTotal = currentSizes.reduce((partialSum, size) => partialSum + size, 0);
      if (currentTotal > 0) {
        return currentSizes.map((size) => (size * rootSize) / currentTotal);
      }
    }

    let ratios = defaultRatio;
    if (panes.length > ratios.length) {
      ratios = ratios.concat(new Array(panes.length - ratios.length).fill(1));
    } else if (panes.length < ratios.length) {
      ratios = ratios.slice(0, panes.length);
    }
    const ratioSum = ratios.reduce((partialSum, ratio) => partialSum + ratio, 0) || panes.length;
    return ratios.map((ratio) => (rootSize * ratio) / ratioSum);
  };

  const createResizers = (panes, paneSizes) => {
    const nextResizers = [];
    let offset = 0;

    panes.forEach((pane, index) => {
      if (index == 0) {
        return;
      }
      const resizer = document.createElement("div");
      resizer.classList.add("Resizer");
      resizer.style[isVertical ? "top" : "left"] = `${offset + paneSizes[index - 1] - 3}px`;
      offset += paneSizes[index - 1];
      pane.parentNode.insertBefore(resizer, pane);
      nextResizers.push(resizer);
    });

    return nextResizers;
  };

  const observeRootResize = (panes) => {
    resize_observer?.disconnect();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    resize_observer = new ResizeObserver((entries) => {
      // Primary-size setting
      let root_size = 0;
      panes.forEach((pane) => {
        root_size += pane.getBoundingClientRect()[primaryDimension];
      });
      if (root_size === 0) {
        return;
      }
      let new_root_size = entries[0].contentRect[primaryDimension];
      let new_pane_sizes = [];
      panes.forEach((pane) => {
        new_pane_sizes.push(
          (pane.getBoundingClientRect()[primaryDimension] * new_root_size) / root_size
        );
      });
      panes.forEach((pane, index) => {
        pane.style[primaryDimension] = `${new_pane_sizes[index]}px`;
      });
      let offset = 0;
      resizers.forEach((resizer, index) => {
        resizer.style[isVertical ? "top" : "left"] = `${offset + new_pane_sizes[index] - 3}px`;
        offset += new_pane_sizes[index];
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

      const minProperty = isVertical ? "minHeight" : "minWidth";
      const style_min_w = window.getComputedStyle(pane)[minProperty];
      const min_w = style_min_w.includes("%")
        ? (parseFloat(style_min_w, 10) / 100) *
          split_pane_root.getBoundingClientRect()[primaryDimension]
        : parseFloat(style_min_w, 10) || 10;
      const style_min_wr = window.getComputedStyle(pane_r)[minProperty];
      const min_wr = style_min_wr.includes("%")
        ? (parseFloat(style_min_wr, 10) / 100) *
          split_pane_root.getBoundingClientRect()[primaryDimension]
        : parseFloat(style_min_wr, 10) || 10;

      // Track the current position of mouse
      let startPointer = 0;
      let size = 0;
      let sizeR = 0;
      let resizerOffset = 0;

      const mouseDownHandler = function (e) {
        let cssText = document.body.style.cssText;
        document.body.style.cssText = cssText + `cursor: ${primaryCursor} !important;`;

        // Add HandlingResizer class
        resizer.classList.add("HandlingResizer");

        // Get the current mouse position
        startPointer = e[primaryClient];

        // Calculate the current size of pane
        size = pane.getBoundingClientRect()[primaryDimension];
        sizeR = pane_r.getBoundingClientRect()[primaryDimension];

        // Calculate the current offset of resizer
        const resizerRect = resizer.getBoundingClientRect();
        const parentRect = resizer.parentNode.getBoundingClientRect();
        resizerOffset = isVertical
          ? resizerRect.top - parentRect.top
          : resizerRect.left - parentRect.left;

        // Attach listeners for document's events
        document.addEventListener("mousemove", mouseMoveHandler);
        document.addEventListener("mouseup", mouseUpHandler);
      };

      const mouseMoveHandler = function (e) {
        // Determine how far the mouse has been moved
        let delta = e[primaryClient] - startPointer;
        let newSize = size + delta;
        let newSizeR = sizeR - delta;

        if (newSize < min_w) {
          newSizeR = size + sizeR - min_w;
          newSize = min_w;
          delta = newSize - size;
        }
        if (newSizeR < min_wr) {
          newSize = size + sizeR - min_wr;
          newSizeR = min_wr;
          delta = newSize - size;
        }

        // Update the size of pane
        pane.style[primaryDimension] = `${newSize}px`;
        pane_r.style[primaryDimension] = `${newSizeR}px`;

        // Update resizer pos
        resizer.style[isVertical ? "top" : "left"] = `${resizerOffset + delta}px`;
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

<div
  bind:this={split_pane_root}
  class:SplitPaneRoot={true}
  class:Vertical={isVertical}
  style="--minWidth: {minWidth}; --minHeight: {minHeight}"
>
  <slot />
</div>

<style>
  .SplitPaneRoot {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    min-width: var(--minWidth);
    min-height: var(--minHeight);
    position: relative;
  }
  .SplitPaneRoot.Vertical {
    flex-direction: column;
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
  .SplitPaneRoot.Vertical > :global(.Resizer) {
    top: auto;
    left: 0;
    right: 0;
    width: 100%;
    height: 5px;
    cursor: row-resize;
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
  .SplitPaneRoot.Vertical > :global(.Resizer::before) {
    top: 2px;
    left: 0;
    width: 100%;
    height: 1px;
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
  .SplitPaneRoot.Vertical > :global(.HandlingResizer::before),
  .SplitPaneRoot.Vertical > :global(.Resizer:hover::before) {
    width: 100%;
    height: 2px;
  }
</style>
