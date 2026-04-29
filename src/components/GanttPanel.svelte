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
  let locale =
    typeof navigator !== "undefined" && navigator.language ? navigator.language : undefined;

  $: rows = $filtered_data ? flattenVisibleTree($filtered_data, $closed_node_ids) : [];
  $: inheritedMap = buildInheritedDueDateMap(rows);

  // Sync scroll position from TreeTable
  $: if (bodyEl) bodyEl.scrollTop = $ganttScrollTop;

  // ── Timeline range ──────────────────────────────────────────────

  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseDate(s) {
    if (!s) return null;
    const [year, month, day] = s.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  }

  function formatDate(ts) {
    const date = new Date(ts);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function startOfDay(ts = Date.now()) {
    const date = new Date(ts);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function getPeriodTone(startTs, endTs) {
    const todayStart = startOfDay();
    const todayEnd = todayStart + DAY_MS;
    if (endTs <= todayStart) return "past";
    if (startTs < todayEnd && endTs > todayStart) return "today";
    return "future";
  }

  function formatLocalDate(date, options) {
    return new Intl.DateTimeFormat(locale, options).format(date);
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
    const today = startOfDay();
    const pad = 14 * DAY_MS;
    timelineStart = new Date(startOfDay((minTs ?? today) - pad));
    timelineEnd = new Date(startOfDay((maxTs ?? today) + pad * 4) + DAY_MS);
  }

  let timelineStart = new Date();
  let timelineEnd = new Date();

  // ── Scale helpers ────────────────────────────────────────────────

  const CELL_PX = { day: 46, week: 96, month: 110 };

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
  $: todayTs = startOfDay();
  $: todayPx = pxFromDate(todayTs);

  // ── Header cells ─────────────────────────────────────────────────

  function buildHeaderCells(scale, start, end) {
    const cells = [];
    const cur = new Date(start);
    while (cur < end) {
      const cellStart = new Date(cur);
      let label = "";
      let next;
      if (scale === "day") {
        label = formatLocalDate(cur, {
          month: "numeric",
          day: "numeric",
          weekday: "short",
        });
        next = new Date(cur.getTime() + DAY_MS);
      } else if (scale === "week") {
        const d = cur.getDay();
        const monday = new Date(cur.getTime() - (d === 0 ? 6 : d - 1) * DAY_MS);
        label = formatLocalDate(monday, {
          month: "numeric",
          day: "numeric",
          weekday: "short",
        });
        next = new Date(monday.getTime() + 7 * DAY_MS);
        cur.setTime(monday.getTime());
      } else {
        label = formatLocalDate(cur, { year: "numeric", month: "short" });
        next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
      const widthPx = ((next.getTime() - cellStart.getTime()) / DAY_MS) * pixelsPerDay;
      const leftPx = pxFromDate(cellStart);
      const startTs = cellStart.getTime();
      const endTs = next.getTime();
      cells.push({
        label,
        leftPx,
        widthPx,
        tone: getPeriodTone(startTs, endTs),
        weekend: scale === "day" && (cellStart.getDay() === 0 || cellStart.getDay() === 6),
      });
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
      const markerInset = 3;
      const left = pxFromDate(dateState.effectiveDueTs) + markerInset;
      return {
        ...dateState,
        left,
        width: Math.max(10, pixelsPerDay - markerInset * 2),
        color,
        opacity: dateState.isInherited ? 0.35 : 1,
        isDue: true,
      };
    } else if (dateState.startTs) {
      const left = pxFromDate(dateState.startTs);
      const width = Math.max(2, todayPx - left);
      return {
        ...dateState,
        effectiveDueTs: todayTs,
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
    const day = Math.max(0, Math.min(totalDays - 1, Math.floor(x / Math.max(pixelsPerDay, 1))));
    return timelineStart.getTime() + day * DAY_MS;
  }

  function getRangeGeometry(startTs, endTs) {
    const start = Math.min(startTs, endTs);
    const end = Math.max(startTs, endTs);
    const left = pxFromDate(start);
    const width = Math.max(6, pxFromDate(end + DAY_MS) - left);
    return { start, end, left, width };
  }

  function getCreatePreview(row) {
    if (dragState?.mode !== "create" || dragState.id !== row.id) {
      return null;
    }
    return getRangeGeometry(dragState.anchorTs, dragState.currentTs);
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

  function startCreateDrag(event, row) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const ts = dateFromPointer(event);
    dragState = {
      id: row.id,
      mode: "create",
      anchorTs: ts,
      currentTs: ts,
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopDrag);
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

    if (dragState.mode === "create") {
      dragState.currentTs = dateFromPointer(event);
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
    if (dragState?.mode === "create") {
      const range = getRangeGeometry(dragState.anchorTs, dragState.currentTs);
      commitTaskDates(dragState.id, {
        "start date": formatDate(range.start),
        "due date": formatDate(range.end),
      });
    }

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
          <div
            class="HeaderCell"
            class:PastCell={cell.tone === "past"}
            class:TodayCell={cell.tone === "today"}
            class:FutureCell={cell.tone === "future"}
            class:WeekendCell={cell.weekend}
            style="left:{cell.leftPx}px; width:{cell.widthPx}px;"
          >
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
    <div class="GanttBodyInner" style="width:{totalWidth}px; height:{rows.length * 2}rem;">
      {#each headerCells as cell}
        <div
          class="GridCell"
          class:PastCell={cell.tone === "past"}
          class:TodayCell={cell.tone === "today"}
          class:FutureCell={cell.tone === "future"}
          class:WeekendCell={cell.weekend}
          style="left:{cell.leftPx}px; width:{cell.widthPx}px;"
        ></div>
      {/each}
      <!-- Today line in body -->
      {#if todayPx >= 0 && todayPx <= totalWidth}
        <div class="TodayLineFull" style="left:{todayPx}px;"></div>
      {/if}
      {#each rows as row (row.id)}
        {@const bar = getBarStyle(row)}
        {@const preview = getCreatePreview(row)}
        <div
          class="GanttRow"
          role="presentation"
          on:pointerdown={(event) => startCreateDrag(event, row)}
          on:dblclick={(event) => createRange(event, row, bar)}
        >
          {#if preview}
            <div
              class="CreatePreview"
              style="left:{preview.left}px; width:{preview.width}px;"
            ></div>
          {/if}
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
  .HeaderCell.PastCell,
  .GridCell.PastCell {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 7%, transparent);
  }
  .HeaderCell.FutureCell,
  .GridCell.FutureCell {
    background-color: color-mix(in srgb, var(--theme-color-Main-main) 80%, transparent);
  }
  .HeaderCell.WeekendCell,
  .GridCell.WeekendCell {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  .HeaderCell.TodayCell,
  .GridCell.TodayCell {
    background-color: color-mix(in srgb, var(--theme-color-Accent-main) 18%, transparent);
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

  .GridCell {
    position: absolute;
    top: 0;
    bottom: 0;
    border-right: 1px solid color-mix(in srgb, var(--theme-color-Shadow-main) 72%, transparent);
    box-sizing: border-box;
    pointer-events: none;
    z-index: 0;
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
    cursor: crosshair;
    z-index: 1;
  }

  .CreatePreview {
    position: absolute;
    top: 20%;
    height: 60%;
    border: 1px solid var(--theme-color-Accent-main);
    border-radius: 3px;
    background-color: color-mix(in srgb, var(--theme-color-Accent-main) 42%, transparent);
    pointer-events: none;
    z-index: 2;
  }

  .Bar {
    position: absolute;
    top: 25%;
    height: 50%;
    border: none;
    border-radius: 3px;
    min-width: 2px;
    cursor: grab;
    z-index: 3;
    padding: 0;
  }

  .Bar:not(.Inherited):active {
    cursor: grabbing;
  }

  .Bar.Inherited {
    pointer-events: none;
  }

  .Bar.DueMarker {
    top: 22%;
    height: 56%;
    border-radius: 999px;
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
    z-index: 4;
  }

  .StartHandle {
    transform: translateX(-50%);
  }

  .EndHandle {
    transform: translateX(-50%);
  }
</style>
