<script>
  import { onDestroy, onMount, tick } from "svelte";
  import TreeTableHeader from "@features/tasks/components/TreeTableHeader.svelte";
  import TreeTableRow from "@features/tasks/components/TreeTableRow.svelte";
  import BulkActionBar from "@features/tasks/components/BulkActionBar.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import {
    tree_data,
    selected_type,
    filtered_data,
    closed_row_paths,
    active_row_path,
    table_selected_id,
    theme,
    column_settings,
    ganttScrollTop,
  } from "@stores";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { DEFAULT_COLUMN_SETTINGS } from "@features/tasks/stores/column_settings";
  import {
    flattenVisibleTree,
    buildInheritedDueDateMap,
    buildLineNumberMap,
    buildNodePathMap,
    buildStickyTrail,
    updateNodeDataById,
    isChild,
    reorderTree,
    addNode,
    rmNode,
    getNode,
    getParent,
    getNodeByPath,
    parentPathOf,
    getDefaultNode,
    moveNodeUp,
    moveNodeDown,
    indentNode,
    outdentNode,
    cloneWithNewIds,
    bulkUpdateNodeData,
    bulkRemoveNodes,
    reattachOrphans,
    bulkMoveUp,
    bulkMoveDown,
    bulkIndent,
    bulkOutdent,
    bulkAddNodes,
    bulkDuplicate,
    areAllSiblings,
    isContiguousSiblingBlock,
    isNodeEffectivelyArchived,
    getTopLevelSelection,
    archiveNode,
    restoreNode,
    bulkArchiveNodes,
    bulkRestoreNodes,
  } from "@features/tasks/utils/tree_control";
  import {
    copied_task,
    copied_tasks,
    selected_ids,
    bulk_selection_active,
    selection_anchor_id,
    clearSelection,
    selectOnly,
    toggleSelection,
    selectRange,
    selectAll,
    pruneSelection,
    show_archived,
  } from "@stores/ui";
  import { navigation_history } from "@stores/navigation_history";
  import {
    hasSelectedDocumentText,
    hasSelectedMemoText,
    isTextEditingTarget,
  } from "@lib/utils/hotkey_priority";

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
    { name: "attachments", default_ratio: 1.5 },
    { name: "tags", default_ratio: 3 },
  ];

  $: rows = $filtered_data
    ? flattenVisibleTree($filtered_data, $closed_row_paths, $show_archived)
    : [];
  /**
   * いま操作している 1 行（＝辺）。選択はノード単位なので、多親ノードを選ぶと
   * その出現すべてが選択色になる。どこを操作しているのかは行でしか分からない
   * ので、経路で 1 行だけを「現在行」として別扱いする。
   *
   * Tab の停留点も同じ行。全行を tabindex="0" にすると、テーブルを通り過ぎる
   * だけで行数ぶん Tab を押すことになる。
   */
  $: {
    const stillValid = rows.some(
      (row) =>
        row.path === $active_row_path && ($selected_ids.size === 0 || $selected_ids.has(row.id))
    );
    if (!stillValid) {
      $active_row_path =
        rows.find((row) => $selected_ids.has(row.id))?.path ?? rows[0]?.path ?? undefined;
    }
  }
  $: tabStopRowPath = $active_row_path;
  $: activeRowId = rows.find((row) => row.path === $active_row_path)?.id ?? null;
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

    // Include any headers not covered by settings. Built-in columns that ship
    // hidden by default (tags) are excluded: a settings list saved before that
    // column existed means "the user never chose it", not "show it".
    const settingIds = new Set(settings.map((s) => s.id));
    const defaultHidden = new Set(
      DEFAULT_COLUMN_SETTINGS.filter((column) => !column.visible).map((column) => column.id)
    );
    for (const header of availableHeaders) {
      if (settingIds.has(header.name) || defaultHidden.has(header.name)) continue;
      result.push(header);
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

  // Memoize the id→row map against `rows` so scrolling (which only changes
  // scrollTop) does not rebuild it for every frame. Likewise cache the row
  // height and only recompute it when the theme changes, avoiding a forced
  // style recalc (getComputedStyle) on every scroll event.
  // 祖先を辿るキーは経路。多親ノードは同じ id の行が複数あるので id では引けない。
  $: rowByPath = new Map(rows.map((row) => [row.path, row]));
  let stickyRowHeightPx = 0;
  $: {
    void $theme;
    stickyRowHeightPx = getRowHeightPx();
  }
  $: stickyTrail = buildStickyTrail(rows, scrollTop, stickyRowHeightPx, rowByPath);

  let showDeleteConfirm = false;
  let deleteTargetId;
  let deleteTargetName = "";
  let bulkDeleteCount = 0;
  let bulkDeleteIsBulk = false;
  /** 単発時のモード: "archive" | "permanent"。bulk のときは見ない。 */
  let deleteMode = "archive";
  /** bulk のときの振り分け結果。 */
  let bulkArchiveTargetIds = [];
  let bulkPermanentTargetIds = [];
  let taskFolderOpenError = "";
  let taskFolderOpenErrorTimer;

  // Visible row ids excluding the project root (root is not selectable).
  $: visibleSelectableIds = rows.filter((r) => r.id !== $tree_data?.data?.id).map((r) => r.id);
  $: anchorRowExists = $selection_anchor_id !== undefined;
  $: selectionSet = $selected_ids;
  $: selectionSize = selectionSet.size;
  // 一括操作の基準の親は、いま操作している行の親（多親ノードが混ざったとき、
  // どの親の下でまとめて動かすのかを画面と一致させる）。
  $: bulkParentPath = parentPathOf($active_row_path ?? "");
  $: canSiblingMove =
    selectionSize > 0 && isContiguousSiblingBlock($tree_data?.data, selectionSet, bulkParentPath);
  $: canTreeOp =
    selectionSize > 0 && areAllSiblings($tree_data?.data, selectionSet, bulkParentPath);
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
  $: selectedCount = $bulk_selection_active ? selectionSize : 0;

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

    return () => {
      mutation_observer.disconnect();
      resize_observer?.disconnect();
      unsetResizerEvents(resizers, handlers ?? []);
      resizers.forEach((resizer) => resizer.parentNode?.removeChild(resizer));
      resizers = [];
    };
  });

  onDestroy(() => {
    if (taskFolderOpenErrorTimer) clearTimeout(taskFolderOpenErrorTimer);
  });

  // Cached total height of all table rows. Measuring it walks every row with
  // getBoundingClientRect (O(rows) forced reflow), so we only re-measure when
  // rows or the container actually change — not on every scroll tick.
  let cachedResizerContentHeight = 0;

  const measureResizerContentHeight = () => {
    if (!table_root) return 0;
    const tableRows = Array.from(table_root.querySelectorAll(".TableRow"));
    cachedResizerContentHeight = tableRows.reduce(
      (height, row) => height + row.getBoundingClientRect().height,
      0
    );
    return cachedResizerContentHeight;
  };

  // `remeasure` defaults to true so structural callers (createResizers, the
  // ResizeObserver, column/row mutations) always reflect the latest layout.
  // The scroll handler passes `false`: scrolling changes only the resizers'
  // top/height derived from scrollTop, never the content height itself.
  const syncResizerBounds = (targetResizers = resizers, { remeasure = true } = {}) => {
    if (!table_root) {
      return;
    }

    const contentHeight = remeasure ? measureResizerContentHeight() : cachedResizerContentHeight;
    const top = table_root.scrollTop;
    const height = Math.max(0, Math.min(table_root.clientHeight, contentHeight - top));

    targetResizers.forEach((resizer) => {
      resizer.style.top = `${top}px`;
      resizer.style.height = `${height}px`;
    });
  };

  const getLeadingColumnWidth = () =>
    table_root?.querySelector(".CheckboxHeaderCell")?.getBoundingClientRect().width ?? 0;

  const positionResizers = (targetResizers, widths) => {
    let left = getLeadingColumnWidth();
    targetResizers.forEach((resizer, index) => {
      left += widths[index] ?? 0;
      resizer.style.left = `${left - 3}px`;
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
      domHeaders.forEach((_header, index) => {
        if (index === domHeaders.length - 1) return;
        const resizer = document.createElement("div");
        resizer.classList.add("Resizer");
        table_root.insertBefore(resizer, tableRows[0]);
        existingResizers.push(resizer);
      });
      positionResizers(existingResizers, default_data_widths);
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
      positionResizers(
        existingResizers,
        domHeaders.map((header) => header.getBoundingClientRect().width)
      );
    }
    syncResizerBounds(existingResizers);

    // For table_root resizing
    if (existingResizeObserver) {
      existingResizeObserver.disconnect();
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
      if (!table_root?.isConnected || domHeaders.length === 0 || !domHeaders[0]?.isConnected) {
        return;
      }
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
      // ALL resizer left positions shift by the delta.
      positionResizers(existingResizers, [nameWidth, ...widths.slice(1)]);
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

      positionResizers(resizers, widths);
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
    const { id, path, shiftKey, ctrlKey } = event.detail;
    if (path) $active_row_path = path;
    if (shiftKey && $selection_anchor_id) {
      selectRange(
        id,
        rows.map((r) => r.id),
        rows,
        rowFor(id, path)?.path
      );
    } else if (ctrlKey) {
      toggleSelection(id);
    } else {
      selectOnly(id, path);
    }
    // ユーザの能動的なタスク行選択は、ページ遷移と同等の navigation event として
    // 履歴に積む。subscriber 経路で同ページ内の table_selected_id 変更を in-place
    // 更新に倒しているため、ここで明示的に呼ばないとクリック履歴が残らない。
    navigation_history.pushSelection();
  }

  function handleToggleCheckbox(event) {
    const { id, path, shiftKey, ctrlKey } = event.detail;
    if (path) $active_row_path = path;
    if (!$bulk_selection_active) {
      selectOnly(id, path);
      $bulk_selection_active = true;
      return;
    }
    if (shiftKey && $selection_anchor_id) {
      selectRange(
        id,
        rows.map((r) => r.id),
        rows,
        rowFor(id, path)?.path
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
    // Scrolling only shifts the resizers vertically; the content height is
    // unchanged, so reuse the cached measurement instead of re-walking rows.
    syncResizerBounds(resizers, { remeasure: false });
  }

  /**
   * treegrid のキーボード操作（WAI-ARIA の treegrid パターン）。
   *
   * これまで行には Enter / Space しか無く、矢印キーが一切効かなかった。
   * ツリーを辿るには行内のコントロールを Tab で全部踏むしかなく、タスクが
   * 増えるほど現実的でなくなる。移動に必要な「表示中の行の並び」と親子関係は
   * ここ（rows）にしかないので、判定もここに置く。
   */
  /** 経路で行を引く。多親ノードは複数行に出るので、ノード id では足りない。 */
  function focusRowByPath(path) {
    if (!path) return;
    const target = table_root?.querySelector(`[role="row"][data-row-path="${CSS.escape(path)}"]`);
    if (!target) return;
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  }

  /** 行へ移動する。選択もクリックと同じように動かし、詳細ペインを追従させる。 */
  function moveToRow(id, path, { shiftKey = false } = {}) {
    if (!id) return;
    if (shiftKey && $selection_anchor_id) {
      selectRange(
        id,
        rows.map((r) => r.id),
        rows,
        rowFor(id, path)?.path
      );
    } else {
      selectOnly(id, path);
    }
    $active_row_path = path;
    navigation_history.pushSelection();
    // 選択の反映で行が描き直されるため、DOM が落ち着いてから focus する。
    tick().then(() => focusRowByPath(path));
  }

  function handleRowNavigate(event) {
    const { id, path, key, shiftKey } = event.detail;
    // 多親ノードは複数行に出るため、位置は経路で決める。
    const index = rows.findIndex((row) => row.path === path);
    if (index < 0) return;
    const row = rows[index];

    switch (key) {
      case "ArrowDown":
        if (index < rows.length - 1)
          moveToRow(rows[index + 1].id, rows[index + 1].path, { shiftKey });
        return;
      case "ArrowUp":
        if (index > 0) moveToRow(rows[index - 1].id, rows[index - 1].path, { shiftKey });
        return;
      case "Home":
        if (rows.length > 0) moveToRow(rows[0].id, rows[0].path, { shiftKey });
        return;
      case "End":
        if (rows.length > 0)
          moveToRow(rows[rows.length - 1].id, rows[rows.length - 1].path, { shiftKey });
        return;
      case "ArrowRight":
        // 閉じていれば開く。開いていれば最初の子へ入る。
        if (row.hasChildren && !row.expanded) {
          closed_row_paths.delete(row.path);
        } else if (row.hasChildren && index < rows.length - 1) {
          moveToRow(rows[index + 1].id, rows[index + 1].path);
        }
        return;
      case "ArrowLeft":
        // 開いていれば閉じる。閉じている / 子が無ければ親へ戻る。
        if (row.hasChildren && row.expanded) {
          closed_row_paths.add(row.path);
        } else if (row.parentId) {
          const parentPath = row.path.slice(0, row.path.lastIndexOf("/"));
          moveToRow(row.parentId, parentPath);
        }
        return;
      default:
    }
  }

  function handleToggleRow(event) {
    // 開閉は経路ごと。同じノードでも、別の親の下の行は畳んだままにする。
    const { path } = event.detail;
    if (!path) return;
    if ($closed_row_paths.has(path)) {
      closed_row_paths.delete(path);
    } else {
      closed_row_paths.add(path);
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
    const { draggedIds, draggedPath, targetId, targetPath, mode } = event.detail;
    if (!draggedIds || draggedIds.length === 0) return;
    if (!$tree_data?.data) return;

    // Reject if any dragged id can't drop on target.
    if (!draggedIds.every((id) => canDropTarget(id, targetId))) {
      return;
    }

    if (draggedIds.length === 1) {
      // 掴んだ辺を外して、落とした行の位置に付け直す（どちらも経路で決まる）。
      const data = reorderTree(draggedIds[0], targetId, $tree_data.data, mode, {
        targetPath: draggedPath,
        basePath: targetPath,
      });
      $tree_data = { ...$tree_data, data };
    } else {
      // Multi-row D&D: collapse to top-level ancestors, capture node references,
      // remove them from the tree, then insert at target in original DFS order.
      const topLevelIds = getTopLevelSelection($tree_data.data, new Set(draggedIds));
      const draggedNodes = topLevelIds.map((id) => getNode(id, $tree_data.data)).filter((n) => n);
      if (draggedNodes.length === 0) return;

      let data = bulkRemoveNodes($tree_data.data, new Set(topLevelIds));
      if (!data) return;
      data = bulkAddNodes(draggedNodes, targetId, data, mode, targetPath);
      $tree_data = { ...$tree_data, data };
    }

    if (mode === "append") {
      // 落とし先が畳まれていると結果が見えないので、その行を開く。
      closed_row_paths.expandNodeEverywhere(targetId);
    }
  }

  /**
   * 操作対象の行。多親ノードは同じ id の行が複数あるので、経路が来ていれば
   * それを優先する（来なければ操作中の行、最後に最初の出現）。
   */
  function rowFor(id, path) {
    return (
      rows.find((item) => item.path === path) ??
      rows.find((item) => item.id === id && item.path === $active_row_path) ??
      rows.find((item) => item.id === id)
    );
  }

  function isInMultiSelection(id) {
    return selectionSize > 1 && $selected_ids.has(id);
  }

  function handleMoveUp(event) {
    const { id, path } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkMoveUp();
      return;
    }
    const row = rowFor(id, path);
    if (!row?.canMoveUp) {
      return;
    }

    const data = moveNodeUp(id, $tree_data.data, row.path);
    $tree_data = { ...$tree_data, data };
  }

  function handleMoveDown(event) {
    const { id, path } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkMoveDown();
      return;
    }
    const row = rowFor(id, path);
    if (!row?.canMoveDown) {
      return;
    }

    const data = moveNodeDown(id, $tree_data.data, row.path);
    $tree_data = { ...$tree_data, data };
  }

  function handleIndentTask(event) {
    const { id, path } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkIndent();
      return;
    }
    const row = rowFor(id, path);
    // 多親ノードは行ごとに親が違うので、親はクリックした行の経路から引く。
    const parentNode = getNodeByPath($tree_data.data, parentPathOf(row?.path ?? ""));
    const currentIndex = parentNode?.children.findIndex((child) => child.id === id) ?? -1;
    const newParentId = currentIndex > 0 ? parentNode.children[currentIndex - 1]?.id : undefined;

    if (!newParentId || !row?.canIndent) {
      return;
    }

    const data = indentNode(id, $tree_data.data, row.path);
    $tree_data = { ...$tree_data, data };

    closed_row_paths.expandNodeEverywhere(newParentId);
  }

  function handleOutdentTask(event) {
    const { id, path } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkOutdent();
      return;
    }
    const row = rowFor(id, path);
    if (!row?.canOutdent) {
      return;
    }

    const data = outdentNode(id, $tree_data.data, row.path);
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

    if (parentId) closed_row_paths.expandNodeEverywhere(parentId);

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

  // NOTE on clipboard aliasing: handleCopyTask (above) stores a *live* reference
  // into $tree_data.data, not a snapshot (despite the "freshly cloned" wording
  // in stores/ui.ts — that clone only actually happens here, at paste time).
  // That's fine for a single paste, but it becomes a real bug when the paste
  // target is a descendant of the copied node — which is ALWAYS the case when
  // the copied node is the project root, since every other row in the tree is
  // by definition its descendant. addNode/bulkAddNodes mutate $tree_data.data
  // in place, so once a root-subtree copy is pasted once, the still-live
  // copied_task/copied_tasks reference has *grown* to include that paste. A
  // second paste from the same clipboard entry (very natural right after
  // duplicating a whole project into more than one place) then clones the
  // already-grown tree, and each further paste roughly doubles the payload —
  // this is what turns "copy a project, paste it a couple of times" into a
  // save failure (huge, ever-growing write batch), not the paste failing on
  // structural grounds (parents/order are always recomputed correctly from
  // tree position, so a pasted root converts into an ordinary task cleanly).
  //
  // Fix: whenever we clone-for-insertion, also refresh the clipboard to a
  // second, independent clone taken from the same pre-mutation source. That
  // second clone is never attached to the live tree, so it can't alias future
  // mutations — repeated pastes from one copy stay O(1) per paste instead of
  // compounding. This is the single choke point for every paste trigger
  // (context-menu "paste as child", Ctrl+V, and bulk paste all call this
  // function), so fixing it here covers all of them.
  function handlePasteTask(event) {
    const { id } = event.detail;
    if (!id || !$tree_data?.data) return;
    if ($copied_tasks && $copied_tasks.length > 1) {
      const sources = $copied_tasks;
      const cloned = sources.map((n) => cloneWithNewIds(n));
      $copied_tasks = sources.map((n) => cloneWithNewIds(n));
      $copied_task = $copied_tasks[0] ?? null;
      const data = bulkAddNodes(cloned, id, $tree_data.data, "append");
      $tree_data = { ...$tree_data, data };
      closed_row_paths.expandNodeEverywhere(id);
      if (cloned[0]) focusNewNode(cloned[0].id);
      return;
    }
    const source = $copied_task ?? $copied_tasks?.[0] ?? null;
    if (!source) return;
    const cloned = cloneWithNewIds(source);
    $copied_task = cloneWithNewIds(source);
    $copied_tasks = [$copied_task];
    const data = addNode(cloned, id, $tree_data.data, "append");
    $tree_data = { ...$tree_data, data };
    closed_row_paths.expandNodeEverywhere(id);
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
    const data = bulkMoveUp(selectionSet, $tree_data.data, bulkParentPath);
    $tree_data = { ...$tree_data, data };
  }

  function handleBulkMoveDown() {
    if (!$tree_data?.data || !canSiblingMove) return;
    const data = bulkMoveDown(selectionSet, $tree_data.data, bulkParentPath);
    $tree_data = { ...$tree_data, data };
  }

  function handleBulkIndent() {
    if (!$tree_data?.data || !canTreeOp) return;
    const { tree_data: data, new_parent_ids } = bulkIndent(
      selectionSet,
      $tree_data.data,
      bulkParentPath
    );
    $tree_data = { ...$tree_data, data };
    for (const pid of new_parent_ids) {
      closed_row_paths.expandNodeEverywhere(pid);
    }
  }

  function handleBulkOutdent() {
    if (!$tree_data?.data || !canTreeOp || !canBulkOutdent) return;
    const data = bulkOutdent(selectionSet, $tree_data.data, bulkParentPath);
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
    // active 分はアーカイブ、archived 分は完全削除に自動振り分け（仕様）。
    const archiveIds = [];
    const permanentIds = [];
    for (const id of targetIds) {
      const n = getNode(id, $tree_data.data);
      if (!n) continue;
      if (isNodeEffectivelyArchived(id, $tree_data.data)) permanentIds.push(id);
      else archiveIds.push(id);
    }
    bulkArchiveTargetIds = archiveIds;
    bulkPermanentTargetIds = permanentIds;
    bulkDeleteCount = targetIds.length;
    bulkDeleteIsBulk = true;
    deleteTargetId = undefined;
    deleteTargetName = "";
    showDeleteConfirm = true;
  }

  function isEditingText() {
    return isTextEditingTarget(document.activeElement);
  }

  function shouldPrioritizeSelectedText(e) {
    if (!hasSelectedDocumentText()) return false;
    if (hasSelectedMemoText()) return true;
    return (
      (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C" || e.key === "a" || e.key === "A")
    );
  }

  function handleGlobalKeydown(e) {
    if (isEditingText() || isTextEditingTarget(e.target) || shouldPrioritizeSelectedText(e)) return;
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
      // bulk は自動振り分けに統一（active→archive、archived→完全削除）
      handleBulkDelete();
      return;
    }
    const node = getNode(id, $tree_data.data);
    if (!node || node.id === $tree_data.data.id) {
      return;
    }

    deleteMode = "archive";
    deleteTargetId = id;
    deleteTargetName = node.data.name;
    bulkDeleteIsBulk = false;
    bulkDeleteCount = 0;
    bulkArchiveTargetIds = [];
    bulkPermanentTargetIds = [];
    showDeleteConfirm = true;
  }

  function requestPermanentDelete(event) {
    const { id } = event.detail;
    if (isInMultiSelection(id)) {
      handleBulkDelete();
      return;
    }
    const node = getNode(id, $tree_data.data);
    if (!node || node.id === $tree_data.data.id) {
      return;
    }

    deleteMode = "permanent";
    deleteTargetId = id;
    deleteTargetName = node.data.name;
    bulkDeleteIsBulk = false;
    bulkDeleteCount = 0;
    bulkArchiveTargetIds = [];
    bulkPermanentTargetIds = [];
    showDeleteConfirm = true;
  }

  function requestRestore(event) {
    const { id } = event.detail;
    if (isInMultiSelection(id)) {
      if (!$tree_data?.data || selectionSize === 0) return;
      const rootId = $tree_data.data.id;
      const targets = new Set(Array.from(selectionSet).filter((tid) => tid !== rootId));
      if (targets.size === 0) return;
      const data = bulkRestoreNodes($tree_data.data, targets);
      $tree_data = { ...$tree_data, data };
      return;
    }
    const node = getNode(id, $tree_data.data);
    if (!node || node.id === $tree_data.data.id) return;
    $tree_data.data = restoreNode(id, $tree_data.data);
    $tree_data = { ...$tree_data, data: $tree_data.data };
  }

  function toggleDeleteConfirm() {
    showDeleteConfirm = !showDeleteConfirm;
    if (!showDeleteConfirm) {
      bulkDeleteIsBulk = false;
      bulkDeleteCount = 0;
      deleteMode = "archive";
      bulkArchiveTargetIds = [];
      bulkPermanentTargetIds = [];
    }
  }

  function confirmDelete() {
    if (bulkDeleteIsBulk) {
      if (!$tree_data?.data) return;
      let data = $tree_data.data;
      if (bulkArchiveTargetIds.length > 0) {
        data = bulkArchiveNodes(data, new Set(bulkArchiveTargetIds));
      }
      if (bulkPermanentTargetIds.length > 0) {
        // 削除で最後の親を失うノードを拾うため、消す前にノードを掴んでおく。
        const removedNodes = bulkPermanentTargetIds
          .map((id) => getNode(id, data))
          .filter((node) => node);
        const removed = bulkRemoveNodes(data, new Set(bulkPermanentTargetIds));
        if (removed) data = removed;
        reattachOrphans(data, removedNodes);
      }
      $tree_data = { ...$tree_data, data };
      clearSelection();
      bulkDeleteIsBulk = false;
      bulkDeleteCount = 0;
      deleteMode = "archive";
      bulkArchiveTargetIds = [];
      bulkPermanentTargetIds = [];
      return;
    }
    if (!deleteTargetId) {
      return;
    }
    if (deleteMode === "permanent") {
      const removedNode = getNode(deleteTargetId, $tree_data.data);
      const data = rmNode(deleteTargetId, $tree_data.data);
      // 消したノードの子が他に親を持たないなら、ルート直下へ付け直す（孤児を作らない）。
      if (removedNode) reattachOrphans(data, [removedNode]);
      $tree_data = { ...$tree_data, data };
    } else {
      const data = archiveNode(deleteTargetId, $tree_data.data);
      $tree_data = { ...$tree_data, data };
    }
    if ($table_selected_id === deleteTargetId) {
      clearSelection();
    }
    deleteTargetId = undefined;
    deleteTargetName = "";
    deleteMode = "archive";
  }

  $: deleteDialogHeader = (() => {
    if (bulkDeleteIsBulk) {
      if (bulkArchiveTargetIds.length > 0 && bulkPermanentTargetIds.length > 0) {
        return "アーカイブと完全削除の確認";
      }
      return bulkPermanentTargetIds.length > 0 ? "完全削除の確認" : "アーカイブの確認";
    }
    return deleteMode === "permanent" ? "完全削除の確認" : "アーカイブの確認";
  })();

  $: deleteDialogContent = (() => {
    if (bulkDeleteIsBulk) {
      const lines = [];
      if (bulkArchiveTargetIds.length > 0)
        lines.push(`${bulkArchiveTargetIds.length} 件をアーカイブ`);
      if (bulkPermanentTargetIds.length > 0)
        lines.push(`${bulkPermanentTargetIds.length} 件を完全削除`);
      const body = lines.join(" / ");
      if (bulkPermanentTargetIds.length > 0) {
        return `${body} します。\n完全削除分は取り消せません。`;
      }
      return `${body} します。\n後でアーカイブ表示から復元できます。`;
    }
    if (deleteMode === "permanent") {
      return `"${deleteTargetName}" を完全に削除しますか？\nこの操作は取り消せません。`;
    }
    return `"${deleteTargetName}" をアーカイブしますか？\n後でアーカイブ表示から復元できます。`;
  })();
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
        {#each stickyTrail as trailRow, index (trailRow.path)}
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
    <!-- key は経路。多親ノードは親ごとに複数行に出るので id では重複する。 -->
    {#each rows as row (row.path)}
      <TreeTableRow
        {row}
        isPrimaryOccurrence={row.isPrimaryOccurrence}
        headers={visibleHeaders}
        selected={$selected_ids.has(row.id)}
        bulkSelectionActive={$bulk_selection_active}
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
        inheritedDueDate={inheritedDueDateMap.get(row.path) ?? ""}
        nodePath={nodePathMap.get(row.path) ?? ""}
        lineNumber={lineNumberMap.get(row.path) ?? 0}
        isTabStop={row.path === tabStopRowPath}
        isEchoRow={row.id === activeRowId && row.path !== $active_row_path}
        on:select={handleSelectRow}
        on:navigate={handleRowNavigate}
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
        on:restoreTask={requestRestore}
        on:permanentDeleteTask={requestPermanentDelete}
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
  header={deleteDialogHeader}
  content={deleteDialogContent}
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
    /* Establish a stacking context so the absolutely-positioned column
       resizers (z-index: 10000) and the sticky header/trail are scoped to
       this subtree. Without it those high z-indexes compete globally and the
       resizer lines render ABOVE a Modal's body-level mask (z-index: 9999),
       making the column dividers show through an open modal. A low z-index
       keeps the whole tree below modals/overlays while preserving the
       internal ordering of header > resizer > rows. */
    z-index: 0;
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
