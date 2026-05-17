<script>
  import { onMount } from "svelte";
  import TreeTableHeader from "@features/tasks/components/TreeTableHeader.svelte";
  import TreeTableRow from "@features/tasks/components/TreeTableRow.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import {
    tree_data,
    filtered_data,
    closed_node_ids,
    table_selected_id,
    theme,
    column_settings,
    ganttScrollTop,
  } from "@stores";
  import {
    flattenVisibleTree,
    buildInheritedDueDateMap,
    buildNodePathMap,
    updateNodeDataById,
    isChild,
    reorderTree,
    addNode,
    rmNode,
    getNode,
    getParent,
    getDefaultNode,
    moveNodeUp,
    moveNodeDown,
    indentNode,
    outdentNode,
    cloneWithNewIds,
  } from "@features/tasks/utils/tree_control";
  import { copied_task } from "@stores/ui";

  let table_root; // Bind

  // Resize
  let resizers = [],
    handlers,
    resize_observer;

  const BUILT_IN_HEADERS = [
    { name: "name", default_ratio: 10 },
    { name: "status", default_ratio: 3 },
    { name: "start date", default_ratio: 3 },
    { name: "due date", default_ratio: 3 },
    { name: "memo", default_ratio: 1.5 },
  ];

  $: rows = $filtered_data ? flattenVisibleTree($filtered_data, $closed_node_ids) : [];
  $: inheritedDueDateMap = buildInheritedDueDateMap(rows);
  $: nodePathMap = buildNodePathMap(rows);
  $: isDark = $theme == "dark";
  $: hasNoTasks = !$tree_data?.data?.children?.length;
  let scrollTop = 0;

  // Compute visible headers from tree_data.headers filtered/ordered by column_settings
  function mergeBuiltInHeaders(treeHeaders = []) {
    const byName = new Map(BUILT_IN_HEADERS.map((header) => [header.name, header]));
    for (const header of treeHeaders ?? []) {
      byName.set(header.name, header);
    }
    return Array.from(byName.values());
  }

  function computeVisibleHeaders(treeHeaders, settings) {
    const availableHeaders = mergeBuiltInHeaders(treeHeaders);
    if (!settings) return availableHeaders;

    const result = [];
    for (const setting of settings) {
      if (setting.id === "name" || setting.visible) {
        const header = availableHeaders.find((h) => h.name === setting.id);
        if (header) result.push(header);
      }
    }

    // Include any headers not covered by settings
    const settingIds = new Set(settings.map((s) => s.id));
    for (const header of availableHeaders) {
      if (!settingIds.has(header.name)) result.push(header);
    }

    return result;
  }

  $: visibleHeaders = computeVisibleHeaders($tree_data?.headers, $column_settings);
  $: allHeaders = mergeBuiltInHeaders($tree_data?.headers);
  $: minWidth = visibleHeaders.length ? `${4 * visibleHeaders.length}rem` : "auto";

  const getRowHeightPx = () => {
    if (typeof window === "undefined") {
      return 0;
    }

    return parseFloat(window.getComputedStyle(document.documentElement).fontSize) * 2.5;
  };

  const buildStickyTrail = (visibleRows, currentScrollTop) => {
    if (!visibleRows?.length) {
      return [];
    }

    const rowHeightPx = getRowHeightPx();
    if (!rowHeightPx) {
      return [];
    }

    // スティッキー表示自体が 1 行分 (2.5rem) を覆い隠す。スクロール量から
    // 計算される「画面最上段の行」はちょうどスティッキーに覆われている行で、
    // ユーザが実際に見える最初の本文行 (content-visible) はその 1 つ下。
    // スティッキー上のパスを「画面で見える行の親パス」と一致させるには、
    // 覆われている行 (= floor(scrollTop / rowHeight)) の祖先 (自身含む) を
    // パンくずに使えばよい。
    const coveredIndex = Math.min(
      visibleRows.length - 1,
      Math.max(0, Math.floor(currentScrollTop / rowHeightPx))
    );
    const coveredRow = visibleRows[coveredIndex];
    if (!coveredRow || coveredRow.depth === 0) {
      return [];
    }

    const rowById = new Map(visibleRows.map((row) => [row.id, row]));
    const trail = [];
    let currentRow = coveredRow;

    while (currentRow) {
      trail.unshift(currentRow);
      currentRow = currentRow.parentId ? rowById.get(currentRow.parentId) : undefined;
    }

    return trail;
  };

  $: stickyTrail = buildStickyTrail(rows, scrollTop);

  let showDeleteConfirm = false;
  let deleteTargetId;
  let deleteTargetName = "";

  onMount(() => {
    let domHeaders, data_rows;
    [resizers, domHeaders, data_rows, resize_observer] = createResizers(visibleHeaders);
    handlers = setResizersEvents(resizers, domHeaders, data_rows);

    let mutation_observer = new MutationObserver(() => {
      const currentDomHeaderCount = Array.from(
        table_root.querySelectorAll(".TableRow")[0]?.querySelectorAll(".TableHeader") ?? []
      ).length;
      const columnCountChanged = currentDomHeaderCount !== resizers.length + 1;

      let newDomHeaders, newDataRows;

      if (columnCountChanged && currentDomHeaderCount > 0) {
        // Column was added or removed — full reinit
        unsetResizerEvents(resizers, handlers);
        resizers.forEach((r) => r.parentNode?.removeChild(r));
        resizers = [];
        [resizers, newDomHeaders, newDataRows, resize_observer] = createResizers(
          visibleHeaders,
          [],
          true,
          resize_observer
        );
      } else {
        [resizers, newDomHeaders, newDataRows] = createResizers(
          visibleHeaders,
          resizers,
          false,
          resize_observer
        );
        unsetResizerEvents(resizers, handlers);
      }

      handlers = setResizersEvents(resizers, newDomHeaders, newDataRows);
    });
    mutation_observer.observe(table_root, { subtree: true, childList: true });
  });

  const syncResizerBounds = (targetResizers = resizers) => {
    if (!table_root) {
      return;
    }

    const tableRows = Array.from(table_root.querySelectorAll(".TableRow"));
    const contentHeight = tableRows.reduce(
      (height, row) => height + row.getBoundingClientRect().height,
      0
    );
    const top = table_root.scrollTop;
    const height = Math.max(0, Math.min(table_root.clientHeight, contentHeight - top));

    targetResizers.forEach((resizer) => {
      resizer.style.top = `${top}px`;
      resizer.style.height = `${height}px`;
    });
  };

  const createResizers = (
    currentHeaders,
    existingResizers = [],
    is_default = true,
    existingResizeObserver = null
  ) => {
    // Get elms
    let tableRows = table_root.querySelectorAll(".TableRow");
    let domHeaders = Array.from(tableRows[0].querySelectorAll(".TableHeader"));
    let data_rows = [];
    tableRows.forEach((data_row, index) => {
      if (index != 0) {
        data_rows.push(data_row.querySelectorAll(".TableData"));
      }
    });

    // Set width
    if (is_default) {
      const default_ratio_sum = currentHeaders.reduce(
        (partialSum, header) => partialSum + header.default_ratio,
        0
      );
      const default_root_width = tableRows[0].getBoundingClientRect().width;
      const default_data_widths = currentHeaders.map(
        (header) => (default_root_width * header.default_ratio) / default_ratio_sum
      );
      domHeaders.forEach((header, index) => {
        header.style.width = `calc(${default_data_widths[index]}px)`;
        data_rows.forEach((data_row, _) => {
          data_row[index].style.width = `calc(${default_data_widths[index]}px)`;
        });
      });

      // Create resizer elements
      let left = 0;
      domHeaders.forEach((header, index) => {
        if (index === 0) {
          left += default_data_widths[index];
          return;
        }
        const resizer = document.createElement("div");
        resizer.classList.add("Resizer");
        resizer.style.left = `${left - 3}px`;
        table_root.insertBefore(resizer, tableRows[0]);
        existingResizers.push(resizer);
        left += default_data_widths[index];
      });
    } else {
      domHeaders.forEach((header, index) => {
        // Read the inline style — not getBoundingClientRect, which rounds
        // to subpixels and would shave 0.something px off the column every
        // time the tree mutated (collapse / expand / add). Over time that
        // made columns visibly shrink.
        const w = header.style.width || `${header.getBoundingClientRect().width}px`;
        data_rows.forEach((data_row, _) => {
          data_row[index].style.width = w;
        });
      });
    }
    syncResizerBounds(existingResizers);

    // For table_root resizing
    if (existingResizeObserver) {
      existingResizeObserver.disconnect(table_root);
    }
    /**
     * The NAME column (index 0) absorbs pane resizes. Name is the only
     * column guaranteed to exist (the others can be hidden via column
     * settings) and typically holds the longest content, so making it
     * the flexible one is both safe and matches users' expectations:
     *  - widening the pane fills the trailing gap into Name
     *  - narrowing the pane shrinks Name down to its CSS min-width; the
     *    other user-resized columns keep their pixel widths and the
     *    body scrolls when needed
     *  - collapse/expand cycles don't drift column widths because we
     *    always recompute Name from a stable formula instead of
     *    accumulating deltas.
     */
    function fitNameColumn() {
      if (domHeaders.length === 0) return;
      const tableWidth = table_root.getBoundingClientRect().width;
      const widths = domHeaders.map((h) => h.getBoundingClientRect().width);
      const fixedTotal = widths.slice(1).reduce((s, w) => s + w, 0);
      const nameMin = parseFloat(window.getComputedStyle(domHeaders[0]).minWidth) || 0;
      const nameWidth = Math.max(nameMin, tableWidth - fixedTotal);

      domHeaders[0].style.width = `${nameWidth}px`;
      data_rows.forEach((data_row) => {
        const cell = data_row[0];
        if (cell) cell.style.width = `${nameWidth}px`;
      });
      // Every resizer sits between two columns; since column 0 changed,
      // ALL resizer left positions shift by the delta. Re-place them
      // using the new Name width followed by each fixed downstream width.
      let left = nameWidth;
      existingResizers.forEach((resizer, idx) => {
        resizer.style.left = `${left - 3}px`;
        left += widths[idx + 1] ?? 0;
      });
    }

    const newResizeObserver = new ResizeObserver(() => {
      syncResizerBounds(existingResizers);
      fitNameColumn();
    });
    newResizeObserver.observe(table_root);

    return [existingResizers, domHeaders, data_rows, newResizeObserver];
  };

  const setResizersEvents = (resizers, headers, data_rows) => {
    const handlers = [];

    const applyColumnWidths = (widths) => {
      headers.forEach((columnHeader, index) => {
        columnHeader.style.width = `${widths[index]}px`;
        data_rows.forEach((data_row) => {
          data_row[index].style.width = `${widths[index]}px`;
        });
      });

      let left = 0;
      resizers.forEach((columnResizer, index) => {
        left += widths[index];
        columnResizer.style.left = `${left - 3}px`;
      });
    };

    // Create resizers and their events
    for (let i = 0; i < resizers.length; i++) {
      const resizer = resizers[i];
      const minWidths = headers.map(
        (columnHeader) => parseFloat(window.getComputedStyle(columnHeader).minWidth, 10) || 10
      );

      // Track the current position of mouse
      let x = 0;
      let initialWidths = [];

      const mouseDownHandler = function (e) {
        let cssText = document.body.style.cssText;
        document.body.style.cssText = cssText + "cursor: col-resize !important;";

        // Add HandlingResizer class
        resizer.classList.add("HandlingResizer");

        // Get the current mouse position
        x = e.clientX;

        // Calculate the current width of column
        initialWidths = headers.map((columnHeader) => columnHeader.getBoundingClientRect().width);

        // Attach listeners for document's events
        document.addEventListener("mousemove", mouseMoveHandler);
        document.addEventListener("mouseup", mouseUpHandler);
      };

      const mouseMoveHandler = function (e) {
        let dx = e.clientX - x;
        const nextWidths = [...initialWidths];

        if (dx < 0) {
          const leftShrinkCapacities = initialWidths
            .slice(0, i + 1)
            .map((width, index) => width - minWidths[index]);
          const maxLeftDelta = leftShrinkCapacities.reduce(
            (partialSum, width) => partialSum + width,
            0
          );
          const appliedDelta = Math.max(dx, -maxLeftDelta);

          nextWidths[i + 1] = initialWidths[i + 1] - appliedDelta;

          let remainingShrink = -appliedDelta;
          for (let j = i; j >= 0; j--) {
            const shrinkCapacity = initialWidths[j] - minWidths[j];
            const shrinkAmount = Math.min(shrinkCapacity, remainingShrink);
            nextWidths[j] = initialWidths[j] - shrinkAmount;
            remainingShrink -= shrinkAmount;
          }

          applyColumnWidths(nextWidths);
          return;
        }

        const shrinkCapacities = initialWidths
          .slice(i + 1)
          .map((width, index) => width - minWidths[i + 1 + index]);
        const maxDelta = shrinkCapacities.reduce((partialSum, width) => partialSum + width, 0);
        const appliedDelta = Math.min(dx, maxDelta);

        nextWidths[i] = initialWidths[i] + appliedDelta;

        let remainingShrink = appliedDelta;
        for (let j = i + 1; j < nextWidths.length; j++) {
          const shrinkCapacity = initialWidths[j] - minWidths[j];
          const shrinkAmount = Math.min(shrinkCapacity, remainingShrink);
          nextWidths[j] = initialWidths[j] - shrinkAmount;
          remainingShrink -= shrinkAmount;
        }

        applyColumnWidths(nextWidths);
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

  function handleSelectRow(event) {
    $table_selected_id = event.detail.id;
  }

  function handleScroll(event) {
    scrollTop = event.currentTarget.scrollTop;
    $ganttScrollTop = scrollTop;
    syncResizerBounds(resizers);
  }

  function handleToggleRow(event) {
    const { id } = event.detail;
    if ($closed_node_ids.has(id)) {
      closed_node_ids.delete(id);
    } else {
      closed_node_ids.add(id);
    }
  }

  function handleCommit(event) {
    const { id, patch } = event.detail;
    const data = updateNodeDataById($tree_data.data, id, patch);
    if (data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function canDropTarget(draggedId, targetId) {
    if (!draggedId || !targetId || !$tree_data?.data) {
      return false;
    }
    if (draggedId === targetId) {
      return false;
    }
    if (targetId === $tree_data.data.id) {
      return false;
    }
    return !isChild(targetId, draggedId, $tree_data.data);
  }

  function handleReorder(event) {
    const { draggedId, targetId, mode } = event.detail;
    if (!canDropTarget(draggedId, targetId)) {
      return;
    }

    const data = reorderTree(draggedId, targetId, $tree_data.data, mode);
    $tree_data = { ...$tree_data, data };
  }

  function handleMoveUp(event) {
    const { id } = event.detail;
    const row = rows.find((item) => item.id === id);
    if (!row?.canMoveUp) {
      return;
    }

    const data = moveNodeUp(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleMoveDown(event) {
    const { id } = event.detail;
    const row = rows.find((item) => item.id === id);
    if (!row?.canMoveDown) {
      return;
    }

    const data = moveNodeDown(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleIndentTask(event) {
    const { id } = event.detail;
    const row = rows.find((item) => item.id === id);
    const parentNode = getParent(id, $tree_data.data);
    const currentIndex = parentNode?.children.findIndex((child) => child.id === id) ?? -1;
    const newParentId = currentIndex > 0 ? parentNode.children[currentIndex - 1]?.id : undefined;

    if (!newParentId || !row?.canIndent) {
      return;
    }

    const data = indentNode(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };

    if ($closed_node_ids.has(newParentId)) {
      closed_node_ids.delete(newParentId);
    }
  }

  function handleOutdentTask(event) {
    const { id } = event.detail;
    const row = rows.find((item) => item.id === id);
    if (!row?.canOutdent) {
      return;
    }

    const data = outdentNode(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function focusNewNode(newNodeId) {
    setTimeout(() => {
      $table_selected_id = newNodeId;

      setTimeout(() => {
        const newRow = document.getElementById(newNodeId);
        if (newRow) {
          newRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 50);
    }, 0);
  }

  function handleAddRelative(targetId, action) {
    if (!targetId || !$tree_data?.data) {
      return;
    }

    const newNode = getDefaultNode();
    const addAction = targetId === $tree_data.data.id ? "append" : action;
    let parentId;

    if (addAction === "append") {
      parentId = targetId;
    } else {
      const parentNode = getParent(targetId, $tree_data.data);
      if (parentNode) {
        parentId = parentNode.id;
      }
    }

    const data = addNode(newNode, targetId, $tree_data.data, addAction);
    $tree_data = { ...$tree_data, data };

    if (parentId && $closed_node_ids.has(parentId)) {
      closed_node_ids.delete(parentId);
    }

    focusNewNode(newNode.id);
  }

  function handleAddBelow(event) {
    handleAddRelative(event.detail.id, "insert_after");
  }

  function handleAddChild(event) {
    handleAddRelative(event.detail.id, "append");
  }

  function handleCopyTask(event) {
    const { id } = event.detail;
    if (!id || !$tree_data?.data) return;
    const node = getNode(id, $tree_data.data);
    if (node) $copied_task = node;
  }

  function handlePasteTask(event) {
    const { id } = event.detail;
    if (!id || !$tree_data?.data || !$copied_task) return;
    const cloned = cloneWithNewIds($copied_task);
    const data = addNode(cloned, id, $tree_data.data, "append");
    $tree_data = { ...$tree_data, data };
    if ($closed_node_ids.has(id)) closed_node_ids.delete(id);
    focusNewNode(cloned.id);
  }

  function isEditingText() {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  }

  function handleGlobalKeydown(e) {
    if (!$table_selected_id || isEditingText()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      e.preventDefault();
      handleCopyTask({ detail: { id: $table_selected_id } });
    } else if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      e.preventDefault();
      handlePasteTask({ detail: { id: $table_selected_id } });
    }
  }

  function requestDelete(event) {
    const { id } = event.detail;
    const node = getNode(id, $tree_data.data);
    if (!node || node.id === $tree_data.data.id) {
      return;
    }

    deleteTargetId = id;
    deleteTargetName = node.data.name;
    showDeleteConfirm = true;
  }

  function toggleDeleteConfirm() {
    showDeleteConfirm = !showDeleteConfirm;
  }

  function confirmDelete() {
    if (!deleteTargetId) {
      return;
    }

    const data = rmNode(deleteTargetId, $tree_data.data);
    $tree_data = { ...$tree_data, data };
    if ($table_selected_id === deleteTargetId) {
      $table_selected_id = undefined;
    }
    deleteTargetId = undefined;
    deleteTargetName = "";
  }
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<div
  bind:this={table_root}
  class:TableRoot={true}
  style="--minWidth: {minWidth}"
  role="treegrid"
  aria-label="Task tree"
  on:scroll={handleScroll}
>
  <TreeTableHeader headers={visibleHeaders} {allHeaders} />
  {#if stickyTrail.length > 0}
    <div class="StickyTrail" aria-hidden="true">
      <div class="StickyTrailContent">
        {#each stickyTrail as trailRow, index (trailRow.id)}
          {#if index > 0}
            <span class="StickyTrailSeparator">/</span>
          {/if}
          <span
            class:StickyTrailItem={true}
            class:StickyTrailCurrent={index === stickyTrail.length - 1}
          >
            {trailRow.node.data.name}
          </span>
        {/each}
      </div>
    </div>
  {/if}
  {#if rows.length > 0}
    {#each rows as row (row.id)}
      <TreeTableRow
        {row}
        headers={visibleHeaders}
        selected={$table_selected_id === row.id}
        {isDark}
        canDrop={canDropTarget}
        canMoveUp={row.canMoveUp}
        canMoveDown={row.canMoveDown}
        canIndent={row.canIndent}
        canOutdent={row.canOutdent}
        inheritedDueDate={inheritedDueDateMap.get(row.id) ?? ""}
        nodePath={nodePathMap.get(row.id) ?? ""}
        on:select={handleSelectRow}
        on:toggle={handleToggleRow}
        on:commit={handleCommit}
        on:reorder={handleReorder}
        on:moveUp={handleMoveUp}
        on:moveDown={handleMoveDown}
        on:indentTask={handleIndentTask}
        on:outdentTask={handleOutdentTask}
        on:addBelow={handleAddBelow}
        on:addChild={handleAddChild}
        on:deleteTask={requestDelete}
        on:copyTask={handleCopyTask}
        on:pasteTask={handlePasteTask}
      />
    {/each}
  {:else}
    <div class="EmptyState">
      {#if hasNoTasks}
        <svg class="EmptyIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M12 12v4M10 14h4"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <p class="EmptyTitle">タスクがありません</p>
        <p class="EmptyHint">ヘッダーの + ボタンか、右クリックメニューからタスクを追加できます</p>
      {:else}
        <svg class="EmptyIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle
            cx="11"
            cy="11"
            r="8"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M21 21l-4.35-4.35"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <p class="EmptyTitle">一致するタスクがありません</p>
        <p class="EmptyHint">フィルターの条件を変更してください</p>
      {/if}
    </div>
  {/if}
</div>

<Dialog
  show={showDeleteConfirm}
  toggle={toggleDeleteConfirm}
  header="Confirm."
  content={`Do you really delete "${deleteTargetName}"?\nThis may delete child nodes.`}
  callback={confirmDelete}
/>

<style>
  .TableRoot {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: var(--minWidth);
    overflow-y: auto;
    position: relative;
  }
  .StickyTrail {
    /* Pinned breadcrumb sits flush under the 3rem tree header. No margin,
       no rounded corners, no shadow — it's a regular tree row that just
       happens to follow the scroll. */
    position: sticky;
    top: 3rem;
    z-index: 9998;
    height: 0;
    overflow: visible;
    pointer-events: none;
  }
  .StickyTrailContent {
    height: 2.5rem;
    min-height: 2.5rem;
    max-height: 2.5rem;
    margin: 0;
    padding: 0 var(--sp3);
    display: flex;
    align-items: center;
    gap: var(--sp2);
    box-sizing: border-box;
    background-color: var(--theme-color-Main-main);
    border-bottom: 1px solid var(--theme-color-Main-dark);
    color: var(--theme-color-Sub-main);
    white-space: nowrap;
    overflow: hidden;
  }
  .StickyTrailItem {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.78;
  }
  .StickyTrailCurrent {
    opacity: 1;
    font-weight: 700;
    color: var(--theme-color-Primary-dark);
  }
  .StickyTrailSeparator {
    opacity: 0.55;
    flex-shrink: 0;
  }
  .TableRoot :global(.Resizer) {
    position: absolute;
    top: 0;
    width: 5px;
    cursor: col-resize;
    user-select: none;
    z-index: 10000;
  }
  .TableRoot :global(.HandlingResizer::before),
  .TableRoot :global(.Resizer:hover::before) {
    content: "";
    position: absolute;
    top: 0;
    left: 2px;
    width: 2px;
    height: 100%;
    background-color: var(--theme-color-Primary-main);
    opacity: 0.9;
  }
  .EmptyState {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp2);
    padding: 4rem var(--sp7);
    color: var(--theme-color-Sub-dark);
    user-select: none;
  }
  .EmptyIcon {
    width: 3rem;
    height: 3rem;
    opacity: 0.35;
    stroke: var(--theme-color-Sub-dark);
  }
  .EmptyTitle {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    opacity: 0.6;
  }
  .EmptyHint {
    margin: 0;
    font-size: var(--font-label-md);
    opacity: 0.45;
    text-align: center;
  }
</style>
