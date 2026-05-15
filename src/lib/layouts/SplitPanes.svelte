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

      // Snap-to-collapse threshold. Per UX feedback the snap should only
      // apply when the mouse is RELEASED below the threshold — during drag
      // the user must be free to move past it without the pane sticking.
      const closeThreshold = min_w * 0.6;
      const closeThresholdR = min_wr * 0.6;

      // Helper: apply a (potentially zero) size to a pane, overriding the
      // CSS min-width / min-height when the pane is being collapsed so the
      // visual content actually disappears.
      const minPropertyKey = isVertical ? "minHeight" : "minWidth";
      function applyPaneSize(p, sizeVal) {
        p.style[primaryDimension] = `${sizeVal}px`;
        if (sizeVal === 0) {
          // Inline `min-*: 0` wins over the stylesheet-level `min-width: 10rem`
          // declarations that pane consumers set. Without this, dragging to
          // the edge would snap the resizer but the pane body stayed visible.
          p.style[minPropertyKey] = "0px";
          p.classList.add("PaneCollapsed");
        } else {
          p.style[minPropertyKey] = "";
          p.classList.remove("PaneCollapsed");
        }
        // Toggle the wide-hit-area indicator on the resizer whenever either
        // neighbouring pane is collapsed, so the user sees a clear handle
        // for re-opening the hidden pane.
        const eitherCollapsed =
          pane.classList.contains("PaneCollapsed") || pane_r.classList.contains("PaneCollapsed");
        resizer.classList.toggle("HasCollapsedNeighbour", eitherCollapsed);
      }

      // Track the pointer's raw desired size for each pane during a drag.
      // Snap-to-collapse / clamp-to-min are deferred until mouseup so the
      // resizer can freely slide past the threshold while the user is
      // still pressing the mouse.
      let lastDesiredSize = size;
      let lastDesiredSizeR = sizeR;

      const mouseMoveHandler = function (e) {
        let delta = e[primaryClient] - startPointer;
        // Raw, unclamped target sizes — the user's intent.
        let rawSize = size + delta;
        let rawSizeR = sizeR - delta;
        // Hard limit at 0 on either side (can't move past the parent edge).
        if (rawSize < 0) {
          rawSizeR += rawSize;
          rawSize = 0;
        }
        if (rawSizeR < 0) {
          rawSize += rawSizeR;
          rawSizeR = 0;
        }
        lastDesiredSize = rawSize;
        lastDesiredSizeR = rawSizeR;

        // Apply the raw size visually — no snap during drag. This keeps the
        // user-visible resizer glued to the cursor through the entire drag.
        applyPaneSize(pane, rawSize);
        applyPaneSize(pane_r, rawSizeR);
        resizer.style[isVertical ? "top" : "left"] = `${resizerOffset + (rawSize - size)}px`;
      };

      // On mouseup: if the pointer ended below the snap threshold, collapse
      // that pane to 0; otherwise clamp it to its declared min size so the
      // configured minimum is still enforced as a resting state.
      const mouseUpHandler = function () {
        document.body.style.cursor = "";
        resizer.classList.remove("HandlingResizer");
        document.removeEventListener("mousemove", mouseMoveHandler);
        document.removeEventListener("mouseup", mouseUpHandler);

        let finalSize = lastDesiredSize;
        let finalSizeR = lastDesiredSizeR;

        if (finalSize < closeThreshold) {
          finalSize = 0;
          finalSizeR = size + sizeR;
        } else if (finalSize < min_w) {
          finalSize = min_w;
          finalSizeR = size + sizeR - min_w;
        }
        if (finalSizeR < closeThresholdR) {
          finalSizeR = 0;
          finalSize = size + sizeR;
        } else if (finalSizeR < min_wr) {
          finalSizeR = min_wr;
          finalSize = size + sizeR - min_wr;
        }

        applyPaneSize(pane, finalSize);
        applyPaneSize(pane_r, finalSizeR);
        resizer.style[isVertical ? "top" : "left"] = `${resizerOffset + (finalSize - size)}px`;
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
  /* Wider hit area when an adjacent pane has been collapsed: makes it
     obvious that there's a hidden pane there, and gives the user a much
     bigger grab target for re-opening it. */
  .SplitPaneRoot > :global(.Resizer.HasCollapsedNeighbour) {
    width: 14px;
  }
  .SplitPaneRoot.Vertical > :global(.Resizer.HasCollapsedNeighbour) {
    width: 100%;
    height: 14px;
  }
  .SplitPaneRoot > :global(.Resizer.HasCollapsedNeighbour::before) {
    width: 6px;
    background-color: var(--theme-color-Primary-main);
    opacity: 0.9;
  }
  .SplitPaneRoot.Vertical > :global(.Resizer.HasCollapsedNeighbour::before) {
    width: 100%;
    height: 6px;
  }
  /* Tiny chevron-like hint inside the wide resizer to point toward the
     hidden pane. We rotate via a CSS variable assigned from JS. */
  .SplitPaneRoot > :global(.Resizer.HasCollapsedNeighbour::after) {
    color: var(--theme-color-Main-light);
    background-image: none;
    opacity: 1;
  }
  .SplitPaneRoot > :global(.Resizer::before) {
    content: "";
    position: absolute;
    top: 0;
    left: 1px;
    width: 3px;
    height: 100%;
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 48%, transparent);
    border-radius: 1.5px;
    opacity: 0.85;
    transition:
      background-color 0.15s ease,
      width 0.15s ease,
      opacity 0.15s ease;
  }
  .SplitPaneRoot.Vertical > :global(.Resizer::before) {
    top: 1px;
    left: 0;
    width: 100%;
    height: 3px;
  }
  /* Grip dots — make the resizer easier to spot at a glance */
  .SplitPaneRoot > :global(.Resizer::after) {
    content: "";
    position: absolute;
    top: 50%;
    left: 1px;
    width: 3px;
    height: 1.5rem;
    transform: translateY(-50%);
    background-image: radial-gradient(circle, var(--theme-color-Main-main) 1px, transparent 1.2px);
    background-size: 3px 4px;
    background-repeat: repeat-y;
    opacity: 0.9;
    pointer-events: none;
  }
  .SplitPaneRoot.Vertical > :global(.Resizer::after) {
    top: 1px;
    left: 50%;
    width: 1.5rem;
    height: 3px;
    transform: translateX(-50%);
    background-image: radial-gradient(circle, var(--theme-color-Main-main) 1px, transparent 1.2px);
    background-size: 4px 3px;
    background-repeat: repeat-x;
  }
  .SplitPaneRoot > :global(.HandlingResizer),
  .SplitPaneRoot > :global(.Resizer:hover) {
    background-color: transparent;
  }
  .SplitPaneRoot > :global(.HandlingResizer::before),
  .SplitPaneRoot > :global(.Resizer:hover::before) {
    width: 5px;
    left: 0;
    background-color: var(--theme-color-Primary-main);
    opacity: 1;
  }
  .SplitPaneRoot.Vertical > :global(.HandlingResizer::before),
  .SplitPaneRoot.Vertical > :global(.Resizer:hover::before) {
    width: 100%;
    height: 5px;
    top: 0;
    left: 0;
  }
  /* A collapsed pane has 0 size — kill its overflow so nothing leaks. */
  .SplitPaneRoot > :global(.Pane.PaneCollapsed) {
    overflow: hidden;
  }
</style>
