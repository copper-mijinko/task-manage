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

  const MINI_PANE_SIZE = 64;
  const observeRootResize = (panes) => {
    resize_observer?.disconnect();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    resize_observer = new ResizeObserver((entries) => {
      // Primary-size setting. Mini panes must keep their fixed MINI_PANE_SIZE
      // — only non-mini panes share the remaining space proportionally,
      // otherwise the placeholder Card would visibly shrink/grow with the
      // container.
      const mini_total = panes.reduce(
        (sum, pane) => sum + (pane.classList.contains("PaneMini") ? MINI_PANE_SIZE : 0),
        0
      );
      const non_mini_size = panes.reduce(
        (sum, pane) =>
          sum +
          (pane.classList.contains("PaneMini")
            ? 0
            : pane.getBoundingClientRect()[primaryDimension]),
        0
      );
      const new_root_size = entries[0].contentRect[primaryDimension];
      const non_mini_target = Math.max(0, new_root_size - mini_total);
      if (non_mini_size === 0 && non_mini_target === 0) {
        return;
      }
      const new_pane_sizes = panes.map((pane) => {
        if (pane.classList.contains("PaneMini")) {
          return MINI_PANE_SIZE;
        }
        if (non_mini_size === 0) {
          return non_mini_target / Math.max(1, panes.length - mini_total / MINI_PANE_SIZE);
        }
        return (pane.getBoundingClientRect()[primaryDimension] * non_mini_target) / non_mini_size;
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

        // Cancel any in-flight snap transition so the resizer tracks the cursor
        // immediately without a lag from the previous mouseup animation.
        pane.classList.remove("PaneSnapping");
        pane_r.classList.remove("PaneSnapping");

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

      // Snap-to-mini: fixed pixel thresholds give a consistent feel across
      // panes with different min sizes. Mini snap is only enabled when the
      // pane's min size exceeds the threshold — otherwise the pane can
      // naturally sit below the snap target and the deadzone disappears.
      // Snap only applies on mouseup; during drag the user is free to
      // move past the threshold without the pane sticking.
      const SNAP_THRESHOLD = 80;
      const enableMini = min_w > SNAP_THRESHOLD;
      const enableMiniR = min_wr > SNAP_THRESHOLD;

      // Helper: apply a size to a pane.
      // When mini=true the pane snaps to MINI_PANE_SIZE: its real content is
      // hidden via inline style and a blank Card placeholder is injected.
      // When mini=false (default, used during drag) real content is visible.
      const minPropertyKey = isVertical ? "minHeight" : "minWidth";
      function applyPaneSize(p, sizeVal, mini = false) {
        // Safety: in mini mode the size is always MINI_PANE_SIZE — this
        // protects against any caller (or stale ResizeObserver re-entry)
        // accidentally passing the raw drag value instead.
        if (mini) {
          sizeVal = MINI_PANE_SIZE;
        }
        p.style[primaryDimension] = `${sizeVal}px`;
        // Use :scope > to find ONLY the direct-child placeholder. Without
        // this, nested SplitPanes would interfere: querying the outer pane
        // would find the inner pane's placeholder and incorrectly skip
        // creating its own (or wrongly delete the inner one on un-mini).
        const directPlaceholder = p.querySelector(":scope > .PaneMiniPlaceholder");
        if (mini) {
          // Override CSS min-* so the pane can shrink below its declared minimum.
          // Keep the pane's natural padding so the placeholder Card sits
          // inside with the same breathing room a real Card would have.
          p.style[minPropertyKey] = "0px";
          p.classList.add("PaneMini");
          if (!directPlaceholder) {
            const placeholder = document.createElement("div");
            placeholder.classList.add("PaneMiniPlaceholder");
            p.appendChild(placeholder);
          }
          // Hide real children via inline style (CSS :global selectors can't
          // reach grandchildren of SplitPaneRoot reliably).
          for (const child of p.children) {
            if (!child.classList.contains("PaneMiniPlaceholder")) {
              child.style.display = "none";
            }
          }
        } else {
          p.style[minPropertyKey] = "";
          p.classList.remove("PaneMini");
          if (directPlaceholder) directPlaceholder.remove();
          // Restore real children.
          for (const child of p.children) {
            child.style.display = "";
          }
        }
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

      // On mouseup: if the pointer ended below the snap threshold, snap to
      // MINI_PANE_SIZE and show the placeholder Card; otherwise clamp to the
      // declared min size so the configured minimum is still enforced.
      const mouseUpHandler = function () {
        document.body.style.cursor = "";
        resizer.classList.remove("HandlingResizer");
        document.removeEventListener("mousemove", mouseMoveHandler);
        document.removeEventListener("mouseup", mouseUpHandler);

        let finalSize = lastDesiredSize;
        let finalSizeR = lastDesiredSizeR;
        let leftMini = false;
        let rightMini = false;

        if (enableMini && finalSize < SNAP_THRESHOLD) {
          finalSize = MINI_PANE_SIZE;
          finalSizeR = size + sizeR - MINI_PANE_SIZE;
          leftMini = true;
        } else if (finalSize < min_w) {
          finalSize = min_w;
          finalSizeR = size + sizeR - min_w;
        }
        if (enableMiniR && finalSizeR < SNAP_THRESHOLD) {
          finalSizeR = MINI_PANE_SIZE;
          finalSize = size + sizeR - MINI_PANE_SIZE;
          rightMini = true;
        } else if (finalSizeR < min_wr) {
          finalSizeR = min_wr;
          finalSize = size + sizeR - min_wr;
        }

        // Enable snap transition for this release only, then remove it so
        // subsequent drag moves are not slowed down.
        pane.classList.add("PaneSnapping");
        pane_r.classList.add("PaneSnapping");

        applyPaneSize(pane, finalSize, leftMini);
        applyPaneSize(pane_r, finalSizeR, rightMini);
        resizer.style[isVertical ? "top" : "left"] = `${resizerOffset + (finalSize - size)}px`;

        setTimeout(() => {
          pane.classList.remove("PaneSnapping");
          pane_r.classList.remove("PaneSnapping");
        }, 180);
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
  /* Mini pane: overflow hidden so nothing bleeds out, and force padding so
     the placeholder Card has breathing room regardless of whether the pane's
     original child was a Card (which would have applied padding via :has). */
  .SplitPaneRoot > :global(.Pane.PaneMini) {
    overflow: hidden;
    padding: var(--sp4);
  }

  /* Blank Card placeholder injected when a pane enters mini state.
     Styled as a Card header bar — the entire strip gets the CardHeader
     blue-tinted background so it reads as "a collapsed card".
     PaneMiniPlaceholder is a grandchild of SplitPaneRoot, so we use a
     descendant combinator (space) instead of > to reach it. */
  .SplitPaneRoot :global(.PaneMiniPlaceholder) {
    width: 100%;
    height: 100%;
    background-color: color-mix(
      in srgb,
      var(--theme-color-Primary-main) 12%,
      var(--theme-color-Main-main)
    );
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    border-radius: var(--shape-sm);
    box-shadow: var(--elevation-2);
    box-sizing: border-box;
  }

  /* Snap transition — active only for the 180 ms after mouseup so the pane
     glides to its resting position. Removed before the next drag starts. */
  .SplitPaneRoot > :global(.Pane.PaneSnapping) {
    transition: width 0.18s ease;
  }
  .SplitPaneRoot.Vertical > :global(.Pane.PaneSnapping) {
    transition: height 0.18s ease;
  }
</style>
