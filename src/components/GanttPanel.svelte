<script>
  import { onDestroy } from "svelte";
  import {
    filtered_data,
    closed_node_ids,
    ganttScrollTop,
    ganttScale,
    tree_data,
  } from "../stores.ts";
  import {
    flattenVisibleTree,
    buildInheritedDueDateMap,
    updateNodeDataById,
  } from "../common/tree_control.ts";

  let bodyEl;
  let headerScrollLeft = 0;
  let dragState;

  $: rows = $filtered_data ? flattenVisibleTree($filtered_data, $closed_node_ids) : [];
  $: inheritedMap = buildInheritedDueDateMap(rows);

  // Sync scroll position from TreeTable
  $: if (bodyEl) bodyEl.scrollTop = $ganttScrollTop;

  // ── Timeline range ──────────────────────────────────────────────

  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseDate(s) {
    return s ? new Date(s).getTime() : null;
  }

  function formatDate(ts) {
    const date = new Date(ts);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  $: {
    let minTs = null;
    let maxTs = null;
    for (const row of rows) {
      const sd = parseDate(row.node.data["start date"]);
      const dd = parseDate(row.node.data["due date"]) || parseDate(inheritedMap.get(row.id));
      if (sd && (minTs === null || sd < minTs)) minTs = sd;
      if (dd && (maxTs === null || dd > maxTs)) maxTs = dd;
    }
    const today = Date.now();
    const pad = 14 * DAY_MS;
    timelineStart = new Date(Math.floor(((minTs ?? today) - pad) / DAY_MS) * DAY_MS);
    timelineEnd = new Date(Math.ceil(((maxTs ?? today) + pad * 4) / DAY_MS) * DAY_MS);
  }

  let timelineStart = new Date();
  let timelineEnd = new Date();

  // ── Scale helpers ────────────────────────────────────────────────

  const CELL_PX = { day: 28, week: 80, month: 90 };

  function dayOffset(date) {
    return Math.floor((new Date(date).getTime() - timelineStart.getTime()) / DAY_MS);
  }

  function pxFromDate(date) {
    return dayOffset(date) * pixelsPerDay;
  }

  $: pixelsPerDay =
    $ganttScale === "day"
      ? CELL_PX.day
      : $ganttScale === "week"
        ? CELL_PX.week / 7
        : CELL_PX.month / 30;

  $: totalDays = Math.ceil((timelineEnd.getTime() - timelineStart.getTime()) / DAY_MS);
  $: totalWidth = totalDays * pixelsPerDay;
  $: todayPx = pxFromDate(new Date());

  // ── Header cells ─────────────────────────────────────────────────

  function buildHeaderCells(scale, start, end) {
    const cells = [];
    const cur = new Date(start);
    while (cur < end) {
      const cellStart = new Date(cur);
      let label = "";
      let next;
      if (scale === "day") {
        label = `${cur.getMonth() + 1}/${cur.getDate()}`;
        next = new Date(cur.getTime() + DAY_MS);
      } else if (scale === "week") {
        const d = cur.getDay();
        const monday = new Date(cur.getTime() - (d === 0 ? 6 : d - 1) * DAY_MS);
        label = `${monday.getMonth() + 1}/${monday.getDate()}`;
        next = new Date(monday.getTime() + 7 * DAY_MS);
        cur.setTime(monday.getTime());
      } else {
        label = `${cur.getFullYear()}/${cur.getMonth() + 1}`;
        next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
      const widthPx = ((next.getTime() - cellStart.getTime()) / DAY_MS) * pixelsPerDay;
      const leftPx = pxFromDate(cellStart);
      cells.push({ label, leftPx, widthPx });
      cur.setTime(next.getTime());
    }
    return cells;
  }

  $: headerCells = buildHeaderCells($ganttScale, timelineStart, timelineEnd);

  // ── Bar helpers ──────────────────────────────────────────────────

  function getRowDateState(row) {
    const startTs = parseDate(row.node.data["start date"]);
    const dueTs = parseDate(row.node.data["due date"]);
    const inheritedDueTs = parseDate(inheritedMap.get(row.id));
    const effectiveDueTs = dueTs || inheritedDueTs;

    return {
      startTs,
      dueTs,
      inheritedDueTs,
      effectiveDueTs,
      isInherited: !dueTs && !!inheritedDueTs,
    };
  }

  function getBarStyle(row) {
    const dateState = getRowDateState(row);
    const status = row.node.data["status"];

    if (!dateState.startTs && !dateState.effectiveDueTs) return null;

    const color = barColor(
      status,
      dateState.effectiveDueTs ? formatDate(dateState.effectiveDueTs) : undefined
    );

    if (dateState.startTs && dateState.effectiveDueTs) {
      const left = pxFromDate(dateState.startTs);
      const width = Math.max(6, pxFromDate(dateState.effectiveDueTs + DAY_MS) - left);
      return {
        ...dateState,
        left,
        width,
        color,
        opacity: dateState.isInherited ? 0.35 : 1,
        isDue: false,
      };
    } else if (dateState.effectiveDueTs) {
      const left = pxFromDate(dateState.effectiveDueTs) - 2;
      return {
        ...dateState,
        left,
        width: 4,
        color,
        opacity: dateState.isInherited ? 0.35 : 1,
        isDue: true,
      };
    } else if (dateState.startTs) {
      const left = pxFromDate(dateState.startTs);
      const width = Math.max(2, todayPx - left);
      return {
        ...dateState,
        effectiveDueTs: Date.now(),
        left,
        width,
        color,
        opacity: 1,
        isDue: false,
      };
    }
    return null;
  }

  const DAY_MS_5 = 5 * DAY_MS;

  function barColor(status, dueDate) {
    if (status === "Completed") return "var(--theme-color-Success-main)";
    if (status === "Canceled") return "var(--theme-color-Sub-light)";
    if (dueDate && status !== "Completed" && status !== "Canceled") {
      const diff = new Date(dueDate).getTime() - Date.now() + DAY_MS - 1;
      if (diff < 0) return "var(--theme-color-Error-main)";
      if (diff < DAY_MS_5) return "var(--theme-color-Warning-main)";
    }
    if (status === "In Progress") return "var(--theme-color-Accent-main)";
    return "var(--theme-color-Sub-light)";
  }

  function commitTaskDates(id, patch) {
    if (!$tree_data?.data) {
      return;
    }

    const data = updateNodeDataById($tree_data.data, id, patch);
    if (data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  }

  function dateFromPointer(event) {
    const rect = bodyEl.getBoundingClientRect();
    const x = Math.max(0, event.clientX - rect.left + bodyEl.scrollLeft);
    const day = Math.round(x / Math.max(pixelsPerDay, 1));
    return timelineStart.getTime() + day * DAY_MS;
  }

  function createRange(event, row, bar) {
    if (bar && !bar.isInherited) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startTs = dateFromPointer(event);
    const dueTs =
      bar?.effectiveDueTs && bar.effectiveDueTs >= startTs
        ? bar.effectiveDueTs
        : startTs + 2 * DAY_MS;
    commitTaskDates(row.id, {
      "start date": formatDate(startTs),
      "due date": formatDate(dueTs),
    });
  }

  function startDrag(event, row, mode, bar) {
    if (!bar || bar.isInherited) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragState = {
      id: row.id,
      mode,
      startX: event.clientX,
      startTs: bar.startTs,
      dueTs: bar.dueTs,
      effectiveDueTs: bar.effectiveDueTs,
      lastDelta: undefined,
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopDrag);
  }

  function handlePointerMove(event) {
    if (!dragState) {
      return;
    }

    const delta = Math.round((event.clientX - dragState.startX) / Math.max(pixelsPerDay, 1));
    if (delta === dragState.lastDelta) {
      return;
    }

    dragState.lastDelta = delta;
    const deltaMs = delta * DAY_MS;

    if (dragState.mode === "move") {
      const patch = {};
      if (dragState.startTs) {
        patch["start date"] = formatDate(dragState.startTs + deltaMs);
      }
      if (dragState.dueTs || !dragState.startTs) {
        patch["due date"] = formatDate((dragState.dueTs || dragState.effectiveDueTs) + deltaMs);
      }
      commitTaskDates(dragState.id, patch);
      return;
    }

    if (dragState.mode === "start") {
      const dueTs = dragState.dueTs || dragState.effectiveDueTs || dragState.startTs || Date.now();
      const nextStartTs = Math.min((dragState.startTs || dueTs) + deltaMs, dueTs);
      commitTaskDates(dragState.id, { "start date": formatDate(nextStartTs) });
      return;
    }

    const startTs = dragState.startTs || dragState.dueTs || dragState.effectiveDueTs || Date.now();
    const baseDueTs = dragState.dueTs || dragState.effectiveDueTs || startTs;
    const nextDueTs = Math.max(baseDueTs + deltaMs, startTs);
    commitTaskDates(dragState.id, { "due date": formatDate(nextDueTs) });
  }

  function stopDrag() {
    dragState = undefined;
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", stopDrag);
  }

  function handleBodyScroll(event) {
    headerScrollLeft = event.currentTarget.scrollLeft;
  }

  onDestroy(() => {
    stopDrag();
  });
</script>

<div class="GanttRoot">
  <!-- Scale toggle + header -->
  <div class="GanttHeader">
    <div class="ScaleButtons">
      <button class:active={$ganttScale === "day"} on:click={() => ($ganttScale = "day")}>日</button
      >
      <button class:active={$ganttScale === "week"} on:click={() => ($ganttScale = "week")}
        >週</button
      >
      <button class:active={$ganttScale === "month"} on:click={() => ($ganttScale = "month")}
        >月</button
      >
    </div>
    <div class="TimelineHeaderViewport">
      <div
        class="TimelineHeader"
        style="width:{totalWidth}px; transform: translateX(-{headerScrollLeft}px);"
      >
        {#each headerCells as cell}
          <div class="HeaderCell" style="left:{cell.leftPx}px; width:{cell.widthPx}px;">
            {cell.label}
          </div>
        {/each}
        <!-- Today line in header -->
        {#if todayPx >= 0 && todayPx <= totalWidth}
          <div class="TodayLine" style="left:{todayPx}px;"></div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Body: rows synced with TreeTable -->
  <div class="GanttBody" bind:this={bodyEl} on:scroll={handleBodyScroll}>
    <div class="GanttBodyInner" style="width:{totalWidth}px;">
      <!-- Today line in body -->
      {#if todayPx >= 0 && todayPx <= totalWidth}
        <div class="TodayLineFull" style="left:{todayPx}px;"></div>
      {/if}
      {#each rows as row (row.id)}
        {@const bar = getBarStyle(row)}
        <div
          class="GanttRow"
          role="presentation"
          on:dblclick={(event) => createRange(event, row, bar)}
        >
          {#if bar}
            <button
              type="button"
              class="Bar"
              class:DueMarker={bar.isDue}
              class:Inherited={bar.isInherited}
              style="left:{bar.left}px; width:{bar.width}px; background:{bar.color}; opacity:{bar.opacity};"
              aria-label={bar.isDue ? "期限日を変更" : "期間を移動"}
              title={bar.isDue ? "期限日を変更" : "期間を移動"}
              disabled={bar.isInherited}
              on:pointerdown={(event) => startDrag(event, row, "move", bar)}
            ></button>
            {#if !bar.isDue && !bar.isInherited}
              <button
                class="BarHandle StartHandle"
                aria-label="開始日を変更"
                title="開始日を変更"
                style="left:{bar.left}px;"
                on:pointerdown={(event) => startDrag(event, row, "start", bar)}
              ></button>
              <button
                class="BarHandle EndHandle"
                aria-label="期限日を変更"
                title="期限日を変更"
                style="left:{bar.left + bar.width}px;"
                on:pointerdown={(event) => startDrag(event, row, "end", bar)}
              ></button>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .GanttRoot {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--theme-color-Shadow-main);
    background: var(--theme-color-Main-main);
    min-width: 120px;
  }

  .GanttHeader {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    height: 4rem;
    border-bottom: 1px solid var(--theme-color-Shadow-main);
    background: var(--theme-color-Main-main);
    position: sticky;
    top: 0;
    z-index: 10;
    overflow: hidden;
  }

  .ScaleButtons {
    display: flex;
    gap: 2px;
    padding: 2px 4px;
    flex-shrink: 0;
  }

  .ScaleButtons button {
    font-size: 0.7rem;
    padding: 1px 6px;
    border: 1px solid var(--theme-color-Shadow-main);
    border-radius: 3px;
    background: transparent;
    color: var(--theme-color-Sub-main);
    cursor: pointer;
  }

  .ScaleButtons button.active {
    background: var(--theme-color-Accent-main);
    color: var(--theme-color-Main-main);
    border-color: var(--theme-color-Accent-main);
  }

  .TimelineHeaderViewport {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .TimelineHeader {
    height: 100%;
    position: relative;
    will-change: transform;
  }

  .HeaderCell {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding: 0 2px;
    font-size: 0.65rem;
    color: var(--theme-color-Sub-main);
    border-right: 1px solid var(--theme-color-Shadow-main);
    white-space: nowrap;
    overflow: hidden;
    box-sizing: border-box;
  }

  .TodayLine {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--theme-color-Accent-main);
    opacity: 0.8;
    z-index: 1;
  }

  .GanttBody {
    flex: 1;
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .GanttBodyInner {
    position: relative;
  }

  .TodayLineFull {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--theme-color-Accent-main);
    opacity: 0.4;
    pointer-events: none;
    z-index: 1;
  }

  .GanttRow {
    height: 2rem;
    position: relative;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Shadow-main) 50%, transparent);
  }

  .Bar {
    position: absolute;
    top: 25%;
    height: 50%;
    border: none;
    border-radius: 3px;
    min-width: 2px;
    cursor: grab;
    z-index: 2;
    padding: 0;
  }

  .Bar:not(.Inherited):active {
    cursor: grabbing;
  }

  .Bar.Inherited {
    pointer-events: none;
  }

  .Bar.DueMarker {
    top: 15%;
    height: 70%;
    border-radius: 1px;
  }

  .BarHandle {
    position: absolute;
    top: 20%;
    width: 0.5rem;
    height: 60%;
    border: none;
    border-radius: 2px;
    background: color-mix(in srgb, var(--theme-color-Main-main) 70%, transparent);
    cursor: ew-resize;
    padding: 0;
    z-index: 3;
  }

  .StartHandle {
    transform: translateX(-50%);
  }

  .EndHandle {
    transform: translateX(-50%);
  }
</style>
