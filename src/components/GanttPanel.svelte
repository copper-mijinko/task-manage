<script>
  import { onMount, afterUpdate } from "svelte";
  import { filtered_data, closed_node_ids, ganttScrollTop, ganttScale } from "../stores.ts";
  import { flattenVisibleTree, buildInheritedDueDateMap } from "../common/tree_control.ts";

  let bodyEl;

  $: rows = $filtered_data ? flattenVisibleTree($filtered_data, $closed_node_ids) : [];
  $: inheritedMap = buildInheritedDueDateMap(rows);

  // Sync scroll position from TreeTable
  $: if (bodyEl) bodyEl.scrollTop = $ganttScrollTop;

  // ── Timeline range ──────────────────────────────────────────────

  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseDate(s) {
    return s ? new Date(s).getTime() : null;
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

  function getBarStyle(row) {
    const sd = row.node.data["start date"];
    const dd = row.node.data["due date"];
    const idd = inheritedMap.get(row.id);
    const status = row.node.data["status"];

    if (!sd && !dd && !idd) return null;

    const effectiveDue = dd || idd;
    const isInherited = !dd && !!idd;
    const color = barColor(status, effectiveDue, isInherited);

    if (sd && effectiveDue) {
      const left = pxFromDate(sd);
      const width = Math.max(2, pxFromDate(effectiveDue) - left);
      return { left, width, color, opacity: isInherited ? 0.35 : 1, isDue: false };
    } else if (effectiveDue) {
      const left = pxFromDate(effectiveDue) - 1;
      return { left, width: 2, color, opacity: isInherited ? 0.35 : 1, isDue: true };
    } else if (sd) {
      const left = pxFromDate(sd);
      const width = Math.max(2, todayPx - left);
      return { left, width, color, opacity: 1, isDue: false };
    }
    return null;
  }

  const DAY_MS_5 = 5 * DAY_MS;

  function barColor(status, dueDate, isInherited) {
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
    <div class="TimelineHeader" style="width:{totalWidth}px; position:relative;">
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

  <!-- Body: rows synced with TreeTable -->
  <div class="GanttBody" bind:this={bodyEl}>
    <div class="GanttBodyInner" style="width:{totalWidth}px;">
      <!-- Today line in body -->
      {#if todayPx >= 0 && todayPx <= totalWidth}
        <div class="TodayLineFull" style="left:{todayPx}px;"></div>
      {/if}
      {#each rows as row (row.id)}
        {@const bar = getBarStyle(row)}
        <div class="GanttRow">
          {#if bar}
            <div
              class="Bar"
              class:DueMarker={bar.isDue}
              style="left:{bar.left}px; width:{bar.width}px; background:{bar.color}; opacity:{bar.opacity};"
            ></div>
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

  .TimelineHeader {
    flex: 1;
    overflow: hidden;
    position: relative;
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
    border-radius: 3px;
    min-width: 2px;
  }

  .Bar.DueMarker {
    top: 15%;
    height: 70%;
    border-radius: 1px;
  }
</style>
