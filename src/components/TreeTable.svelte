<script>
  import { onMount } from "svelte";
  import TreeTableHeader from "./TreeTableHeader.svelte";
  import TreeTableRow from "./TreeTableRow.svelte";
  import Dialog from "./Dialog.svelte";
  import {
    tree_data,
    filtered_data,
    closed_node_ids,
    table_selected_id,
    theme,
  } from "../stores";
  import {
    flattenVisibleTree,
    updateNodeDataById,
    isChild,
    reorderTree,
    addNode,
    rmNode,
    getNode,
    getParent,
    getDefaultNode,
    canMoveNodeUp,
    canMoveNodeDown,
    canIndentNode,
    canOutdentNode,
    moveNodeUp,
    moveNodeDown,
    indentNode,
    outdentNode,
  } from "../common/tree_control.ts";

  let table_root; // Bind

  // Resize
  let resizers, handlers, resize_observer;

  // Min width
  let minWidth;
  $: rows = $filtered_data ? flattenVisibleTree($filtered_data, $closed_node_ids) : [];
  $: isDark = $theme == "dark";

  let showDeleteConfirm = false;
  let deleteTargetId;
  let deleteTargetName = "";

  onMount(() => {
    let headers, data_rows;
    // Create resizres
    [resizers, headers, data_rows, resize_observer] = createResizers();
    // Event listners
    handlers = setResizersEvents(resizers, headers, data_rows);

    // Min width
    minWidth = `${4 * headers.length}rem`; // magic number 4rem defined in TreeTableHeader.

    // Observe slot change
    let mutation_observer = new MutationObserver(() => {
      let headers, data_rows;
      // Create resizres
      [resizers, headers, data_rows] = createResizers(
        resizers,
        false,
        resize_observer,
      );
      // Event listners
      unsetResizerEvents(resizers, handlers);
      handlers = setResizersEvents(resizers, headers, data_rows);
    });
    mutation_observer.observe(table_root, { subtree: true, childList: true });
  });

  const createResizers = (
    resizers = [],
    is_default = true,
    resize_observer = null,
  ) => {
    // Get elms
    let rows = table_root.querySelectorAll(".TableRow");
    let headers = Array.from(rows[0].querySelectorAll(".TableHeader"));
    let data_rows = [];
    rows.forEach((data_row, index) => {
      if (index != 0) {
        data_rows.push(data_row.querySelectorAll(".TableData"));
      }
    });
    // Set width
    const default_ratio_sum = $tree_data.headers.reduce(
      (partialSum, header) => partialSum + header.default_ratio,
      0,
    );
    const default_root_width = rows[0].getBoundingClientRect().width;
    const default_data_widths = $tree_data.headers.map(
      (header) =>
        (default_root_width * header.default_ratio) / default_ratio_sum,
    );
    headers.forEach((header, index) => {
      if (is_default) {
        header.style.width = `calc(${default_data_widths[index]}px)`;
        data_rows.forEach((data_row, _) => {
          data_row[index].style.width = `calc(${default_data_widths[index]}px)`;
        });
      } else {
        data_rows.forEach((data_row, _) => {
          data_row[index].style.width =
            `${header.getBoundingClientRect().width}px)`;
        });
      }
    });
    // Create resizer
    if (is_default) {
      headers.forEach((header, index) => {
        if (index == 0) {
          return;
        }
        // Create resizer
        const resizer = document.createElement("div");
        resizer.classList.add("Resizer");
        resizer.style.height = `${table_root.offsetHeight}px`; //テーブルの高さ
        // Postions of resizer
        resizer.style.left = `calc(${default_data_widths.reduce((partialSum, width) => partialSum + width, 0) - 3}px)`;
        // Add resizer into Dom
        header.parentNode.insertBefore(resizer, header);
        // Keep resizer
        resizers.push(resizer);
      });
    }
    // For table_root resizing
    if (resize_observer) {
      resize_observer.disconnect(table_root);
    }
    resize_observer = new ResizeObserver((entries) => {
      // Height setting
      for (let resizer of resizers) {
        resizer.style.height = `${entries[0].contentRect.height}px`;
      }
      // Width setting
      let table_width = 0;
      headers.forEach((header, index) => {
        table_width += header.getBoundingClientRect().width;
      });
      let new_table_width = entries[0].contentRect.width;
      const new_header_widths = headers.map(
        (h) =>
          (h.getBoundingClientRect().width * new_table_width) / table_width,
      );
      headers.forEach((header, index) => {
        header.style.width = `${new_header_widths[index]}px`;
        data_rows.forEach((data_row) => {
          data_row[index].style.width = `${new_header_widths[index]}px`;
        });
      });
      let left = 0;
      resizers.forEach((resizer, index) => {
        resizer.style.left = `${left + new_header_widths[index] - 3}px`;
        left += new_header_widths[index];
      });
    });
    resize_observer.observe(table_root);
    // Return
    return [resizers, headers, data_rows, resize_observer];
  };

  const setResizersEvents = (resizers, headers, data_rows) => {
    const handlers = [];
    // Create resizers and their events
    for (let i = 0; i < resizers.length; i++) {
      const header = headers[i];
      const header_r = headers[i + 1];
      const resizer = resizers[i];
      let datas = [];
      let datas_r = [];

      data_rows.forEach((rows, _) => {
        datas.push(rows[i]);
        datas_r.push(rows[i + 1]);
      });

      const min_w =
        parseFloat(window.getComputedStyle(header).minWidth, 10) || 10;
      const min_wr =
        parseFloat(window.getComputedStyle(header_r).minWidth, 10) || 10;

      // Track the current position of mouse
      let x = 0;
      let w = 0;
      let wr = 0;
      let l = 0;

      const mouseDownHandler = function (e) {
        let cssText = document.body.style.cssText;
        document.body.style.cssText =
          cssText + "cursor: col-resize !important;";

        // Add HandlingResizer class
        resizer.classList.add("HandlingResizer");

        // Get the current mouse position
        x = e.clientX;

        // Calculate the current width of column
        w = header.getBoundingClientRect().width;
        wr = header_r.getBoundingClientRect().width;

        // Calculate the curent left of resizer
        l =
          resizer.getBoundingClientRect().left -
          resizer.parentNode.getBoundingClientRect().left;

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
        header.style.width = `${new_width}px`;
        header_r.style.width = `${new_widthr}px`;
        datas.forEach((data, index) => {
          data.style.width = `${new_width}px`;
          datas_r[index].style.width = `${new_widthr}px`;
        });

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
    resizers.forEach((resizer, index) => {
      resizer.removeEventListener("mousedown", handlers[index]);
    });
  };

  function handleSelectRow(event) {
    $table_selected_id = event.detail.id;
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
    if (!canMoveNodeUp(id, $tree_data.data)) {
      return;
    }

    const data = moveNodeUp(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleMoveDown(event) {
    const { id } = event.detail;
    if (!canMoveNodeDown(id, $tree_data.data)) {
      return;
    }

    const data = moveNodeDown(id, $tree_data.data);
    $tree_data = { ...$tree_data, data };
  }

  function handleIndentTask(event) {
    const { id } = event.detail;
    const parentNode = getParent(id, $tree_data.data);
    const currentIndex = parentNode?.children.findIndex((child) => child.id === id) ?? -1;
    const newParentId =
      currentIndex > 0 ? parentNode.children[currentIndex - 1]?.id : undefined;

    if (!newParentId || !canIndentNode(id, $tree_data.data)) {
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
    if (!canOutdentNode(id, $tree_data.data)) {
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
    let parentId;

    if (action === "append") {
      parentId = targetId;
    } else {
      const parentNode = getParent(targetId, $tree_data.data);
      if (parentNode) {
        parentId = parentNode.id;
      }
    }

    const data = addNode(newNode, targetId, $tree_data.data, action);
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

<div
  bind:this={table_root}
  class:TableRoot={true}
  style="--minWidth: {minWidth}"
>
  <TreeTableHeader headers={$tree_data.headers} />
  {#if rows.length > 0}
    {#each rows as row (row.id)}
      <TreeTableRow
        {row}
        headers={$tree_data.headers}
        selected={$table_selected_id === row.id}
        {isDark}
        canDrop={canDropTarget}
        canMoveUp={canMoveNodeUp(row.id, $tree_data.data)}
        canMoveDown={canMoveNodeDown(row.id, $tree_data.data)}
        canIndent={canIndentNode(row.id, $tree_data.data)}
        canOutdent={canOutdentNode(row.id, $tree_data.data)}
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
      />
    {/each}
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
  .TableRoot :global(.Resizer) {
    position: absolute;
    top: 0;
    width: 5px;
    cursor: col-resize;
    user-select: none;
    z-index: 999;
  }
  .TableRoot :global(.HandlingResizer),
  .TableRoot :global(.Resizer:hover) {
    background-color: var(--theme-color-Accent-light);
  }
</style>
