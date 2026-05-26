<script>
  import Pane from "@lib/layouts/Pane.svelte";
  import SplitPanes from "@lib/layouts/SplitPanes.svelte";
  import TreeTable from "@features/tasks/components/TreeTable.svelte";
  import GanttPanel from "@features/gantt/components/GanttPanel.svelte";
  import TaskDetail from "@features/tasks/components/TaskDetail.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import Card from "@lib/primitives/Card.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import Modal from "@lib/primitives/Modal.svelte";
  import SearchBox from "@lib/primitives/SearchBox.svelte";
  import Loading from "@lib/primitives/Loading.svelte";
  import ActiveFilterBar from "@features/search/components/ActiveFilterBar.svelte";
  import { tick } from "svelte";
  import {
    table_selected_id,
    tree_data,
    closed_node_ids,
    ganttVisible,
    selected_type,
  } from "@stores";
  import { convertMemoContent, normalizeMemoFormat } from "@features/memos/utils/memo_utils";
  import {
    getNode,
    addNode,
    rmNode,
    getParent,
    moveNodeUp,
    moveNodeDown,
    indentNode,
    outdentNode,
    bulkRemoveNodes,
    bulkMoveUp,
    bulkMoveDown,
    bulkIndent,
    bulkOutdent,
    areAllSiblings,
    isContiguousSiblingBlock,
  } from "@features/tasks/utils/tree_control";
  import { getDefaultNode } from "@features/tasks/utils/tree_control";
  import { undoHistory, redoHistory } from "@features/tasks/stores/tree";
  import { selected_ids, clearSelection, selectOnly } from "@stores/ui";

  // ページ内検索はstoresから共有

  // Dialog
  let show_confirm = false;
  const toggle_confirm = () => {
    show_confirm = !show_confirm;
    if (!show_confirm) {
      is_bulk_confirm = false;
      bulk_confirm_count = 0;
    }
  };
  let name_confirm = "";
  let is_bulk_confirm = false;
  let bulk_confirm_count = 0;
  const callback_confirm = () => {
    if (is_bulk_confirm) {
      if (!$tree_data?.data) return;
      const rootId = $tree_data.data.id;
      const targets = new Set(Array.from($selected_ids).filter((id) => id !== rootId));
      if (targets.size === 0) return;
      const data = bulkRemoveNodes($tree_data.data, targets);
      if (data && data !== $tree_data.data) {
        $tree_data = { ...$tree_data, data };
      }
      clearSelection();
      is_bulk_confirm = false;
      bulk_confirm_count = 0;
      return;
    }
    $tree_data.data = rmNode($table_selected_id, $tree_data.data);
    clearSelection();
  };

  // Reactive bulk-capability flags for the toolbar buttons.
  $: selectionSize = $selected_ids.size;
  $: isMultiSelect = selectionSize > 1;
  $: canMultiSiblingMove =
    isMultiSelect && isContiguousSiblingBlock($tree_data?.data, $selected_ids);
  $: canMultiTreeOp = isMultiSelect && areAllSiblings($tree_data?.data, $selected_ids);
  $: canMultiOutdent = (() => {
    if (!canMultiTreeOp || !$tree_data?.data) return false;
    const anyId = $selected_ids.values().next().value;
    if (!anyId) return false;
    const parent = getParent(anyId, $tree_data.data);
    if (!parent) return false;
    return !!getParent(parent.id, $tree_data.data);
  })();

  let show_alert = false;
  let alert_content = "Cannot delete the root node.";
  const toggle_alert = () => {
    show_alert = !show_alert;
  };

  let detailPaneVisible = true;
  let show_memo_format_confirm = false;
  let bulkMemoTargetFormat = "markdown";
  let bulkMemoPhase = "ready";
  let bulkMemoItems = [];

  $: defaultMemoFormat = $selected_type === "WorkspaceProject" ? "markdown" : "quill";
  $: projectName = $tree_data?.data?.data?.name || "Task Tree";
  $: projectStorageLabel = $selected_type === "WorkspaceProject" ? "Workspace" : "InApp";
  $: bulkMemoTargetLabel = getMemoFormatLabel(bulkMemoTargetFormat);
  $: successfulBulkMemoItems = bulkMemoItems.filter((item) => item.status === "ok");
  $: failedBulkMemoItems = bulkMemoItems.filter((item) => item.status === "error");

  function getMemoFormatLabel(format) {
    return format === "markdown" ? "Markdown" : "Quill";
  }

  function getBulkMemoId(node, entry, index) {
    return `${node.id}:${entry.id ?? "memo"}:${index}`;
  }

  function collectProjectMemosForFormat(node, targetFormat, fallbackFormat) {
    if (!node) return [];

    const ownItems = (node.data.memo ?? []).flatMap((entry, index) => {
      const currentFormat = normalizeMemoFormat(entry.format, fallbackFormat);
      if (currentFormat === targetFormat) {
        return [];
      }
      return [
        {
          id: getBulkMemoId(node, entry, index),
          taskId: node.id,
          taskName: node.data?.name || "Untitled task",
          memoTitle: entry.title || `memo ${index + 1}`,
          fromFormat: currentFormat,
          toFormat: targetFormat,
          status: "pending",
          error: "",
        },
      ];
    });

    return ownItems.concat(
      (node.children ?? []).flatMap((child) =>
        collectProjectMemosForFormat(child, targetFormat, fallbackFormat)
      )
    );
  }

  function countProjectMemosForFormat(node, targetFormat, fallbackFormat) {
    if (!node) return 0;
    const ownCount = (node.data.memo ?? []).filter(
      (memo) => normalizeMemoFormat(memo.format, fallbackFormat) !== targetFormat
    ).length;
    return (
      ownCount +
      (node.children ?? []).reduce(
        (total, child) => total + countProjectMemosForFormat(child, targetFormat, fallbackFormat),
        0
      )
    );
  }

  function convertNodeMemosToFormatWithResults(node, targetFormat, fallbackFormat, resultMap) {
    const memo = (node.data.memo ?? []).map((entry, index) => {
      const currentFormat = normalizeMemoFormat(entry.format, fallbackFormat);
      if (currentFormat === targetFormat) {
        return { ...entry, format: currentFormat };
      }

      const result = resultMap.get(getBulkMemoId(node, entry, index));
      try {
        const content = convertMemoContent(entry.content, currentFormat, targetFormat);
        if (result) {
          result.status = "ok";
        }
        return {
          ...entry,
          format: targetFormat,
          content,
        };
      } catch (error) {
        if (result) {
          result.status = "error";
          result.error = error instanceof Error ? error.message : String(error);
        }
        return { ...entry, format: currentFormat };
      }
    });

    return {
      ...node,
      data: {
        ...node.data,
        memo,
      },
      children: (node.children ?? []).map((child) =>
        convertNodeMemosToFormatWithResults(child, targetFormat, fallbackFormat, resultMap)
      ),
    };
  }

  function requestBulkMemoFormat(targetFormat) {
    bulkMemoTargetFormat = targetFormat;
    bulkMemoItems = collectProjectMemosForFormat($tree_data?.data, targetFormat, defaultMemoFormat);
    bulkMemoPhase = "ready";
    show_memo_format_confirm = true;
  }

  function closeBulkMemoFormatConfirm() {
    show_memo_format_confirm = false;
    bulkMemoPhase = "ready";
    bulkMemoItems = [];
  }

  function applyBulkMemoFormat() {
    if (!$tree_data?.data) return;
    bulkMemoPhase = "running";
    const results = bulkMemoItems.map((item) => ({ ...item, status: "pending", error: "" }));
    const resultMap = new Map(results.map((item) => [item.id, item]));
    $tree_data = {
      ...$tree_data,
      data: convertNodeMemosToFormatWithResults(
        $tree_data.data,
        bulkMemoTargetFormat,
        defaultMemoFormat,
        resultMap
      ),
    };
    results.forEach((item) => {
      if (item.status === "pending") {
        item.status = "error";
        item.error = "Target memo was not found.";
      }
    });
    bulkMemoItems = results;
    bulkMemoPhase = "done";
  }

  // Add
  export async function handleAdd(e, action) {
    e.stopPropagation();

    if (!$tree_data?.data) {
      return;
    }

    const new_node = getDefaultNode();
    const rootId = $tree_data.data.id;
    // Inserting a sibling next to the EXPLICITLY-selected project root is
    // meaningless: the root has no parent to receive the new node. Surface
    // that as an error rather than silently re-routing the add to "append
    // as child", which used to confuse users into thinking the wrong button
    // worked. (If nothing is selected, we still fall through to the friendly
    // "append under root" behaviour so a single-click on an empty tree
    // creates the first task.)
    if ($table_selected_id === rootId && action === "insert_after") {
      alert_content =
        "Cannot insert a sibling at the project root.\nSelect a task, or use 子タスク追加 to add a child here.";
      show_alert = true;
      return;
    }
    const selectedId = $table_selected_id ?? rootId;
    const addAction = selectedId === rootId ? "append" : action;

    if (selectedId) {
      // 親ノードのIDを特定
      let parentId;
      if (addAction === "append") {
        // appendの場合は選択されているノードが親
        parentId = selectedId;
      } else {
        // insert_afterの場合は選択されているノードの親
        const parentNode = getParent(selectedId, $tree_data.data);
        if (parentNode) {
          parentId = parentNode.id;
        }
      }

      // ノードを追加
      $tree_data.data = addNode(new_node, selectedId, $tree_data.data, addAction);

      // 親ノードが折りたたまれている場合は展開する
      if (parentId && $closed_node_ids.has(parentId)) {
        closed_node_ids.delete(parentId);
      }

      // 新しいノードを選択状態にしてDOMの更新を待つ
      selectOnly(new_node.id);
      await tick();

      const newRow = document.getElementById(new_node.id);
      if (newRow) {
        newRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  // Remove — routes to bulk delete when multiple rows are selected.
  export function handleRemove(e) {
    e.stopPropagation();
    if (!$tree_data?.data) return;
    if (isMultiSelect) {
      const rootId = $tree_data.data.id;
      const targets = Array.from($selected_ids).filter((id) => id !== rootId);
      if (targets.length === 0) {
        alert_content = "Cannot delete the root node.";
        show_alert = true;
        return;
      }
      is_bulk_confirm = true;
      bulk_confirm_count = targets.length;
      name_confirm = "";
      show_confirm = true;
      return;
    }
    if ($table_selected_id) {
      const node = getNode($table_selected_id, $tree_data.data);
      if (node && node.id == $tree_data.data.id) {
        alert_content = "Cannot delete the root node.";
        show_alert = true;
        return;
      }
      if (node) {
        is_bulk_confirm = false;
        bulk_confirm_count = 0;
        show_confirm = true;
        name_confirm = node.data.name;
      }
    }
  }

  // Move / indent helpers — tree_control functions mutate the tree in-place
  // and return the SAME reference, so we must force Svelte reactivity by
  // reassigning the store with a shallow-cloned wrapper.
  function withSelectedNode(updater) {
    if (!$table_selected_id || !$tree_data?.data) return;
    const target = $table_selected_id;
    updater(target, $tree_data.data);
    $tree_data = { ...$tree_data, data: $tree_data.data };
  }
  // Bulk dispatcher for the move/indent/outdent toolbar buttons.
  // When multiple rows are selected, route to the bulk helper; otherwise
  // fall back to the single-row helper acting on $table_selected_id.
  function runBulkOrSingle({ bulk, single, gate }) {
    if (!$tree_data?.data) return;
    if (isMultiSelect) {
      if (gate && !gate()) return;
      bulk($selected_ids, $tree_data.data);
      $tree_data = { ...$tree_data, data: $tree_data.data };
      return;
    }
    withSelectedNode(single);
  }
  const handleMoveUp = (e) => {
    e?.stopPropagation?.();
    runBulkOrSingle({
      bulk: bulkMoveUp,
      single: moveNodeUp,
      gate: () => canMultiSiblingMove,
    });
  };
  const handleMoveDown = (e) => {
    e?.stopPropagation?.();
    runBulkOrSingle({
      bulk: bulkMoveDown,
      single: moveNodeDown,
      gate: () => canMultiSiblingMove,
    });
  };
  const handleIndent = (e) => {
    e?.stopPropagation?.();
    if (isMultiSelect) {
      if (!canMultiTreeOp || !$tree_data?.data) return;
      const { new_parent_ids } = bulkIndent($selected_ids, $tree_data.data);
      $tree_data = { ...$tree_data, data: $tree_data.data };
      for (const pid of new_parent_ids) {
        if ($closed_node_ids.has(pid)) closed_node_ids.delete(pid);
      }
      return;
    }
    withSelectedNode(indentNode);
  };
  const handleOutdent = (e) => {
    e?.stopPropagation?.();
    runBulkOrSingle({
      bulk: bulkOutdent,
      single: outdentNode,
      gate: () => canMultiTreeOp && canMultiOutdent,
    });
  };
  const handleExpandAll = () => closed_node_ids.expandAll();
  const handleCollapseAll = () => closed_node_ids.collapseAll();
</script>

{#if $tree_data}
  <div class:Content={true}>
    <SplitPanes defaultRatio={detailPaneVisible ? [3, 2] : [1]}>
      <Pane style={"min-width: 10rem;"}>
        <Card title={projectName} padded={false} style={"height: 100%; width: 100%;"}>
          <span slot="header-actions" class="storage-badge">{projectStorageLabel}</span>
          <div class="TaskListToolbar">
            <!-- Group 1: Add / Delete -->
            <div class="TbGroup">
              <IconButton
                tooltipContent="タスク追加"
                ariaLabel="タスク追加"
                activeColor={"var(--theme-color-Primary-dark)"}
                normalColor={"var(--theme-color-Primary-main)"}
                on:click={(e) => handleAdd(e, "insert_after")}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
                  ><path
                    d="M12 5V19M5 12H19"
                    stroke="var(--theme-color-Main-main)"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  ></path></svg
                >
              </IconButton>
              <IconButton
                tooltipContent="子タスク追加"
                ariaLabel="子タスク追加"
                variant="outlined"
                activeColor={"var(--theme-color-Primary-main)"}
                normalColor={"var(--theme-color-Primary-main)"}
                on:click={(e) => handleAdd(e, "append")}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M5 4V12C5 13.1 5.9 14 7 14H14"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                  <path
                    d="M11 11L14 14L11 17"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M18 14V18M16 16H20"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent={isMultiSelect ? `${selectionSize}件削除` : "削除"}
                ariaLabel={isMultiSelect ? `${selectionSize}件削除` : "削除"}
                variant="text"
                activeColor={"var(--theme-color-Error-main)"}
                normalColor={"var(--theme-color-Error-main)"}
                on:click={(e) => handleRemove(e)}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M3 6H21M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M10 11V17M14 11V17M5 6L6 20C6 20.6 6.4 21 7 21H17C17.6 21 18 20.6 18 20L19 6"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
            <span class="TbSep" aria-hidden="true"></span>

            <!-- Group 2: Move / Indent -->
            <div class="TbGroup">
              <IconButton
                tooltipContent={isMultiSelect
                  ? canMultiSiblingMove
                    ? `${selectionSize}件 上に移動`
                    : "同じ親の連続した兄弟のみ移動できます"
                  : "上に移動 (Alt+↑)"}
                ariaLabel={isMultiSelect ? `${selectionSize}件 上に移動` : "上に移動"}
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                disabled={isMultiSelect && !canMultiSiblingMove}
                on:click={handleMoveUp}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 19V5M5 12L12 5L19 12"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent={isMultiSelect
                  ? canMultiSiblingMove
                    ? `${selectionSize}件 下に移動`
                    : "同じ親の連続した兄弟のみ移動できます"
                  : "下に移動 (Alt+↓)"}
                ariaLabel={isMultiSelect ? `${selectionSize}件 下に移動` : "下に移動"}
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                disabled={isMultiSelect && !canMultiSiblingMove}
                on:click={handleMoveDown}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 5V19M5 12L12 19L19 12"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent={isMultiSelect
                  ? canMultiTreeOp && canMultiOutdent
                    ? `${selectionSize}件 アウトデント`
                    : canMultiTreeOp
                      ? "これ以上アウトデントできません"
                      : "同じ親の兄弟のみアウトデントできます"
                  : "アウトデント (Shift+Tab)"}
                ariaLabel={isMultiSelect ? `${selectionSize}件 アウトデント` : "アウトデント"}
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                disabled={isMultiSelect && (!canMultiTreeOp || !canMultiOutdent)}
                on:click={handleOutdent}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M21 4H10M21 12H10M21 20H10M7 8L3 12L7 16"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent={isMultiSelect
                  ? canMultiTreeOp
                    ? `${selectionSize}件 インデント`
                    : "同じ親の兄弟のみインデントできます"
                  : "インデント (Tab)"}
                ariaLabel={isMultiSelect ? `${selectionSize}件 インデント` : "インデント"}
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                disabled={isMultiSelect && !canMultiTreeOp}
                on:click={handleIndent}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M3 4H14M3 12H14M3 20H14M17 8L21 12L17 16"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
            <span class="TbSep" aria-hidden="true"></span>

            <!-- Group 3: Expand / Collapse -->
            <div class="TbGroup">
              <IconButton
                tooltipContent="すべて展開"
                ariaLabel="すべて展開"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={handleExpandAll}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M8 10L12 6L16 10M8 14L12 18L16 14"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="すべて折りたたみ"
                ariaLabel="すべて折りたたみ"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={handleCollapseAll}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M8 6L12 10L16 6M8 18L12 14L16 18"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
            <span class="TbSep" aria-hidden="true"></span>

            <!-- Group 4: Undo / Redo -->
            <div class="TbGroup">
              <IconButton
                tooltipContent="元に戻す (Ctrl+Z)"
                ariaLabel="元に戻す"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={undoHistory}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M3 7L7 3M3 7L7 11M3 7H15C18.3 7 21 9.7 21 13C21 16.3 18.3 19 15 19H9"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="やり直し (Ctrl+Y)"
                ariaLabel="やり直し"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={redoHistory}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M21 7L17 3M21 7L17 11M21 7H9C5.7 7 3 9.7 3 13C3 16.3 5.7 19 9 19H15"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
            <span class="TbSep" aria-hidden="true"></span>

            <!-- Group 5: Bulk memo format conversion -->
            <div class="TbGroup">
              <IconButton
                tooltipContent="全メモをMarkdownへ変換"
                ariaLabel="全メモをMarkdownへ変換"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                disabled={countProjectMemosForFormat(
                  $tree_data?.data,
                  "markdown",
                  defaultMemoFormat
                ) === 0}
                on:click={() => requestBulkMemoFormat("markdown")}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M4 17V7L8 13L12 7V17M17 7V15M14 12L17 15L20 12"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="全メモをQuillへ変換"
                ariaLabel="全メモをQuillへ変換"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                disabled={countProjectMemosForFormat(
                  $tree_data?.data,
                  "quill",
                  defaultMemoFormat
                ) === 0}
                on:click={() => requestBulkMemoFormat("quill")}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 4C7.6 4 4 7.2 4 11.5S7.6 19 12 19H16M12 8C9.8 8 8 9.6 8 11.5S9.8 15 12 15H14.5L17.5 19"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>

            <!-- Tree filter search (filters rows by name) -->
            <div class="TbSearch">
              <SearchBox />
            </div>

            <!-- Group 5: View toggles -->
            <div class="TbGroup">
              <IconButton
                tooltipContent={$ganttVisible ? "ガントチャートを閉じる" : "ガントチャートを表示"}
                ariaLabel="ガントチャートの表示切替"
                variant="text"
                normalColor={$ganttVisible
                  ? "var(--theme-color-Primary-main)"
                  : "var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={() => ($ganttVisible = !$ganttVisible)}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="4" width="4" height="3" rx="0.5" fill="currentColor" />
                  <rect x="3" y="10.5" width="7" height="3" rx="0.5" fill="currentColor" />
                  <rect x="3" y="17" width="5" height="3" rx="0.5" fill="currentColor" />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent={detailPaneVisible ? "Hide detail pane" : "Show detail pane"}
                ariaLabel={detailPaneVisible ? "Hide detail pane" : "Show detail pane"}
                variant="text"
                normalColor={detailPaneVisible
                  ? "var(--theme-color-Primary-main)"
                  : "var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={() => (detailPaneVisible = !detailPaneVisible)}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect
                    x="3"
                    y="4"
                    width="18"
                    height="16"
                    rx="2"
                    stroke="currentColor"
                    stroke-width="1.8"
                  />
                  <path d="M15 4V20" stroke="currentColor" stroke-width="1.8" />
                </svg>
              </IconButton>
            </div>
          </div>
          <ActiveFilterBar />
          <div class="TreeAndGantt">
            {#if $ganttVisible}
              <SplitPanes defaultRatio={[3, 2]}>
                <Pane style={"height: 100%; min-width: 6rem;"}>
                  <div class="TreeTable">
                    <TreeTable />
                  </div>
                </Pane>
                <Pane style={"height: 100%; min-width: 120px;"}>
                  <GanttPanel />
                </Pane>
              </SplitPanes>
            {:else}
              <div class="TreeTable">
                <TreeTable />
              </div>
            {/if}
          </div>
        </Card>
      </Pane>
      {#if detailPaneVisible}
        <Pane style={"min-width: 10rem;"}>
          <TaskDetail />
        </Pane>
      {/if}
    </SplitPanes>
  </div>
  <Dialog
    show={show_confirm}
    toggle={toggle_confirm}
    header="Confirm."
    content={is_bulk_confirm
      ? `選択中の ${bulk_confirm_count} 件を削除しますか？\n子タスクも一緒に削除されます。`
      : `Do you really delete "${name_confirm}"?\nThis may delete child nodes.`}
    callback={callback_confirm}
  />
  <Dialog
    show={show_alert}
    toggle={toggle_alert}
    header="Alert."
    content={alert_content}
    ok={false}
    cancel={"close"}
  />
  <Modal
    show={show_memo_format_confirm}
    toggle={closeBulkMemoFormatConfirm}
    width="44rem"
    height="auto"
    label="Bulk memo format conversion"
  >
    <div class="bulk-convert-container">
      <div class="bulk-convert-header">Convert memos to {bulkMemoTargetLabel}</div>

      <div class="bulk-convert-body">
        {#if bulkMemoPhase === "ready" || bulkMemoPhase === "running"}
          <p class="bulk-section-label">Memos to convert ({bulkMemoItems.length})</p>
          <ul class="bulk-list">
            {#each bulkMemoItems as item (item.id)}
              <li class="bulk-item">
                <span class="bulk-item-title">{item.taskName} / {item.memoTitle}</span>
                <span class="bulk-item-format">
                  {getMemoFormatLabel(item.fromFormat)} → {getMemoFormatLabel(item.toFormat)}
                </span>
              </li>
            {/each}
          </ul>

          <p class="bulk-warn-note">
            Markdown と Quill
            の変換では、装飾や埋め込みなど一部の情報が損なわれる可能性があります。この操作は元に戻す
            / やり直しで取り消しできます。
          </p>
          {#if bulkMemoPhase === "running"}
            <p class="bulk-note">Converting...</p>
          {/if}
        {:else if bulkMemoPhase === "done"}
          {#if successfulBulkMemoItems.length > 0}
            <p class="bulk-section-label">Converted ({successfulBulkMemoItems.length})</p>
            <ul class="bulk-result-list">
              {#each successfulBulkMemoItems as item (item.id)}
                <li class="bulk-result-ok">
                  OK: {item.taskName} / {item.memoTitle} ({getMemoFormatLabel(item.fromFormat)}
                  → {getMemoFormatLabel(item.toFormat)})
                </li>
              {/each}
            </ul>
          {/if}

          {#if failedBulkMemoItems.length > 0}
            <p class="bulk-section-label bulk-error-label">Errors ({failedBulkMemoItems.length})</p>
            <ul class="bulk-result-list">
              {#each failedBulkMemoItems as item (item.id)}
                <li class="bulk-result-err">
                  Error: {item.taskName} / {item.memoTitle}: {item.error}
                </li>
              {/each}
            </ul>
          {/if}

          {#if failedBulkMemoItems.length === 0}
            <p class="bulk-success-note">Conversion completed.</p>
          {/if}
        {/if}
      </div>

      <div class="bulk-convert-footer">
        {#if bulkMemoPhase === "ready"}
          <button
            class="bulk-convert-btn"
            disabled={bulkMemoItems.length === 0}
            on:click={applyBulkMemoFormat}>Convert</button
          >
        {/if}
        <button class="bulk-close-btn" on:click={closeBulkMemoFormatConfirm}>
          {bulkMemoPhase === "done" ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  </Modal>
{:else}
  <Loading variant="h1" />
{/if}

<style>
  div.Content {
    display: flex;
    flex: 1;
    flex-direction: row;
    box-sizing: border-box;
    height: 100%;
    background-color: var(--theme-color-Main-dark);
    margin: 0;
    padding: 0;
    overflow: auto;
  }
  .TbGroup {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    margin: 0;
    box-sizing: border-box;
    flex: 0 0 auto;
  }
  .TbSearch {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    margin-left: auto;
    height: 2rem;
    min-width: 8rem;
    max-width: 22rem;
  }
  .TaskListToolbar {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--sp2);
    width: 100%;
    min-width: 0;
    padding: var(--sp2) var(--sp3);
    box-sizing: border-box;
    flex-wrap: wrap;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    flex-shrink: 0;
  }
  .storage-badge {
    flex: 0 0 auto;
    padding: 0.15rem var(--sp2);
    border-radius: var(--shape-xs);
    background-color: color-mix(in srgb, var(--theme-color-Info-main) 18%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 600;
    white-space: nowrap;
  }
  .TbSep {
    display: inline-block;
    width: 1px;
    height: 1.5rem;
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    flex: 0 0 auto;
    align-self: center;
  }
  .TreeAndGantt {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .TreeAndGantt :global(.SplitPaneRoot),
  .TreeAndGantt :global(.Pane) {
    min-height: 0;
  }
  .TreeAndGantt :global(.Pane) {
    align-items: stretch;
    justify-content: stretch;
    overflow: hidden;
  }
  .TreeTable {
    height: 100%;
    width: 100%;
    min-height: 0;
    box-sizing: border-box;
    flex: 1;
  }
  :global(::-webkit-scrollbar) {
    width: 0.75rem;
    height: 0.75rem;
  }
  :global(::-webkit-scrollbar-track) {
    border-radius: var(--shape-sm);
    background: rgba(128, 128, 128, 0.5);
  }
  :global(::-webkit-scrollbar-thumb) {
    border-radius: var(--shape-sm);
    background: rgba(128, 128, 128, 0.5);
  }
  .bulk-convert-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    background-color: var(--theme-color-Main-light);
    border-radius: var(--shape-sm);
    overflow: hidden;
  }

  .bulk-convert-header {
    padding: var(--sp3) var(--sp4);
    font-weight: bold;
    font-size: 1.4rem;
    color: var(--theme-color-Sub-main);
    background-color: var(--theme-color-Main-main);
    border-bottom: 1px solid var(--theme-color-Sub-dark);
  }

  .bulk-convert-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp2);
    padding: var(--sp4);
    max-height: 60vh;
    overflow-y: auto;
  }

  .bulk-section-label {
    font-size: var(--font-body-md);
    font-weight: bold;
    color: var(--theme-color-Sub-main);
    margin: var(--sp2) 0 var(--sp1);
    opacity: 0.75;
  }

  .bulk-list,
  .bulk-result-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .bulk-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp3);
    padding: var(--sp2) var(--sp3);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-main);
  }

  .bulk-item-title {
    min-width: 0;
    color: var(--theme-color-Sub-main);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bulk-item-format,
  .bulk-note,
  .bulk-warn-note {
    color: var(--theme-color-Sub-dark);
    font-size: var(--font-body-sm);
  }

  .bulk-result-ok {
    color: var(--theme-color-Success-main);
  }

  .bulk-result-err,
  .bulk-error-label {
    color: var(--theme-color-Error-main);
  }

  .bulk-success-note {
    color: var(--theme-color-Success-main);
  }

  .bulk-convert-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp2);
    padding: var(--sp3) var(--sp4);
    border-top: 1px solid var(--theme-color-Sub-dark);
    background-color: var(--theme-color-Main-main);
  }

  .bulk-convert-btn,
  .bulk-close-btn {
    border: none;
    border-radius: var(--shape-xs);
    padding: var(--sp1) var(--sp3);
    font-size: var(--font-body-md);
  }

  .bulk-convert-btn {
    cursor: pointer;
    background-color: var(--theme-color-Primary-main);
    color: white;
  }

  .bulk-convert-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .bulk-close-btn {
    cursor: pointer;
    background-color: var(--theme-color-Sub-dark);
    color: var(--theme-color-Main-main);
  }
</style>
