<script>
  import { onDestroy, onMount } from "svelte";
  import * as platform from "@lib/ipc/platform";

  export let defaultRatio = [];
  export let direction = "horizontal";
  // Collapse policy is opt-in so existing tree/gantt and inbox splits retain
  // their current two-sided mini-pane behaviour. The project tree/detail split
  // uses `end` with a zero-sized pane: the tree always wins when space runs out,
  // while the boundary remains available to drag the detail pane open again.
  export let collapsePriority = "both";
  export let collapseSize = 64;
  export let collapsedPane = null;
  export let separatorLabel = "ペインのサイズを変更";
  export let persistenceKey = "";

  let split_pane_root; // Bind

  // Resize
  let resizers = [];
  let handlers = [];
  let resize_observer;
  let mutation_observer;
  let paneCount = 0;
  let mounted = false;
  let syncedCollapsedPane;
  let lastOpenSizes = [];
  let restoredRatio = [];

  // Min width
  let minWidth = "auto";
  let minHeight = "auto";

  $: isVertical = direction === "vertical";
  $: primaryDimension = isVertical ? "height" : "width";
  $: primaryClient = isVertical ? "clientY" : "clientX";
  $: primaryCursor = isVertical ? "row-resize" : "col-resize";
  $: if (mounted && collapsedPane !== syncedCollapsedPane) {
    syncCollapsedPane(collapsedPane);
  }

  onMount(() => {
    refreshLayout();
    mounted = true;
    syncCollapsedPane(collapsedPane, false);
    void restorePersistedLayout();

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

  const isValidPersistedLayout = (value) =>
    value &&
    typeof value === "object" &&
    Array.isArray(value.ratio) &&
    value.ratio.length === 2 &&
    value.ratio.every((item) => Number.isFinite(item) && item >= 0) &&
    (value.collapsedPane === null ||
      value.collapsedPane === "start" ||
      value.collapsedPane === "end");

  const restorePersistedLayout = async () => {
    if (!persistenceKey) return;
    try {
      const value = await platform.getMetaData(persistenceKey);
      if (!mounted || !isValidPersistedLayout(value)) return;
      restoredRatio = value.ratio;
      refreshLayout();
      const canRestoreCollapsedPane =
        value.collapsedPane === "start"
          ? collapsePriority !== "end"
          : value.collapsedPane === "end"
            ? collapsePriority !== "start"
            : true;
      const nextCollapsedPane = canRestoreCollapsedPane ? value.collapsedPane : null;
      setBoundCollapsedPane(nextCollapsedPane);
      syncCollapsedPane(nextCollapsedPane, false);
    } catch {
      // レイアウト設定が読めなくても、既定比率でそのまま利用できる。
    }
  };

  const persistLayout = (panes, measuredSizes = null) => {
    if (!persistenceKey || panes.length !== 2) return;
    const effectiveCollapsedPane =
      panes[0].classList.contains("PaneMini") || panes[0].classList.contains("PaneCollapsed")
        ? "start"
        : panes[1].classList.contains("PaneMini") || panes[1].classList.contains("PaneCollapsed")
          ? "end"
          : null;
    const sourceSizes =
      effectiveCollapsedPane && lastOpenSizes.length === 2
        ? lastOpenSizes
        : (measuredSizes ?? panes.map((pane) => pane.getBoundingClientRect()[primaryDimension]));
    const total = sourceSizes.reduce((sum, size) => sum + size, 0);
    if (total <= 0) return;
    const ratio = sourceSizes.map((size) => size / total);
    restoredRatio = ratio;
    platform.setMetaData(persistenceKey, { ratio, collapsedPane: effectiveCollapsedPane });
  };

  onDestroy(() => {
    mounted = false;
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
    if (collapsedPane) {
      syncCollapsedPane(collapsedPane);
    }
  };

  const positionResizers = (paneSizes) => {
    const rootSize = split_pane_root.getBoundingClientRect()[primaryDimension];
    let offset = 0;
    resizers.forEach((resizer, index) => {
      offset += paneSizes[index];
      // Keep the full 5px hit target inside the root even when the end pane
      // is collapsed to zero at the far edge.
      const position = Math.max(0, Math.min(rootSize - 5, offset - 3));
      resizer.style[isVertical ? "top" : "left"] = `${position}px`;
      const valueNow = rootSize > 0 ? Math.round((offset / rootSize) * 100) : 0;
      resizer.setAttribute("aria-valuemin", "0");
      resizer.setAttribute("aria-valuemax", "100");
      resizer.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, valueNow))));
      if (collapsedPane === "end") {
        resizer.setAttribute(
          "aria-valuetext",
          isVertical
            ? "後方のペインをたたんでいます。上へドラッグすると表示できます"
            : "詳細欄をたたんでいます。左へドラッグすると表示できます"
        );
        resizer.title = isVertical
          ? "上へドラッグして後方のペインを表示"
          : "左へドラッグして詳細欄を表示";
      } else {
        resizer.setAttribute("aria-valuetext", separatorLabel);
        resizer.title = separatorLabel;
      }
    });
  };

  const setBoundCollapsedPane = (next) => {
    syncedCollapsedPane = next;
    collapsedPane = next;
  };

  const applyPaneSize = (pane, sizeValue, collapsed = false) => {
    const minPropertyKey = isVertical ? "minHeight" : "minWidth";
    const minDatasetKey = isVertical ? "splitPaneMinHeight" : "splitPaneMinWidth";
    const finalSize = collapsed ? collapseSize : sizeValue;
    pane.style[primaryDimension] = `${finalSize}px`;

    const directPlaceholder = pane.querySelector(":scope > .PaneMiniPlaceholder");
    if (collapsed) {
      if (!(minDatasetKey in pane.dataset)) {
        pane.dataset[minDatasetKey] = pane.style[minPropertyKey] || "";
      }
      pane.style[minPropertyKey] = "0px";
      pane.classList.toggle("PaneMini", collapseSize > 0);
      pane.classList.toggle("PaneCollapsed", collapseSize === 0);
      if (collapseSize > 0 && !directPlaceholder) {
        const placeholder = document.createElement("div");
        placeholder.classList.add("PaneMiniPlaceholder");
        pane.appendChild(placeholder);
      }
      for (const child of pane.children) {
        if (!child.classList.contains("PaneMiniPlaceholder")) child.style.display = "none";
      }
      return;
    }

    if (minDatasetKey in pane.dataset) {
      pane.style[minPropertyKey] = pane.dataset[minDatasetKey];
      delete pane.dataset[minDatasetKey];
    }
    pane.classList.remove("PaneMini", "PaneCollapsed");
    directPlaceholder?.remove();
    for (const child of pane.children) child.style.display = "";
  };

  const resolveMinimumSize = (cssValue, pane) => {
    const numericValue = parseFloat(cssValue);
    if (!Number.isFinite(numericValue)) return 10;
    if (cssValue.endsWith("%")) {
      return (numericValue / 100) * split_pane_root.getBoundingClientRect()[primaryDimension];
    }
    if (cssValue.endsWith("rem")) {
      const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
      return numericValue * (rootFontSize || 16);
    }
    if (cssValue.endsWith("em")) {
      const paneFontSize = parseFloat(window.getComputedStyle(pane).fontSize);
      return numericValue * (paneFontSize || 16);
    }
    return numericValue || 10;
  };

  const syncCollapsedPane = (next, persist = true) => {
    if (!split_pane_root) return;
    const panes = [...split_pane_root.querySelectorAll(":scope > .Pane")];
    if (panes.length !== 2) {
      syncedCollapsedPane = next;
      return;
    }

    const rootSize = split_pane_root.getBoundingClientRect()[primaryDimension];
    const currentSizes = panes.map((pane) => pane.getBoundingClientRect()[primaryDimension]);
    const isCurrentlyCollapsed = panes.some(
      (pane) => pane.classList.contains("PaneMini") || pane.classList.contains("PaneCollapsed")
    );
    if (next && !isCurrentlyCollapsed && currentSizes.every((size) => size > 0)) {
      lastOpenSizes = currentSizes;
    }

    let sizes;
    if (next === "start" && collapsePriority !== "end") {
      sizes = [collapseSize, Math.max(0, rootSize - collapseSize)];
    } else if (next === "end" && collapsePriority !== "start") {
      sizes = [Math.max(0, rootSize - collapseSize), collapseSize];
    } else {
      const sourceSizes =
        lastOpenSizes.length === 2 ? lastOpenSizes : getPaneSizes(panes, rootSize, false);
      const sourceTotal = sourceSizes.reduce((sum, size) => sum + size, 0) || rootSize;
      sizes = sourceSizes.map((size) => (size * rootSize) / sourceTotal);
      next = null;
    }

    applyPaneSize(panes[0], sizes[0], next === "start");
    applyPaneSize(panes[1], sizes[1], next === "end");
    positionResizers(sizes);
    syncedCollapsedPane = next;
    if (persist) persistLayout(panes, sizes);
  };

  const getPaneSizes = (panes, rootSize, preserveWidths) => {
    if (preserveWidths) {
      const currentSizes = panes.map((pane) => pane.getBoundingClientRect()[primaryDimension]);
      const currentTotal = currentSizes.reduce((partialSum, size) => partialSum + size, 0);
      if (currentTotal > 0) {
        return currentSizes.map((size) => (size * rootSize) / currentTotal);
      }
    }

    let ratios = restoredRatio.length === panes.length ? restoredRatio : defaultRatio;
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
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", isVertical ? "horizontal" : "vertical");
      resizer.setAttribute("aria-label", separatorLabel);
      resizer.tabIndex = 0;
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
    let previousRootSize = split_pane_root.getBoundingClientRect()[primaryDimension];
    const observer = new ResizeObserver((entries) => {
      // Primary-size setting. Collapsed panes must keep their configured size
      // — only non-mini panes share the remaining space proportionally,
      // otherwise the placeholder Card would visibly shrink/grow with the
      // container.
      const mini_total = panes.reduce(
        (sum, pane) =>
          sum +
          (pane.classList.contains("PaneMini") || pane.classList.contains("PaneCollapsed")
            ? collapseSize
            : 0),
        0
      );
      const non_mini_size = panes.reduce(
        (sum, pane) =>
          sum +
          (pane.classList.contains("PaneMini") || pane.classList.contains("PaneCollapsed")
            ? 0
            : pane.getBoundingClientRect()[primaryDimension]),
        0
      );
      const new_root_size = entries[0].contentRect[primaryDimension];
      // ResizeObserver always delivers an initial notification. When a
      // persisted ratio has just been applied, reading pane rectangles from
      // that first callback can still return the pre-layout sizes and undo the
      // restored ratio. Only redistribute panes after the root itself changed.
      if (Math.abs(new_root_size - previousRootSize) < 0.5) {
        requestAnimationFrame(() => {
          if (mounted && resize_observer === observer) {
            positionResizers(panes.map((pane) => pane.getBoundingClientRect()[primaryDimension]));
          }
        });
        return;
      }
      previousRootSize = new_root_size;
      const non_mini_target = Math.max(0, new_root_size - mini_total);
      if (non_mini_size === 0 && non_mini_target === 0) {
        return;
      }
      const new_pane_sizes = panes.map((pane) => {
        if (pane.classList.contains("PaneMini") || pane.classList.contains("PaneCollapsed")) {
          return collapseSize;
        }
        if (non_mini_size === 0) {
          const collapsedCount = panes.filter(
            (pane) =>
              pane.classList.contains("PaneMini") || pane.classList.contains("PaneCollapsed")
          ).length;
          return non_mini_target / Math.max(1, panes.length - collapsedCount);
        }
        return (pane.getBoundingClientRect()[primaryDimension] * non_mini_target) / non_mini_size;
      });
      panes.forEach((pane, index) => {
        pane.style[primaryDimension] = `${new_pane_sizes[index]}px`;
      });
      positionResizers(new_pane_sizes);
    });
    resize_observer = observer;
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
      const min_w = resolveMinimumSize(style_min_w, pane);
      const style_min_wr = window.getComputedStyle(pane_r)[minProperty];
      const min_wr = resolveMinimumSize(style_min_wr, pane_r);

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
        lastDesiredSize = size;
        lastDesiredSizeR = sizeR;

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
      const enableMini = min_w > SNAP_THRESHOLD && collapsePriority !== "end";
      const enableMiniR = min_wr > SNAP_THRESHOLD && collapsePriority !== "start";

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
          finalSize = collapseSize;
          finalSizeR = size + sizeR - collapseSize;
          leftMini = true;
        } else if (finalSize < min_w) {
          finalSize = min_w;
          finalSizeR = size + sizeR - min_w;
        }
        if (enableMiniR && finalSizeR < SNAP_THRESHOLD) {
          finalSizeR = collapseSize;
          finalSize = size + sizeR - collapseSize;
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

        if (panes.length === 2) {
          if (!leftMini && !rightMini) lastOpenSizes = [finalSize, finalSizeR];
          setBoundCollapsedPane(leftMini ? "start" : rightMini ? "end" : null);
        }
        positionResizers(
          panes.map((currentPane) => currentPane.getBoundingClientRect()[primaryDimension])
        );
        persistLayout(panes, [finalSize, finalSizeR]);

        setTimeout(() => {
          pane.classList.remove("PaneSnapping");
          pane_r.classList.remove("PaneSnapping");
        }, 180);
      };

      resizer.addEventListener("mousedown", mouseDownHandler);
      const doubleClickHandler = () => {
        const preferred = collapsePriority === "start" ? "start" : "end";
        if (collapsedPane) {
          setBoundCollapsedPane(null);
          syncCollapsedPane(null);
        } else if (collapsePriority !== "both") {
          setBoundCollapsedPane(preferred);
          syncCollapsedPane(preferred);
        }
      };
      const applyKeyboardResize = (delta) => {
        const rootSize = split_pane_root.getBoundingClientRect()[primaryDimension];
        if (rootSize <= 0) return;
        if (collapsedPane) {
          setBoundCollapsedPane(null);
          syncCollapsedPane(null, false);
        }

        const currentSize = pane.getBoundingClientRect()[primaryDimension];
        const currentSizeR = pane_r.getBoundingClientRect()[primaryDimension];
        const minStart = collapsePriority === "end" ? min_w : 0;
        const minEnd = collapsePriority === "start" ? min_wr : 0;
        const nextStart = Math.min(
          rootSize - minEnd,
          Math.max(minStart, currentSize + rootSize * delta)
        );
        const nextEnd = Math.max(0, currentSize + currentSizeR - nextStart);
        applyPaneSize(pane, nextStart);
        applyPaneSize(pane_r, nextEnd);
        lastOpenSizes = [nextStart, nextEnd];
        setBoundCollapsedPane(null);
        positionResizers([nextStart, nextEnd]);
        persistLayout(panes, [nextStart, nextEnd]);
      };
      const keyDownHandler = (event) => {
        const decreaseKeys = isVertical ? ["ArrowUp"] : ["ArrowLeft"];
        const increaseKeys = isVertical ? ["ArrowDown"] : ["ArrowRight"];
        if (decreaseKeys.includes(event.key)) {
          event.preventDefault();
          applyKeyboardResize(-0.05);
        } else if (increaseKeys.includes(event.key)) {
          event.preventDefault();
          applyKeyboardResize(0.05);
        } else if (event.key === "Home") {
          event.preventDefault();
          if (collapsePriority !== "end") {
            setBoundCollapsedPane("start");
            syncCollapsedPane("start");
          } else {
            applyKeyboardResize(-1);
          }
        } else if (event.key === "End") {
          event.preventDefault();
          if (collapsePriority !== "start") {
            setBoundCollapsedPane("end");
            syncCollapsedPane("end");
          } else {
            applyKeyboardResize(1);
          }
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          doubleClickHandler();
        }
      };
      resizer.addEventListener("dblclick", doubleClickHandler);
      resizer.addEventListener("keydown", keyDownHandler);
      handlers.push({ resizer, mouseDownHandler, doubleClickHandler, keyDownHandler });
    }
    return handlers;
  };
  const unsetResizerEvents = (resizers, handlers) => {
    if (!handlers) {
      return;
    }
    handlers.forEach((handler) => {
      if (handler) {
        handler.resizer.removeEventListener("mousedown", handler.mouseDownHandler);
        handler.resizer.removeEventListener("dblclick", handler.doubleClickHandler);
        handler.resizer.removeEventListener("keydown", handler.keyDownHandler);
      }
    });
  };
</script>

<div
  bind:this={split_pane_root}
  class:SplitPaneRoot={true}
  class:Vertical={isVertical}
  data-persistence-key={persistenceKey || undefined}
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
     original child was a Card (which would have applied padding via :has).
     Uses the same --pane-pad token as the normal Card-hosting pane, so flat
     mode collapses both consistently. */
  .SplitPaneRoot > :global(.Pane.PaneMini) {
    overflow: hidden;
    padding: var(--pane-pad);
  }

  .SplitPaneRoot > :global(.Pane.PaneCollapsed) {
    overflow: hidden;
    padding: 0;
  }

  .SplitPaneRoot > :global(.Pane.PaneMini > :not(.PaneMiniPlaceholder)) {
    display: none !important;
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
    border-radius: var(--card-radius);
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
