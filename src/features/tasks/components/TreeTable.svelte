<script>
  import { getContext } from "svelte";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  const application = getContext(TREEGRID_APPLICATION);
  const closed_row_paths = application?.closed ?? legacy_closed_row_paths;
  const tree_data = application?.tree ?? legacy_tree_data;
  const filtered_data = application?.filtered ?? legacy_filtered_data;

  import { onDestroy, onMount, tick } from "svelte";
  import TreeTableHeader from "@features/tasks/components/TreeTableHeader.svelte";
  import TreeTableRow from "@features/tasks/components/TreeTableRow.svelte";
  import BulkActionBar from "@features/tasks/components/BulkActionBar.svelte";
  import ArchiveScopeDialog from "@features/tasks/components/ArchiveScopeDialog.svelte";
  import Modal from "@lib/primitives/Modal.svelte";
  import Button from "@lib/primitives/Button.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import {
    tree_data as legacy_tree_data,
    selected_type,
    filtered_data as legacy_filtered_data,
    closed_row_paths as legacy_closed_row_paths,
    active_row_path,
    table_selected_id,
    theme,
    ui_density,
    column_settings,
    ganttScrollTop,
  } from "@stores";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { DEFAULT_COLUMN_SETTINGS } from "@features/tasks/stores/column_settings";
  import { readColumnWidths, saveColumnWidths } from "@features/tasks/stores/column_layout";
  import {
    buildRenderItems,
    nearestIndices,
    scrollTopToReveal,
    visibleRowRange,
  } from "@features/tasks/utils/virtual_rows";
  import { pageSearchCountIsPartial, pageSearchQuery } from "@features/search/stores/search";
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
  let headerComponent;
  /** ツールバーの「…」メニュー、またはクリックイベントから開かれる。 */
  export function openColumns(anchor) {
    headerComponent?.openPanel(anchor);
  }
  async function handleColumnWidth() {
    await tick();
    if (!table_root) return;
    unsetResizerEvents(resizers, handlers ?? []);
    resizers.forEach((r) => r.parentNode?.removeChild(r));
    const result = createResizers(visibleHeaders, [], true, resize_observer);
    resizers = result[0];
    resize_observer = result[3];
    handlers = setResizersEvents(resizers, result[1]);
  }

  // Resize
  let resizers = [],
    handlers,
    resize_observer;

  // 初回レイアウトの配分。Tree/Name が主役なので大きく取り、属性列は
  // 中身が読める幅にとどめる（保存済みの幅があればそちらが優先）。
  const BUILT_IN_HEADERS = [
    { name: "name", default_ratio: 16 },
    { name: "status", default_ratio: 3 },
    { name: "start date", default_ratio: 2.5 },
    { name: "due date", default_ratio: 2.5 },
    { name: "attachments", default_ratio: 1.2 },
    { name: "tags", default_ratio: 2 },
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
  /**
   * ノードごとの「置かれている場所」。同じノードが複数の親の下に出るのが
   * 普通なので、行だけを見ても別ノードなのか同じノードなのか分からない。
   * 行に共有の印を出すために、折り畳みや絞り込みとは関係ない**全体の木**から
   * 数える（畳んである側の出現も 1 か所として数えたい）。
   */
  function buildOccurrenceIndex(root) {
    const index = new Map();
    if (!root) return index;
    const stack = [root];
    const seenEdges = new Set();
    while (stack.length) {
      const node = stack.pop();
      for (const child of node.children ?? []) {
        const edge = `${node.id}>${child.id}`;
        if (seenEdges.has(edge)) continue;
        seenEdges.add(edge);
        const places = index.get(child.id) ?? [];
        places.push(node.data?.name ?? "");
        index.set(child.id, places);
        if (!child.cycleReference) stack.push(child);
      }
    }
    return index;
  }
  $: occurrenceIndex = buildOccurrenceIndex($tree_data?.data);
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

  // Memoize the id→row map against `rows` so scrolling (which only changes
  // scrollTop) does not rebuild it for every frame.
  // 祖先を辿るキーは経路。多親ノードは同じ id の行が複数あるので id では引けない。
  $: rowByPath = new Map(rows.map((row) => [row.path, row]));
  $: stickyTrail = buildStickyTrail(rows, scrollTop, rowHeightPx, rowByPath);

  // ---- 見えている行だけを描く（仮想スクロール） ----
  //
  // 全行を DOM にすると、ノードが数千あるワークスペースでは起動のたびに
  // 全行を作ってレイアウトし、変更のたびに全行を更新することになる。
  // 行の高さは `--tree-row-height` で固定なので、スクロール位置から描く範囲を
  // 割り算で出し、残りは同じ高さの空白で置き換える。
  const OVERSCAN_ROWS = 8;
  /** レイアウトが測れないとき（jsdom、畳まれたペイン）に全部描く上限。 */
  const FALLBACK_ALL_ROWS = 200;
  const FALLBACK_WINDOW_ROWS = 60;
  /**
   * ページ内検索の一致のうち、画面外でも描いておく行の上限。よくある語では
   * 全行が一致するので、全部描くと仮想化前と同じ重さになる。
   */
  const SEARCH_PIN_LIMIT = 100;

  let rowHeightProbe;
  let rowsTopMarker;
  /**
   * 1 行の高さ（px）。`--tree-row-height` は rem で書かれているので、
   * 変数の値を parseFloat しても px にはならない。実際に描いた要素で測る。
   */
  let rowHeightPx = 0;
  /** スクロール内容の先頭から最初の行までの距離（見出しの高さ）。 */
  let rowsOffset = 0;
  let viewportHeight = 0;

  function measureVirtualLayout() {
    if (!table_root) return;
    rowHeightPx = rowHeightProbe?.offsetHeight || 0;
    rowsOffset = rowsTopMarker?.offsetTop ?? 0;
    viewportHeight = table_root.clientHeight;
    scrollTop = table_root.scrollTop;
  }
  $: {
    // 密度とテーマで行の高さが変わる。見出しの高さは通知の有無で変わる。
    void $theme;
    void $ui_density;
    void taskFolderOpenError;
    tick().then(measureVirtualLayout);
  }

  $: rowIndexByPath = new Map(rows.map((row, index) => [row.path, index]));

  /**
   * ページ内検索（ヘッダーの検索ボックス）は描かれている文字を探す。
   * 画面外の行も見つけられるよう、名前かタグが一致する行を、表示位置に
   * 近いものから SEARCH_PIN_LIMIT 行まで描いておく。次の一致へ進んで
   * 表示位置が動けば、その周りの一致が描かれる。
   */
  function collectSearchMatchIndices(currentRows, query) {
    const needle = String(query ?? "").toLowerCase();
    if (!needle) return [];
    const indices = [];
    currentRows.forEach((row, index) => {
      const data = row.node?.data ?? {};
      const name = String(data.name ?? "").toLowerCase();
      const tags = Array.isArray(data.tags) ? data.tags.join(" ").toLowerCase() : "";
      if (name.includes(needle) || tags.includes(needle)) indices.push(index);
    });
    return indices;
  }
  $: searchMatchIndices = collectSearchMatchIndices(rows, $pageSearchQuery);

  /** ドラッグ中の行。消すと dragend が届かないので、画面外でも描いておく。 */
  let draggingRowPath;
  function handleTableDragStart(event) {
    draggingRowPath = event.target?.closest?.('[role="row"][data-row-path]')?.dataset.rowPath;
  }
  function handleTableDragEnd() {
    draggingRowPath = undefined;
  }

  $: rowRange = visibleRowRange({
    rowCount: rows.length,
    scrollTop,
    viewportHeight,
    rowHeight: rowHeightPx,
    rowsOffset,
    overscan: OVERSCAN_ROWS,
    fallbackAllRows: FALLBACK_ALL_ROWS,
    fallbackWindowRows: FALLBACK_WINDOW_ROWS,
  });
  $: pinnedSearchIndices = nearestIndices(
    searchMatchIndices,
    Math.floor((rowRange.start + rowRange.end) / 2),
    SEARCH_PIN_LIMIT
  );
  // 描いていない一致があれば、ヘッダーの件数に「+」を付けてもらう。
  $: pageSearchCountIsPartial.set(searchMatchIndices.length > pinnedSearchIndices.length);
  onDestroy(() => pageSearchCountIsPartial.set(false));
  // いま操作している行は、キーボード操作と Tab の停留点なので常に描く。
  $: pinnedRowIndices = [
    rowIndexByPath.get($active_row_path),
    rowIndexByPath.get(draggingRowPath),
    ...pinnedSearchIndices,
  ].filter((index) => index !== undefined);
  $: renderItems = buildRenderItems(rows.length, rowRange, pinnedRowIndices);

  /**
   * 出現アニメーションは本当に増えた行だけに流す。スクロールで描き始めた
   * 行にも流すと、スクロールのたびに行がちらつく。
   */
  let previousRowPaths = null;
  let enteringRowPaths = new Set();
  let enteringTimer;
  $: {
    const current = new Set(rows.map((row) => row.path));
    enteringRowPaths =
      previousRowPaths === null
        ? current
        : new Set([...current].filter((path) => !previousRowPaths.has(path)));
    previousRowPaths = current;
    clearTimeout(enteringTimer);
    if (enteringRowPaths.size > 0) {
      // アニメーション（0.16s）が終わってから外す。
      enteringTimer = setTimeout(() => (enteringRowPaths = new Set()), 250);
    }
  }

  /** 行が見える位置までスクロールする（見えていれば何もしない）。 */
  function revealRow(path) {
    const index = rowIndexByPath.get(path);
    if (index === undefined || !table_root) return;
    measureVirtualLayout();
    const next = scrollTopToReveal({
      index,
      scrollTop,
      viewportHeight,
      rowHeight: rowHeightPx,
      rowsOffset,
      // 経路表示が出ているときは、見出しの下の 1 行ぶんがそれに隠れる。
      // 出ていないときに余白を取ると、見出し直下の行をクリックしただけで
      // 1 行ずれる。
      topInset: stickyTrail.length > 0 ? rowHeightPx : 0,
    });
    if (next === null) return;
    table_root.scrollTop = next;
    scrollTop = table_root.scrollTop;
    $ganttScrollTop = scrollTop;
  }

  // 現在行が変わったら見える位置へ。追加・貼り付け・キー操作・戻る/進むなど、
  // どこから変わっても同じ。描かれていない行は DOM から探せないので、
  // スクロールで行を描かせるのはここに寄せる。
  let lastRevealedRowPath;
  $: if ($active_row_path !== lastRevealedRowPath) {
    lastRevealedRowPath = $active_row_path;
    const path = $active_row_path;
    if (path) tick().then(() => revealRow(path));
  }

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
  /**
   * 多親ノードをアーカイブするときの範囲選択。行は「ノードの辺」なので、
   * この行だけ片付けたいのか、ノードごと（＝全部の行）なのかを選ばせる。
   * 親がひとつしかないノードでは差が無いので出さない。
   */
  let archiveScopeTarget = null;
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
    // 基準の親も、いま操作している行の側で見る。
    const parent =
      getNodeByPath($tree_data.data, bulkParentPath) ?? getParent(anyId, $tree_data.data);
    if (!parent) return false;
    return !!(
      getNodeByPath($tree_data.data, parentPathOf(bulkParentPath ?? "")) ??
      getParent(parent.id, $tree_data.data)
    );
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
    measureVirtualLayout();
    const viewportObserver = new ResizeObserver(() => measureVirtualLayout());
    viewportObserver.observe(table_root);

    let domHeaders;
    [resizers, domHeaders, , resize_observer] = createResizers(visibleHeaders);
    handlers = setResizersEvents(resizers, domHeaders);

    let pendingBoundsFrame = 0;
    const scheduleResizerBoundsSync = () => {
      if (pendingBoundsFrame) return;
      pendingBoundsFrame = requestAnimationFrame(() => {
        pendingBoundsFrame = 0;
        syncResizerBounds(resizers);
      });
    };

    let mutation_observer = new MutationObserver((records) => {
      const headerRow = table_root.querySelector(".TableRow");
      const currentDomHeaders = Array.from(headerRow?.querySelectorAll(".TableHeader") ?? []);
      const currentDomHeaderCount = currentDomHeaders.length;
      const columnCountChanged = currentDomHeaderCount !== resizers.length + 1;

      let newDomHeaders;

      if (columnCountChanged && currentDomHeaderCount > 0) {
        // Column was added or removed — full reinit
        unsetResizerEvents(resizers, handlers);
        resizers.forEach((r) => r.parentNode?.removeChild(r));
        resizers = [];
        [resizers, newDomHeaders, , resize_observer] = createResizers(
          visibleHeaders,
          [],
          true,
          resize_observer
        );
        handlers = setResizersEvents(resizers, newDomHeaders);
        return;
      }

      // 行の追加・並び替え・行内の描き直しでは、変わった行にだけ幅を配る。
      // 以前はそのたびに全行の全セルへ幅を書き、レイアウトを読み直して
      // いたので、行数が多いと起動や移動のたびに全行のレイアウトが何度も
      // やり直しになっていた。
      const changedRows = new Set();
      let headerChanged = false;
      let rowsAddedOrRemoved = false;
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node.nodeType === 1 && (node.matches(".TableRow") || node.querySelector(".TableRow")))
            rowsAddedOrRemoved = true;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) {
            const row = record.target.closest?.(".TableRow");
            if (row) changedRows.add(row);
            continue;
          }
          if (node.matches(".TableHeader") || node.querySelector(".TableHeader"))
            headerChanged = true;
          const row = node.closest(".TableRow");
          if (row) changedRows.add(row);
          node.querySelectorAll(".TableRow").forEach((inner) => changedRows.add(inner));
          if (node.matches(".TableRow") || node.querySelector(".TableRow"))
            rowsAddedOrRemoved = true;
        }
      }
      // 見出し行の中の文字の変化（選択数など）では幅は変わらない。
      if (headerRow) changedRows.delete(headerRow);

      if (headerChanged) {
        // 見出しが描き直されたときは、これまでどおり全行に配り直す。
        [resizers, newDomHeaders] = createResizers(
          visibleHeaders,
          resizers,
          false,
          resize_observer
        );
        unsetResizerEvents(resizers, handlers);
        handlers = setResizersEvents(resizers, newDomHeaders);
        return;
      }

      if (changedRows.size) {
        const widths = currentDomHeaders.map(
          (header) => header.style.width || `${header.getBoundingClientRect().width}px`
        );
        changedRows.forEach((row) => applyWidthsToRow(row, widths));
      }
      if (rowsAddedOrRemoved) scheduleResizerBoundsSync();
    });
    mutation_observer.observe(table_root, { subtree: true, childList: true });

    return () => {
      viewportObserver.disconnect();
      clearTimeout(enteringTimer);
      if (pendingBoundsFrame) cancelAnimationFrame(pendingBoundsFrame);
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
    // 行は見えている分しか描かないので、数えずに行数から出す。
    cachedResizerContentHeight =
      rowHeightPx > 0 ? rowsOffset + rows.length * rowHeightPx : table_root.scrollHeight;
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

  /** 見出しの幅（`style.width` の文字列）を 1 行ぶんのセルに配る。 */
  const applyWidthsToRow = (row, widths) => {
    const cells = row.querySelectorAll(".TableData");
    widths.forEach((width, index) => {
      const cell = cells[index];
      if (cell && cell.style.width !== width) cell.style.width = width;
    });
  };

  const currentDataRows = () =>
    Array.from(table_root?.querySelectorAll(".TableRow") ?? [])
      .slice(1)
      .map((row) => row.querySelectorAll(".TableData"));

  const getLeadingColumnWidth = () =>
    table_root?.querySelector(".CheckboxHeaderCell")?.getBoundingClientRect().width ?? 0;

  // 幅を書き換えた直後にレイアウトを読むと、そのたびに全行のレイアウトが
  // やり直しになる。書く前に読んだ値を `leadingColumnWidth` で渡す。
  const positionResizers = (
    targetResizers,
    widths,
    leadingColumnWidth = getLeadingColumnWidth()
  ) => {
    let left = leadingColumnWidth;
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
        (table_root.clientWidth || tableRows[0].getBoundingClientRect().width) - leadingColumnWidth
      );
      const savedWidths = readColumnWidths();
      const minWidths = domHeaders.map(
        (header) => parseFloat(window.getComputedStyle(header).minWidth) || 0
      );
      const default_data_widths = currentHeaders.map((header, index) =>
        Math.max(
          minWidths[index] ?? 0,
          savedWidths[header.name] ??
            (default_root_width * header.default_ratio) / default_ratio_sum
        )
      );
      // 名前列は残りの幅を受け持つ（fitNameColumn と同じ式）。ここで先に
      // 合わせておけば、直後の ResizeObserver が全行の名前セルを書き換えずに
      // 済む。
      default_data_widths[0] = Math.max(
        minWidths[0] ?? 0,
        default_root_width - default_data_widths.slice(1).reduce((sum, width) => sum + width, 0)
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
      positionResizers(existingResizers, default_data_widths, leadingColumnWidth);
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
      // 縦スクロールバーぶんを含まない内側の幅。getBoundingClientRect() だと
      // バーの幅（9px 前後）まで列に配れてしまい、最終列がバーの下に潜る。
      const tableWidth = table_root.clientWidth || table_root.getBoundingClientRect().width;
      const leadingColumnWidth = getLeadingColumnWidth();
      const widths = domHeaders.map((h) => h.getBoundingClientRect().width);
      const fixedTotal = widths.slice(1).reduce((s, w) => s + w, 0);
      const nameMin = parseFloat(window.getComputedStyle(domHeaders[0]).minWidth) || 0;
      const nameWidth = Math.max(nameMin, tableWidth - leadingColumnWidth - fixedTotal);
      // 変わらないなら書かない。書くと全行のレイアウトがやり直しになる。
      if (Math.abs(nameWidth - widths[0]) < 0.5) return;

      domHeaders[0].style.width = `${nameWidth}px`;
      // 作った時点の行ではなく今の行へ。後から足された行も合わせる。
      currentDataRows().forEach((data_row) => {
        const cell = data_row[0];
        if (cell) cell.style.width = `${nameWidth}px`;
      });
      // Every resizer sits between two columns; since column 0 changed,
      // ALL resizer left positions shift by the delta.
      positionResizers(existingResizers, [nameWidth, ...widths.slice(1)], leadingColumnWidth);
    }

    const newResizeObserver = new ResizeObserver(() => {
      syncResizerBounds(existingResizers);
      fitNameColumn();
    });
    newResizeObserver.observe(table_root);

    return [existingResizers, domHeaders, data_rows, newResizeObserver];
  };

  const setResizersEvents = (resizers, headers) => {
    const handlers = [];
    // ドラッグを始めた時点の行。作った時点の行を覚えておくと、後から
    // 足された行に幅が届かない。
    let data_rows = [];

    const applyColumnWidths = (widths) => {
      const leadingColumnWidth = getLeadingColumnWidth();
      headers.forEach((columnHeader, index) => {
        columnHeader.style.width = `${widths[index]}px`;
        data_rows.forEach((data_row) => {
          data_row[index].style.width = `${widths[index]}px`;
        });
      });

      positionResizers(resizers, widths, leadingColumnWidth);
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
        data_rows = currentDataRows();

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
        saveColumnWidths(
          Object.fromEntries(
            headers.map((header, index) => [
              visibleHeaders[index].name,
              header.getBoundingClientRect().width,
            ])
          )
        );

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
    // ユーザの能動的なノード行選択は、ページ遷移と同等の navigation event として
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
   * ツリーを辿るには行内のコントロールを Tab で全部踏むしかなく、ノードが
   * 増えるほど現実的でなくなる。移動に必要な「表示中の行の並び」と親子関係は
   * ここ（rows）にしかないので、判定もここに置く。
   */
  /** 経路で行を引く。多親ノードは複数行に出るので、ノード id では足りない。 */
  async function focusRowByPath(path) {
    if (!path) return;
    // 画面外の行は描かれていないので、先にスクロールして描かせる。
    revealRow(path);
    await tick();
    const target = table_root?.querySelector(`[role="row"][data-row-path="${CSS.escape(path)}"]`);
    if (!target) return;
    target.focus({ preventScroll: true });
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
    if (application) return application.update(event.detail.id, event.detail.patch);
    const { id, patch } = event.detail;
    const data = updateNodeDataById($tree_data.data, id, patch);
    if (data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function canDropTarget(draggedId, targetId) {
    if (application) return draggedId !== targetId;
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

  let pendingDrop = null;
  let dropBusy = false;
  function handleReorder(event) {
    pendingDrop = { ...event.detail };
  }
  async function finishDrop(operation) {
    if (!pendingDrop || dropBusy) return;
    dropBusy = true;
    try {
      await performReorder({ detail: { ...pendingDrop, operation } });
      pendingDrop = null;
    } finally {
      dropBusy = false;
    }
  }
  function performReorder(event) {
    if (application) return application.reorder(event.detail);
    const { draggedIds, draggedPath, targetId, targetPath, mode } = event.detail;
    if (!draggedIds || draggedIds.length === 0) return;
    if (!$tree_data?.data) return;

    // Reject if any dragged id can't drop on target.
    if (!draggedIds.every((id) => canDropTarget(id, targetId))) {
      return;
    }

    if (event.detail.operation === "copy") {
      const sources = getTopLevelSelection($tree_data.data, new Set(draggedIds))
        .map((id) => getNode(id, $tree_data.data))
        .filter(Boolean);
      $tree_data = {
        ...$tree_data,
        data: bulkAddNodes(
          sources.map((node) => cloneWithNewIds(node)),
          targetId,
          $tree_data.data,
          mode,
          targetPath
        ),
      };
    } else if (draggedIds.length === 1) {
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

      // 単一行のドラッグと同じく、**掴んだ辺だけ**を外す。すべての辺を外すと
      // 多親ノードの親が黙って 1 つに減る。掴んだ行の親を基準にし、そこに
      // 無いノードだけ最初の辺を外す。
      const sourceParentPath = parentPathOf(draggedPath ?? "");
      let data = $tree_data.data;
      for (const id of topLevelIds) {
        const edgePath = sourceParentPath ? `${sourceParentPath}/${id}` : undefined;
        data = rmNode(id, data, getNodeByPath(data, edgePath) ? edgePath : undefined);
      }
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
    if (application)
      return application.move(
        "up",
        isInMultiSelection(event.detail.id) ? [...selectionSet] : [event.detail.id],
        rowFor(event.detail.id, event.detail.path)?.path
      );
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
    if (application)
      return application.move(
        "down",
        isInMultiSelection(event.detail.id) ? [...selectionSet] : [event.detail.id],
        rowFor(event.detail.id, event.detail.path)?.path
      );
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
    if (application)
      return application.move(
        "indent",
        isInMultiSelection(event.detail.id) ? [...selectionSet] : [event.detail.id],
        rowFor(event.detail.id, event.detail.path)?.path
      );
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
    // 経路が変わるので、畳んだ状態も一緒に移す。
    closed_row_paths.rekey(row.path, `${parentPathOf(row.path)}/${newParentId}/${id}`);
    $tree_data = { ...$tree_data, data };

    closed_row_paths.expandNodeEverywhere(newParentId);
  }

  function handleOutdentTask(event) {
    if (application)
      return application.move(
        "outdent",
        isInMultiSelection(event.detail.id) ? [...selectionSet] : [event.detail.id],
        rowFor(event.detail.id, event.detail.path)?.path
      );
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
    // 1 段上がるので、経路から親を 1 つ抜いたものが新しい経路。
    closed_row_paths.rekey(row.path, `${parentPathOf(parentPathOf(row.path))}/${id}`);
    $tree_data = { ...$tree_data, data };
  }

  /**
   * 追加したノードへ移動する。DOM の `id` は最初の出現にしか付かないので、
   * 経路が分かるならそれで引く（分からなければ従来どおり id で引く）。
   */
  function focusNewNode(newNodeId, newNodePath) {
    setTimeout(() => {
      selectOnly(newNodeId, newNodePath);
      if (newNodePath) $active_row_path = newNodePath;

      setTimeout(() => {
        // 画面外の行は描かれていないので、DOM ではなく行の並びから探す。
        const path = newNodePath ?? rows.find((row) => row.id === newNodeId)?.path;
        if (path) revealRow(path);
      }, 50);
    }, 0);
  }

  function handleAddRelative(targetId, action, targetPath) {
    if (application) return application.add(targetId, action, rowFor(targetId, targetPath)?.path);
    if (!targetId || !$tree_data?.data) {
      return;
    }

    const newNode = getDefaultNode();
    const addAction = targetId === $tree_data.data.id ? "append" : action;
    // 多親ノードは行ごとに親が違うので、隣に足すときの親は行の経路から引く。
    const rowPath = rowFor(targetId, targetPath)?.path;
    let parentId;

    if (addAction === "append") {
      parentId = targetId;
    } else {
      const parentNode =
        getNodeByPath($tree_data.data, parentPathOf(rowPath ?? "")) ??
        getParent(targetId, $tree_data.data);
      if (parentNode) {
        parentId = parentNode.id;
      }
    }

    const data = addNode(newNode, targetId, $tree_data.data, addAction, rowPath);
    $tree_data = { ...$tree_data, data };

    if (parentId) closed_row_paths.expandNodeEverywhere(parentId);

    // 新しい行の経路は「足した先の行の経路 + 新 id」。
    const newParentPath = addAction === "append" ? rowPath : parentPathOf(rowPath ?? "");
    focusNewNode(newNode.id, newParentPath ? `${newParentPath}/${newNode.id}` : undefined);
  }

  function handleAddBelow(event) {
    handleAddRelative(event.detail.id, "insert_after", event.detail.path);
  }

  function handleAddChild(event) {
    handleAddRelative(event.detail.id, "append", event.detail.path);
  }

  function handleCopyTask(event) {
    if (application)
      return application.copy(
        isInMultiSelection(event.detail.id) ? [...selectionSet] : [event.detail.id]
      );
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
    if (application) return application.paste(event.detail.id);
    const { id, path } = event.detail;
    if (!id || !$tree_data?.data) return;
    // 貼り付け先はクリックした行。多親ノードは行ごとに位置が違う。
    const pastePath = rowFor(id, path)?.path;
    if ($copied_tasks && $copied_tasks.length > 1) {
      const sources = $copied_tasks;
      const cloned = sources.map((n) => cloneWithNewIds(n));
      $copied_tasks = sources.map((n) => cloneWithNewIds(n));
      $copied_task = $copied_tasks[0] ?? null;
      const data = bulkAddNodes(cloned, id, $tree_data.data, "append", pastePath);
      $tree_data = { ...$tree_data, data };
      closed_row_paths.expandNodeEverywhere(id);
      if (cloned[0])
        focusNewNode(cloned[0].id, pastePath ? `${pastePath}/${cloned[0].id}` : undefined);
      return;
    }
    const source = $copied_task ?? $copied_tasks?.[0] ?? null;
    if (!source) return;
    const cloned = cloneWithNewIds(source);
    $copied_task = cloneWithNewIds(source);
    $copied_tasks = [$copied_task];
    const data = addNode(cloned, id, $tree_data.data, "append", pastePath);
    $tree_data = { ...$tree_data, data };
    closed_row_paths.expandNodeEverywhere(id);
    focusNewNode(cloned.id, pastePath ? `${pastePath}/${cloned.id}` : undefined);
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
    if (application) return application.updateMany({ status: event.detail.value });
    if (!$tree_data?.data || selectionSize === 0) return;
    const { value } = event.detail;
    const data = bulkUpdateNodeData($tree_data.data, selectionSet, { status: value });
    if (data && data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function handleBulkSetDate(event) {
    if (application) return application.updateMany({ [event.detail.key]: event.detail.value });
    if (!$tree_data?.data || selectionSize === 0) return;
    const { key, value } = event.detail;
    const data = bulkUpdateNodeData($tree_data.data, selectionSet, { [key]: value });
    if (data && data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function handleBulkClearDate(event) {
    if (application) return application.updateMany({ [event.detail.key]: undefined });
    if (!$tree_data?.data || selectionSize === 0) return;
    const { key } = event.detail;
    const data = bulkUpdateNodeData($tree_data.data, selectionSet, { [key]: undefined });
    if (data && data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function handleBulkMoveUp() {
    if (application) return application.move("up");
    if (!$tree_data?.data || !canSiblingMove) return;
    const data = bulkMoveUp(selectionSet, $tree_data.data, bulkParentPath);
    $tree_data = { ...$tree_data, data };
  }

  function handleBulkMoveDown() {
    if (application) return application.move("down");
    if (!$tree_data?.data || !canSiblingMove) return;
    const data = bulkMoveDown(selectionSet, $tree_data.data, bulkParentPath);
    $tree_data = { ...$tree_data, data };
  }

  function handleBulkIndent() {
    if (application) return application.move("indent");
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
    if (application) return application.move("outdent");
    if (!$tree_data?.data || !canTreeOp || !canBulkOutdent) return;
    const data = bulkOutdent(selectionSet, $tree_data.data, bulkParentPath);
    $tree_data = { ...$tree_data, data };
  }

  function handleBulkDuplicate() {
    if (application) return application.copy();
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
      if (application) return application.copy();
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
    const { id, path } = event.detail;
    if (application && !isInMultiSelection(id)) {
      const occurrencePath = path ?? $active_row_path;
      const state = application.archiveStateOf(id, occurrencePath);
      if (state.shared && !state.node && !state.edge) {
        const node = $tree_data?.data ? getNode(id, $tree_data.data) : null;
        archiveScopeTarget = {
          id,
          path: occurrencePath,
          name: node?.data?.name ?? "",
          places: state.places,
        };
        return;
      }
    }
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
    if (application) {
      const { id, path } = event.detail;
      if (!isInMultiSelection(id)) {
        // 辺だけのアーカイブと、ノードごとのアーカイブは画面では同じに見える。
        // 立っている方を外す（両方立っていれば両方）。
        return application.restoreOccurrence(id, path ?? $active_row_path);
      }
      return application.archive([...selectionSet], false);
    }
    const { id, path } = event.detail;
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
    // 復元はクリックした行の祖先だけを解除する（多親ノードで別の親側を
    // 巻き添えにしない）。
    $tree_data.data = restoreNode(id, $tree_data.data, rowFor(id, path)?.path);
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
    if (application) {
      const archives = bulkDeleteIsBulk
        ? bulkArchiveTargetIds
        : deleteMode === "archive"
          ? [deleteTargetId]
          : [];
      const removes = bulkDeleteIsBulk
        ? bulkPermanentTargetIds
        : deleteMode === "permanent"
          ? [deleteTargetId]
          : [];
      void application.dispatch([
        ...archives.map((nodeId) => ({ type: "update-node", nodeId, changes: { archived: true } })),
        ...removes.map((nodeId) => ({ type: "delete-node", nodeId })),
      ]);
      clearSelection();
      return;
    }
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

  $: deleteDialogOk = (() => {
    if (bulkDeleteIsBulk) {
      if (bulkPermanentTargetIds.length > 0 && bulkArchiveTargetIds.length > 0) return "実行する";
      return bulkPermanentTargetIds.length > 0 ? "完全に削除" : "アーカイブする";
    }
    return deleteMode === "permanent" ? "完全に削除" : "アーカイブする";
  })();

  $: deleteDialogDanger = bulkDeleteIsBulk
    ? bulkPermanentTargetIds.length > 0
    : deleteMode === "permanent";

  $: deleteDialogContent = (() => {
    if (bulkDeleteIsBulk) {
      const lines = [];
      if (bulkArchiveTargetIds.length > 0)
        lines.push(`${bulkArchiveTargetIds.length} 件をアーカイブ`);
      if (bulkPermanentTargetIds.length > 0)
        lines.push(`${bulkPermanentTargetIds.length} 件を完全削除`);
      const body = lines.join(" / ");
      if (bulkPermanentTargetIds.length > 0) {
        return `${body} します。\n${application ? "Workspaceの履歴に残っている間は「元に戻す」で復元できます。" : "完全削除分は取り消せません。"}`;
      }
      return `${body} します。\n後でアーカイブ表示から復元できます。`;
    }
    if (deleteMode === "permanent") {
      return `"${deleteTargetName}" を完全に削除しますか？\n${application ? "Workspaceの履歴に残っている間は「元に戻す」で復元できます。" : "この操作は取り消せません。"}`;
    }
    return `"${deleteTargetName}" をアーカイブしますか？\n後でアーカイブ表示から復元できます。`;
  })();
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<div
  bind:this={table_root}
  class:TableRoot={true}
  role="treegrid"
  aria-label="ノードツリー"
  aria-multiselectable="true"
  aria-rowcount={rows.length + 1}
  tabindex="-1"
  on:scroll={handleScroll}
  on:dragstart={handleTableDragStart}
  on:dragend={handleTableDragEnd}
  on:click|self={handleBackgroundClick}
  on:keydown|self={(e) => {
    if (e.key === "Escape") handleBackgroundClick();
  }}
>
  {#if taskFolderOpenError}
    <div class="TaskFolderOpenError" role="alert">{taskFolderOpenError}</div>
  {/if}
  <TreeTableHeader
    bind:this={headerComponent}
    on:columnWidth={handleColumnWidth}
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
  <div class="RowHeightProbe" aria-hidden="true" bind:this={rowHeightProbe}></div>
  <div class="RowsTop" aria-hidden="true" bind:this={rowsTopMarker}></div>
  {#if rows.length > 0}
    <!-- key は経路。多親ノードは親ごとに複数行に出るので id では重複する。
         描かない行は、同じ高さの空白（RowGap）で置き換える。 -->
    {#each renderItems as item (item.kind === "row" ? rows[item.index].path : `gap:${item.start}`)}
      {#if item.kind === "gap"}
        <div
          class="RowGap"
          aria-hidden="true"
          style:height={`calc(var(--tree-row-height, 36px) * ${item.count})`}
        ></div>
      {:else}
        {@const row = rows[item.index]}
        <TreeTableRow
          {row}
          animateEnter={enteringRowPaths.has(row.path)}
          ariaRowIndex={item.index + 2}
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
          canOpenTaskFolder={!application &&
            $selected_type === "WorkspaceProject" &&
            Boolean($workspace_store.activeProjectDir)}
          bulkCanMove={canSiblingMove}
          bulkCanTreeOp={canTreeOp}
          bulkCanOutdent={canBulkOutdent}
          inheritedDueDate={inheritedDueDateMap.get(row.path) ?? ""}
          nodePath={nodePathMap.get(row.path) ?? ""}
          sharedPlaces={occurrenceIndex.get(row.id) ?? []}
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
      {/if}
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
        <p class="EmptyTitle">ノードがありません</p>
        <p class="EmptyHint">ヘッダーの + ボタンか、右クリックメニューからノードを追加できます</p>
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
        <p class="EmptyTitle">一致するノードがありません</p>
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
  ok={deleteDialogOk}
  danger={deleteDialogDanger}
  callback={confirmDelete}
/>

<Modal
  show={Boolean(pendingDrop)}
  toggle={() => {
    if (!dropBusy) pendingDrop = null;
  }}
  width="21rem"
  height="auto"
  label="ドロップ操作を選択"
>
  <div class="DropChoice">
    <h2>ドロップ操作</h2>
    <p>選択した {pendingDrop?.draggedIds.length ?? 0} 件をどう配置しますか？</p>
    <div class="DropActions">
      <Button
        content="キャンセル"
        variant="text"
        disabled={dropBusy}
        on:click={() => (pendingDrop = null)}
      />
      <Button
        content="子孫もコピー"
        variant="outlined"
        disabled={dropBusy}
        on:click={() => finishDrop("copy")}
      />
      <Button content="移動" disabled={dropBusy} on:click={() => finishDrop("move")} />
    </div>
  </div>
</Modal>
<ArchiveScopeDialog
  target={archiveScopeTarget}
  on:cancel={() => (archiveScopeTarget = null)}
  on:edge={() => {
    const target = archiveScopeTarget;
    archiveScopeTarget = null;
    void application.archiveEdge(target.id, target.path, true);
    clearSelection();
  }}
  on:node={() => {
    const target = archiveScopeTarget;
    archiveScopeTarget = null;
    void application.archive([target.id], true);
    clearSelection();
  }}
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
  .DropChoice {
    padding: var(--sp4);
    color: var(--fg-default);
    background: var(--canvas-default);
  }
  .DropChoice h2 {
    margin: 0;
    font-size: var(--font-title-md);
  }
  .DropActions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp2);
    justify-content: flex-end;
  }
  .TableRoot {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    /* 列の最小幅は各セルが持っていて、はみ出した分はこの要素が横スクロール
       する。ここに「列数 × 3rem」の下限を置くと、ガント表示などでペインが
       狭いときにペイン（overflow:hidden）からはみ出して右端が切れる。 */
    min-width: 0;
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
  .RowHeightProbe {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: var(--tree-row-height, 36px);
    visibility: hidden;
    pointer-events: none;
  }
  .RowsTop,
  .RowGap {
    /* 縦並びの flex なので、既定では中身の無い空白が縮められてしまう。 */
    flex-shrink: 0;
  }
  .StickyTrail {
    /* Pinned breadcrumb sits flush under the 2.25rem tree header. No margin,
       no rounded corners, no shadow — it's a regular tree row that just
       happens to follow the scroll. */
    position: sticky;
    top: 2.25rem;
    z-index: 9998;
    height: 0;
    overflow: visible;
    pointer-events: none;
  }
  .StickyTrailContent {
    height: var(--tree-row-height, 36px);
    min-height: var(--tree-row-height, 36px);
    max-height: var(--tree-row-height, 36px);
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
    max-width: min(21rem, calc(100% - var(--sp4)));
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
    padding: 3rem var(--sp7);
    color: var(--theme-color-Sub-dark);
    user-select: none;
  }
  .EmptyIcon {
    width: 2.25rem;
    height: 2.25rem;
    opacity: 0.35;
    stroke: var(--theme-color-Sub-dark);
  }
  .EmptyTitle {
    margin: 0;
    font-size: 0.75rem;
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
