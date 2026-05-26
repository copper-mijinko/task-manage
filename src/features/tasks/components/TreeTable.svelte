<script>
  import { onDestroy, onMount } from "svelte";
  import TreeTableHeader from "@features/tasks/components/TreeTableHeader.svelte";
  import TreeTableRow from "@features/tasks/components/TreeTableRow.svelte";
  import BulkActionBar from "@features/tasks/components/BulkActionBar.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import {
    tree_data,
    selected_type,
    filtered_data,
    closed_node_ids,
    table_selected_id,
    theme,
    column_settings,
    ganttScrollTop,
  } from "@stores";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import {
    flattenVisibleTree,
    buildInheritedDueDateMap,
    buildLineNumberMap,
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
    bulkUpdateNodeData,
    bulkRemoveNodes,
    bulkMoveUp,
    bulkMoveDown,
    bulkIndent,
    bulkOutdent,
    bulkAddNodes,
    bulkDuplicate,
    areAllSiblings,
    isContiguousSiblingBlock,
    getTopLevelSelection,
  } from "@features/tasks/utils/tree_control";
  import {
    copied_task,
    copied_tasks,
    selected_ids,
    selection_anchor_id,
    clearSelection,
    selectOnly,
    toggleSelection,
    selectRange,
    selectAll,
    pruneSelection,
  } from "@stores/ui";

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
  $: lineNumberMap = buildLineNumberMap($filtered_data);
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
  let bulkDeleteCount = 0;
  let bulkDeleteIsBulk = false;
  let taskFolderOpenError = "";
  let taskFolderOpenErrorTimer;

  // Visible row ids excluding the project root (root is not selectable).
  $: visibleSelectableIds = rows.filter((r) => r.id !== $tree_data?.data?.id).map((r) => r.id);
  $: anchorRowExists = $selection_anchor_id !== undefined;
  $: selectionSet = $selected_ids;
  $: selectionSize = selectionSet.size;
  $: canSiblingMove = selectionSize > 0 && isContiguousSiblingBlock($tree_data?.data, selectionSet);
  $: canTreeOp = selectionSize > 0 && areAllSiblings($tree_data?.data, selectionSet);
  // Outdent is permitted iff the shared parent has its own parent.
  $: canBulkOutdent = (() => {
    if (!canTreeOp || !$tree_data?.data) return false;
    const anyId = selectionSet.values().next().value;
    if (!anyId) return false;
    const parent = getParent(anyId, $tree_data.data);
    if (!parent) return false;
    return !!getParent(parent.id, $tree_data.data);
  })();
  $: selectableCount = visibleSelectableIds.length;
  $: selectedCount = selectionSize;

  // Filter or tree-shape changes can hide previously selected rows. Prune the
  // multi-selection by what survives the current filter (independent of expand /
  // collapse, which we want to preserve). This also handles "node deleted from
  // another window / undo of add" because the deleted id is no longer in the
  // filtered tree.
  function collectAllFilteredIds(node) {
    if (!node) return new Set();
    const out = new Set();
    function visit(n) {
      out.add(n.id);
      for (const c of n.children ?? []) visit(c);
    }
    visit(node);
    return out;
  }
  let lastFilterKey = "";
  $: filteredIds = collectAllFilteredIds($filtered_data);
  $: {
    // Stringify the id set as a cheap change key; only re-prune when it changes.
    const key = Array.from(filteredIds).sort().join("|");
    if (key !== lastFilterKey) {
      lastFilterKey = key;
      if (selectionSize > 0) {
        pruneSelection(filteredIds);
      }
    }
  }

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

  onDestroy(() => {
    if (taskFolderOpenErrorTimer) clearTimeout(taskFolderOpenErrorTimer);
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

    const getLeadingColumnWidth = () =>
      tableRows[0]?.querySelector(".CheckboxHeaderCell")?.getBoundingClientRect().width ?? 0;

    // Set width
    if (is_default) {
      const default_ratio_sum = currentHeaders.reduce(
        (partialSum, header) => partialSum + header.default_ratio,
        0
      );
      const leadingColumnWidth = getLeadingColumnWidth();
      const default_root_width = Math.max(
        0,
        tableRows[0].getBoundingClientRect().width - leadingColumnWidth
      );
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
      let left = leadingColumnWidth;
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
      const leadingColumnWidth = getLeadingColumnWidth();
      const widths = domHeaders.map((h) => h.getBoundingClientRect().width);
      const fixedTotal = widths.slice(1).reduce((s, w) => s + w, 0);
      const nameMin = parseFloat(window.getComputedStyle(domHeaders[0]).minWidth) || 0;
      const nameWidth = Math.max(nameMin, tableWidth - leadingColumnWidth - fixedTotal);

      domHeaders[0].style.width = `${nameWidth}px`;
      data_rows.forEach((data_row) => {
        const cell = data_row[0];
        if (cell) cell.style.width = `${nameWidth}px`;
      });
      // Every resizer sits between two columns; since column 0 changed,
      // ALL resizer left positions shift by the delta. Re-place them
      // using the new Name width followed by each fixed downstream width.
      let left = leadingColumnWidth + nameWidth;
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

      const leadingColumnWidth =
        table_root?.querySelector(".CheckboxHeaderCell")?.getBoundingClientRect().width ?? 0;
      let left = leadingColumnWidth;
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
    const { id, shiftKey, ctrlKey } = event.detail;
    if (shiftKey && $selection_anchor_id) {
      selectRange(
        id,
        rows.map((r) => r.id)
      );
    } else if (ctrlKey) {
      toggleSelection(id);
    } else {
      selectOnly(id);
    }
  }

  function handleToggleCheckbox(event) {
    const { id, shiftKey, ctrlKey } = event.detail;
    if (shiftKey && $selection_anchor_id) {
      selectRange(
        id,
        rows.map((r) => r.id)
      );
    } else if (ctrlKey) {
      toggleSelection(id);
    } else {
      // Checkbox click is always additive — never collapses the selection.
      toggleSelection(id);
    }
  }

  function handleHeaderSelectAll() {
    selectAll(visibleSelectableIds);
  }

  function handleHeaderClearSelection() {
    clearSelection();
  }

  function handleBackgroundClick() {
    table_root?.focus?.();
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
    const { draggedIds, targetId, mode } = event.detail;
    if (!draggedIds || draggedIds.length === 0) return;
    if (!$tree_data?.data) return;

    // Reject if any dragged id can't drop on target.
    if (!draggedIds.every((id) => canDropTarget(id, targetId))) {
      return;
    }

    if (draggedIds.length === 1) {
      const data = reorderTree(draggedIds[0], targetId, $tree_data.data, mode);
      $tree_data = { ...$tree_data, data };
    } else {
      // Multi-row D&D: collapse to top-level ancestors, capture node references,
      // remove them from the tree, then insert at target in original DFS order.
      const topLevelIds = getTopLevelSelection($tree_data.data, new Set(draggedIds));
      const draggedNodes = topLevelIds.map((id) => getNode(id, $tree_data.data)).filter((n) => n);
      if (draggedNodes.length === 0) return;

      let data = bulkRemoveNodes($tree_data.data, new Set(topLevelIds));
      if (!data) return;
      data = bulkAddNodes(draggedNodes, targetId, data, mode);
      $tree_data = { ...$tree_data, data };
    }

    if (mode === "append" && $closed_node_ids.has(targetId)) {
      closed_node_ids.delete(targetId);
    }
  }

  function isInMultiSelection(id) {
    return selectionSize > 1 && $selected_ids.has(id);
  }

  function handleMoveUp(event) {
    const { id } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkMoveUp();
      return;
    }
    const row = rows.find((item) => item.id === id);
    if (!row?.canMoveUp) {
      return;
    }

    const data = moveNodeUp(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleMoveDown(event) {
    const { id } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkMoveDown();
      return;
    }
    const row = rows.find((item) => item.id === id);
    if (!row?.canMoveDown) {
      return;
    }

    const data = moveNodeDown(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleIndentTask(event) {
    const { id } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkIndent();
      return;
    }
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
    if (isInMultiSelection(id)) {
      handleBulkOutdent();
      return;
    }
    const row = rows.find((item) => item.id === id);
    if (!row?.canOutdent) {
      return;
    }

    const data = outdentNode(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function focusNewNode(newNodeId) {
    setTimeout(() => {
      selectOnly(newNodeId);

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
    if (isInMultiSelection(id)) {
      const topIds = getTopLevelSelection($tree_data.data, selectionSet);
      const topNodes = topIds.map((tid) => getNode(tid, $tree_data.data)).filter((n) => n);
      $copied_tasks = topNodes;
      $copied_task = topNodes[0] ?? null;
      return;
    }
    const node = getNode(id, $tree_data.data);
    if (node) {
      $copied_task = node;
      $copied_tasks = [node];
    }
  }

  function handlePasteTask(event) {
    const { id } = event.detail;
    if (!id || !$tree_data?.data) return;
    if ($copied_tasks && $copied_tasks.length > 1) {
      const cloned = $copied_tasks.map((n) => cloneWithNewIds(n));
      const data = bulkAddNodes(cloned, id, $tree_data.data, "append");
      $tree_data = { ...$tree_data, data };
      if ($closed_node_ids.has(id)) closed_node_ids.delete(id);
      if (cloned[0]) focusNewNode(cloned[0].id);
      return;
    }
    const source = $copied_task ?? $copied_tasks?.[0] ?? null;
    if (!source) return;
    const cloned = cloneWithNewIds(source);
    const data = addNode(cloned, id, $tree_data.data, "append");
    $tree_data = { ...$tree_data, data };
    if ($closed_node_ids.has(id)) closed_node_ids.delete(id);
    focusNewNode(cloned.id);
  }

  function showTaskFolderOpenError(message) {
    taskFolderOpenError = message;
    if (taskFolderOpenErrorTimer) clearTimeout(taskFolderOpenErrorTimer);
    taskFolderOpenErrorTimer = setTimeout(() => {
      taskFolderOpenError = "";
    }, 4000);
  }

  async function handleOpenTaskFolder(event) {
    const { id } = event.detail;
    const result = await workspace_store.openTaskFolder(id);
    if (!result?.success) {
      showTaskFolderOpenError(result?.error ?? "Task folderを開けませんでした");
    }
  }

  // --- Bulk operation handlers ---------------------------------------------

  function handleBulkStatus(event) {
    if (!$tree_data?.data || selectionSize === 0) return;
    const { value } = event.detail;
    const data = bulkUpdateNodeData($tree_data.data, selectionSet, { status: value });
    if (data && data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function handleBulkSetDate(event) {
    if (!$tree_data?.data || selectionSize === 0) return;
    const { key, value } = event.detail;
    const data = bulkUpdateNodeData($tree_data.data, selectionSet, { [key]: value });
    if (data && data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function handleBulkClearDate(event) {
    if (!$tree_data?.data || selectionSize === 0) return;
    const { key } = event.detail;
    const data = bulkUpdateNodeData($tree_data.data, selectionSet, { [key]: undefined });
    if (data && data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function handleBulkMoveUp() {
    if (!$tree_data?.data || !canSiblingMove) return;
    const data = bulkMoveUp(selectionSet, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleBulkMoveDown() {
    if (!$tree_data?.data || !canSiblingMove) return;
    const data = bulkMoveDown(selectionSet, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleBulkIndent() {
    if (!$tree_data?.data || !canTreeOp) return;
    const { tree_data: data, new_parent_ids } = bulkIndent(selectionSet, $tree_data.data);
    $tree_data = { ...$tree_data, data };
    for (const pid of new_parent_ids) {
      if ($closed_node_ids.has(pid)) closed_node_ids.delete(pid);
    }
  }

  function handleBulkOutdent() {
    if (!$tree_data?.data || !canTreeOp || !canBulkOutdent) return;
    const data = bulkOutdent(selectionSet, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleBulkDuplicate() {
    if (!$tree_data?.data || selectionSize === 0) return;
    const topLevelIds = getTopLevelSelection($tree_data.data, selectionSet);
    const topNodes = topLevelIds.map((id) => getNode(id, $tree_data.data)).filter((n) => n);
    if (topNodes.length === 0) return;
    $copied_tasks = topNodes;
    $copied_task = topNodes[0] ?? null;
  }

  function handleBulkDelete() {
    if (!$tree_data?.data || selectionSize === 0) return;
    const rootId = $tree_data.data.id;
    const targetIds = Array.from(selectionSet).filter((id) => id !== rootId);
    if (targetIds.length === 0) return;
    bulkDeleteCount = targetIds.length;
    bulkDeleteIsBulk = true;
    deleteTargetId = undefined;
    deleteTargetName = "";
    showDeleteConfirm = true;
  }

  function isEditingText() {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  }

  function handleGlobalKeydown(e) {
    if (isEditingText()) return;
    // Selection-aware shortcuts (Esc / Ctrl+A / Delete) act on the multi-selection.
    if (e.key === "Escape") {
      if (selectionSize > 0) {
        e.preventDefault();
        clearSelection();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      selectAll(visibleSelectableIds);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectionSize > 0) {
      e.preventDefault();
      handleBulkDelete();
      return;
    }
    if (!$table_selected_id) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      if (selectionSize > 1 && $tree_data?.data) {
        const topLevelIds = getTopLevelSelection($tree_data.data, selectionSet);
        const topNodes = topLevelIds.map((id) => getNode(id, $tree_data.data)).filter((n) => n);
        $copied_tasks = topNodes;
        $copied_task = topNodes[0] ?? null;
      } else {
        handleCopyTask({ detail: { id: $table_selected_id } });
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
      e.preventDefault();
      handlePasteTask({ detail: { id: $table_selected_id } });
    }
  }

  function requestDelete(event) {
    const { id } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkDelete();
      return;
    }
    const node = getNode(id, $tree_data.data);
    if (!node || node.id === $tree_data.data.id) {
      return;
    }

    deleteTargetId = id;
    deleteTargetName = node.data.name;
    bulkDeleteIsBulk = false;
    bulkDeleteCount = 0;
    showDeleteConfirm = true;
  }

  function toggleDeleteConfirm() {
    showDeleteConfirm = !showDeleteConfirm;
    if (!showDeleteConfirm) {
      bulkDeleteIsBulk = false;
      bulkDeleteCount = 0;
    }
  }

  function confirmDelete() {
    if (bulkDeleteIsBulk) {
      if (!$tree_data?.data || selectionSize === 0) return;
      const rootId = $tree_data.data.id;
      const targets = new Set(Array.from(selectionSet).filter((id) => id !== rootId));
      if (targets.size === 0) return;
      const data = bulkRemoveNodes($tree_data.data, targets);
      if (data && data !== $tree_data.data) {
        $tree_data = { ...$tree_data, data };
      }
      clearSelection();
      bulkDeleteIsBulk = false;
      bulkDeleteCount = 0;
      return;
    }
    if (!deleteTargetId) {
      return;
    }

    const data = rmNode(deleteTargetId, $tree_data.data);
    $tree_data = { ...$tree_data, data };
    if ($table_selected_id === deleteTargetId) {
      clearSelection();
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
  aria-multiselectable="true"
  tabindex="-1"
  on:scroll={handleScroll}
  on:click|self={handleBackgroundClick}
  on:keydown|self={(e) => {
    if (e.key === "Escape") handleBackgroundClick();
  }}
>
  {#if taskFolderOpenError}
    <div class="TaskFolderOpenError" role="alert">{taskFolderOpenError}</div>
  {/if}
  <TreeTableHeader
    headers={visibleHeaders}
    {allHeaders}
    {selectedCount}
    {selectableCount}
    on:selectAll={handleHeaderSelectAll}
    on:clearSelection={handleHeaderClearSelection}
  />
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
        selected={$selected_ids.has(row.id)}
        isAnchor={$selection_anchor_id === row.id}
        anyMultiSelected={selectionSize > 1}
        {isDark}
        canDrop={canDropTarget}
        canMoveUp={row.canMoveUp}
        canMoveDown={row.canMoveDown}
        canIndent={row.canIndent}
        canOutdent={row.canOutdent}
        canOpenTaskFolder={$selected_type === "WorkspaceProject" &&
          Boolean($workspace_store.activeProjectDir)}
        bulkCanMove={canSiblingMove}
        bulkCanTreeOp={canTreeOp}
        bulkCanOutdent={canBulkOutdent}
        inheritedDueDate={inheritedDueDateMap.get(row.id) ?? ""}
        nodePath={nodePathMap.get(row.id) ?? ""}
        lineNumber={lineNumberMap.get(row.id) ?? 0}
        on:select={handleSelectRow}
        on:toggleCheckbox={handleToggleCheckbox}
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
        on:openTaskFolder={handleOpenTaskFolder}
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
  content={bulkDeleteIsBulk
    ? `選択中の ${bulkDeleteCount} 件を削除しますか？\n子タスクも一緒に削除されます。`
    : `Do you really delete "${deleteTargetName}"?\nThis may delete child nodes.`}
  callback={confirmDelete}
/>

<BulkActionBar
  count={selectionSize}
  on:bulkStatus={handleBulkStatus}
  on:bulkSetDate={handleBulkSetDate}
  on:bulkClearDate={handleBulkClearDate}
  on:bulkCopy={handleBulkDuplicate}
  on:clearSelection={() => clearSelection()}
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
  .TaskFolderOpenError {
    position: absolute;
    top: var(--sp2);
    right: var(--sp2);
    z-index: 10001;
    max-width: min(28rem, calc(100% - var(--sp4)));
    padding: var(--sp1) var(--sp2);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Error-main);
    color: #fff;
    font-size: var(--font-body-sm);
    box-shadow: var(--elevation-1);
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
