<script>
  import { onMount } from "svelte";
  import TreeTableHeader from "./TreeTableHeader.svelte";
  import TreeTableData from "./TreeTableData.svelte";
  import { tree_data, filter, filtered_data } from "../stores";

  let table_root; // Bind

  // Resize
  let resizers, handlers, resize_observer;

  // Min width
  let minWidth;

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
        resize_observer
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
    resize_observer = null
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
      0
    );
    const default_root_width = rows[0].getBoundingClientRect().width;
    const default_data_widths = $tree_data.headers.map(
      (header) =>
        (default_root_width * header.default_ratio) / default_ratio_sum
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
        (h) => (h.getBoundingClientRect().width * new_table_width) / table_width
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
</script>

<div
  bind:this={table_root}
  class:TableRoot={true}
  style="--minWidth: {minWidth}"
>
  <TreeTableHeader headers={$tree_data.headers} />
  {#if $filtered_data}
    <TreeTableData node={$filtered_data} />
  {/if}
</div>

<style>
  .TableRoot {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: var(--minWidth);
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
