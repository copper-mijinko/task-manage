<script>
  import { onDestroy, onMount } from "svelte";
  import {
    filtered_data,
    closed_node_ids,
    ganttScrollTop,
    ganttScale,
    theme,
    tree_data,
  } from "@stores";
  import {
    flattenVisibleTree,
    buildInheritedDueDateMap,
    updateNodeDataById,
  } from "@features/tasks/utils/tree_control";

  let bodyEl;
  let headerScrollLeft = 0;
  let dragState;
  let rootFontSizePx = 16;
  let locale =
    typeof navigator !== "undefined" && navigator.language ? navigator.language : undefined;
  let prevTimelineStartTs = null;

  $: rows = $filtered_data ? flattenVisibleTree($filtered_data, $closed_node_ids) : [];
  $: inheritedMap = buildInheritedDueDateMap(rows);

  // Sync scroll position from TreeTable
  $: if (bodyEl && !dragState) bodyEl.scrollTop = $ganttScrollTop;

  // ── Timeline range ──────────────────────────────────────────────

  const DAY_MS = 24 * 60 * 60 * 1000;
  const TIMELINE_START_PADDING_DAYS = 30;
  const TIMELINE_TODAY_FUTURE_DAYS = 180;
  const TIMELINE_END_PADDING_DAYS = 30;

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

  let timelineStart = new Date();
  let timelineEnd = new Date();

  $: {
    let minTs = null;
    let maxTs = null;
    for (const row of rows) {
      const sd = parseDate(row.node.data["start date"]);
      const dd = parseDate(row.node.data["due date"]) || parseDate(inheritedMap.get(row.id));
      for (const ts of [sd, dd]) {
        if (!ts) continue;
        if (minTs === null || ts < minTs) minTs = ts;
        if (maxTs === null || ts > maxTs) maxTs = ts;
      }
    }
    const today = startOfDay();
    const startBaseTs = minTs === null ? today : Math.min(today, minTs);
    const endBaseTs = maxTs === null ? today : maxTs;
    const desiredStart = new Date(startOfDay(startBaseTs - TIMELINE_START_PADDING_DAYS * DAY_MS));
    const desiredEndTs = Math.max(
      today + TIMELINE_TODAY_FUTURE_DAYS * DAY_MS,
      endBaseTs + TIMELINE_END_PADDING_DAYS * DAY_MS
    );
    const desiredEnd = new Date(startOfDay(desiredEndTs) + DAY_MS);

    // Only grow the window — never shrink it. This keeps the user's current
    // view from jumping around when they enter or clear a single date.
    const nextStart =
      timelineStart instanceof Date && timelineStart.getTime() <= desiredStart.getTime()
        ? timelineStart
        : desiredStart;
    const nextEnd =
      timelineEnd instanceof Date && timelineEnd.getTime() >= desiredEnd.getTime()
        ? timelineEnd
        : desiredEnd;

    if (!dragState) {
      // Preserve the user's scroll position relative to the timeline when the
      // start shifts earlier (everything shifts right in pixel space).
      const previousStartTs = prevTimelineStartTs;
      const nextStartTs = nextStart.getTime();
      if (
        bodyEl &&
        previousStartTs !== null &&
        previousStartTs !== nextStartTs &&
        rootFontSizePx > 0
      ) {
        const deltaDays = Math.round((previousStartTs - nextStartTs) / DAY_MS);
        const deltaPx = deltaDays * remPerDay * rootFontSizePx;
        if (Number.isFinite(deltaPx) && deltaPx !== 0) {
          const currentScrollLeft = bodyEl.scrollLeft;
          requestAnimationFrame(() => {
            bodyEl.scrollLeft = currentScrollLeft + deltaPx;
            headerScrollLeft = bodyEl.scrollLeft;
          });
        }
      }
      timelineStart = nextStart;
      timelineEnd = nextEnd;
      prevTimelineStartTs = nextStartTs;
    }
  }

  // ── Scale helpers ────────────────────────────────────────────────

  const CELL_REM = { day: 2.25, week: 7, month: 8.5 };
  const MIN_BAR_WIDTH_REM = 0.5;
  const MIN_DUE_MARKER_WIDTH_REM = 0.833;
  const DUE_MARKER_INSET_REM = 0.25;
  const EDGE_SCROLL_ZONE_PX = 56;
  const EDGE_SCROLL_MAX_PX = 6;
  let autoScrollFrame;

  function readRootFontSizePx() {
    if (typeof window === "undefined") {
      return rootFontSizePx;
    }

    return parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  }

  function updateRootFontSizePx() {
    rootFontSizePx = readRootFontSizePx();
  }

  function dayOffset(date, rangeStart = timelineStart) {
    return Math.floor((new Date(date).getTime() - rangeStart.getTime()) / DAY_MS);
  }

  function remFromDate(date, scaleRemPerDay = remPerDay, rangeStart = timelineStart) {
    return dayOffset(date, rangeStart) * scaleRemPerDay;
  }

  $: remPerDay =
    $ganttScale === "day"
      ? CELL_REM.day
      : $ganttScale === "week"
        ? CELL_REM.week / 7
        : CELL_REM.month / 30;

  $: totalDays = Math.ceil((timelineEnd.getTime() - timelineStart.getTime()) / DAY_MS);
  $: totalWidthRem = totalDays * remPerDay;
  $: todayTs = startOfDay();
  $: todayRem = remFromDate(todayTs);

  // ── Header cells ─────────────────────────────────────────────────

  function buildHeaderCells(scale, start, end) {
    const cells = [];
    const cur = new Date(start);
    while (cur < end) {
      const cellStart = new Date(cur);
      let label = "";
      let weekdayLabel = "";
      let next;
      if (scale === "day") {
        label = formatLocalDate(cur, {
          month: "numeric",
          day: "numeric",
        });
        weekdayLabel = formatLocalDate(cur, { weekday: "short" });
        next = new Date(cur.getTime() + DAY_MS);
      } else if (scale === "week") {
        const d = cur.getDay();
        const monday = new Date(cur.getTime() - (d === 0 ? 6 : d - 1) * DAY_MS);
        const sunday = new Date(monday.getTime() + 6 * DAY_MS);
        const mondayLabel = formatLocalDate(monday, {
          month: "numeric",
          day: "numeric",
        });
        const sundayLabel = formatLocalDate(sunday, {
          month: "numeric",
          day: "numeric",
        });
        label = `${mondayLabel}～${sundayLabel}`;
        weekdayLabel = "";
        next = new Date(monday.getTime() + 7 * DAY_MS);
        cur.setTime(monday.getTime());
      } else {
        label = formatLocalDate(cur, { year: "numeric", month: "short" });
        next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
      const widthRem = ((next.getTime() - cellStart.getTime()) / DAY_MS) * remPerDay;
      const leftRem = remFromDate(cellStart);
      const startTs = cellStart.getTime();
      const endTs = next.getTime();
      cells.push({
        label,
        weekdayLabel,
        leftRem,
        widthRem,
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

  function getDraggedDateState(baseDateState, activeDragState = dragState) {
    if (!activeDragState || activeDragState.mode === "create") {
      return baseDateState;
    }

    const deltaMs = (activeDragState.currentDelta ?? 0) * DAY_MS;

    if (activeDragState.mode === "move") {
      const nextStartTs = activeDragState.startTs ? activeDragState.startTs + deltaMs : null;
      const nextDueTs =
        activeDragState.dueTs || !activeDragState.startTs
          ? (activeDragState.dueTs || activeDragState.effectiveDueTs) + deltaMs
          : activeDragState.dueTs;

      return {
        ...baseDateState,
        startTs: nextStartTs,
        dueTs: nextDueTs,
        effectiveDueTs: nextDueTs || activeDragState.effectiveDueTs,
        isInherited: false,
      };
    }

    if (activeDragState.mode === "start") {
      const dueTs =
        activeDragState.dueTs ||
        activeDragState.effectiveDueTs ||
        activeDragState.startTs ||
        Date.now();
      const nextStartTs = Math.min((activeDragState.startTs || dueTs) + deltaMs, dueTs);
      return {
        ...baseDateState,
        startTs: nextStartTs,
        effectiveDueTs: dueTs,
        isInherited: false,
      };
    }

    const startTs =
      activeDragState.startTs ||
      activeDragState.dueTs ||
      activeDragState.effectiveDueTs ||
      Date.now();
    const baseDueTs = activeDragState.dueTs || activeDragState.effectiveDueTs || startTs;
    const nextDueTs = Math.max(baseDueTs + deltaMs, startTs);

    return {
      ...baseDateState,
      startTs: activeDragState.startTs,
      dueTs: nextDueTs,
      effectiveDueTs: nextDueTs,
      isInherited: false,
    };
  }

  function getDragPatch() {
    if (!dragState || dragState.mode === "create") {
      return {};
    }

    const deltaMs = (dragState.currentDelta ?? 0) * DAY_MS;

    if (dragState.mode === "move") {
      const patch = {};
      if (dragState.startTs) {
        patch["start date"] = formatDate(dragState.startTs + deltaMs);
      }
      if (dragState.dueTs || !dragState.startTs) {
        patch["due date"] = formatDate((dragState.dueTs || dragState.effectiveDueTs) + deltaMs);
      }
      return patch;
    }

    if (dragState.mode === "start") {
      const dueTs = dragState.dueTs || dragState.effectiveDueTs || dragState.startTs || Date.now();
      const nextStartTs = Math.min((dragState.startTs || dueTs) + deltaMs, dueTs);
      return { "start date": formatDate(nextStartTs) };
    }

    const startTs = dragState.startTs || dragState.dueTs || dragState.effectiveDueTs || Date.now();
    const baseDueTs = dragState.dueTs || dragState.effectiveDueTs || startTs;
    const nextDueTs = Math.max(baseDueTs + deltaMs, startTs);
    return { "due date": formatDate(nextDueTs) };
  }

  function getBarStyle(
    row,
    activeDragState = dragState,
    scaleRemPerDay = remPerDay,
    scaleTodayRem = todayRem,
    scaleTodayTs = todayTs,
    rangeStart = timelineStart
  ) {
    const baseDateState = getRowDateState(row);
    const dateState =
      activeDragState?.id === row.id && activeDragState.mode !== "create"
        ? getDraggedDateState(baseDateState, activeDragState)
        : baseDateState;
    const status = row.node.data["status"];

    if (!dateState.startTs && !dateState.effectiveDueTs) return null;

    const color = barColor(status);
    const dueColor = dueMarkerColor(
      status,
      dateState.effectiveDueTs ? formatDate(dateState.effectiveDueTs) : undefined
    );

    if (dateState.startTs && dateState.effectiveDueTs) {
      const leftRem = remFromDate(dateState.startTs, scaleRemPerDay, rangeStart);
      const widthRem = Math.max(
        MIN_BAR_WIDTH_REM,
        remFromDate(dateState.effectiveDueTs + DAY_MS, scaleRemPerDay, rangeStart) - leftRem
      );
      const overdue = getOverdueSegment(
        status,
        dateState.effectiveDueTs,
        scaleRemPerDay,
        scaleTodayTs,
        rangeStart
      );
      return {
        ...dateState,
        leftRem,
        widthRem,
        color,
        overdue,
        opacity: dateState.isInherited ? 0.35 : 1,
        isDue: false,
        isStartOnly: false,
      };
    } else if (dateState.effectiveDueTs) {
      const leftRem =
        remFromDate(dateState.effectiveDueTs, scaleRemPerDay, rangeStart) + DUE_MARKER_INSET_REM;
      return {
        ...dateState,
        leftRem,
        widthRem: Math.max(MIN_DUE_MARKER_WIDTH_REM, scaleRemPerDay - DUE_MARKER_INSET_REM * 2),
        color: dueColor,
        opacity: dateState.isInherited ? 0.35 : 1,
        isDue: true,
        isStartOnly: false,
      };
    } else if (dateState.startTs) {
      // Start-only: render a single-day marker at the start position so the bar
      // doesn't grow uncontrollably toward "today".
      const leftRem =
        remFromDate(dateState.startTs, scaleRemPerDay, rangeStart) + DUE_MARKER_INSET_REM;
      return {
        ...dateState,
        leftRem,
        widthRem: Math.max(MIN_DUE_MARKER_WIDTH_REM, scaleRemPerDay - DUE_MARKER_INSET_REM * 2),
        color,
        opacity: 1,
        isDue: false,
        isStartOnly: true,
      };
    }
    return null;
  }

  const DAY_MS_5 = 5 * DAY_MS;

  function barColor(status) {
    if (status === "Completed") return "var(--theme-color-Success-main)";
    if (status === "Canceled") return "var(--theme-color-Sub-light)";
    if (status === "In Progress") return "var(--theme-color-Primary-main)";
    return "var(--theme-color-Sub-light)";
  }

  function shouldShowDueAlert(status) {
    return status !== "Completed" && status !== "Canceled";
  }

  function dueMarkerColor(status, dueDate) {
    if (!shouldShowDueAlert(status)) return barColor(status);
    if (dueDate) {
      const diff = new Date(dueDate).getTime() - Date.now() + DAY_MS - 1;
      if (diff < 0) return "var(--theme-color-Error-main)";
      if (diff < DAY_MS_5) return "var(--theme-color-Warning-main)";
    }
    return barColor(status);
  }

  function getOverdueSegment(
    status,
    dueTs,
    scaleRemPerDay = remPerDay,
    scaleTodayTs = todayTs,
    rangeStart = timelineStart
  ) {
    if (!shouldShowDueAlert(status) || !dueTs || dueTs >= scaleTodayTs) {
      return null;
    }

    const leftRem = remFromDate(dueTs + DAY_MS, scaleRemPerDay, rangeStart);
    const widthRem = Math.max(
      0,
      remFromDate(scaleTodayTs + DAY_MS, scaleRemPerDay, rangeStart) - leftRem
    );
    if (widthRem <= 0) {
      return null;
    }

    return {
      leftRem,
      widthRem,
      color: "var(--theme-color-Error-main)",
    };
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

  function dateFromClientX(clientX) {
    const rect = bodyEl.getBoundingClientRect();
    const xRem = Math.max(0, clientX - rect.left + bodyEl.scrollLeft) / rootFontSizePx;
    const day = Math.max(0, Math.min(totalDays - 1, Math.floor(xRem / Math.max(remPerDay, 0.01))));
    return timelineStart.getTime() + day * DAY_MS;
  }

  function dateFromPointer(event) {
    return dateFromClientX(event.clientX);
  }

  function getRangeGeometry(
    startTs,
    endTs,
    scaleRemPerDay = remPerDay,
    rangeStart = timelineStart
  ) {
    const start = Math.min(startTs, endTs);
    const end = Math.max(startTs, endTs);
    const leftRem = remFromDate(start, scaleRemPerDay, rangeStart);
    const widthRem = Math.max(
      MIN_BAR_WIDTH_REM,
      remFromDate(end + DAY_MS, scaleRemPerDay, rangeStart) - leftRem
    );
    return { start, end, leftRem, widthRem };
  }

  function getCreatePreview(
    row,
    activeDragState = dragState,
    scaleRemPerDay = remPerDay,
    rangeStart = timelineStart
  ) {
    if (activeDragState?.mode !== "create" || activeDragState.id !== row.id) {
      return null;
    }
    return getRangeGeometry(
      activeDragState.anchorTs,
      activeDragState.currentTs,
      scaleRemPerDay,
      rangeStart
    );
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

  function getLockedScroll() {
    return {
      scrollLeft: bodyEl?.scrollLeft ?? 0,
      scrollTop: bodyEl?.scrollTop ?? 0,
    };
  }

  function restoreLockedScroll(scrollLeft, scrollTop) {
    if (!bodyEl) {
      return;
    }

    bodyEl.scrollLeft = scrollLeft;
    bodyEl.scrollTop = scrollTop;
    headerScrollLeft = scrollLeft;
  }

  function updateDragFromPointer() {
    if (!dragState || dragState.lastClientX === undefined) {
      return;
    }

    if (dragState.mode === "create") {
      const currentTs = dateFromClientX(dragState.lastClientX);
      if (currentTs !== dragState.currentTs) {
        dragState = {
          ...dragState,
          currentTs,
          scrollLeft: bodyEl?.scrollLeft ?? dragState.scrollLeft,
        };
      }
      return;
    }

    const scrollDelta =
      (bodyEl?.scrollLeft ?? dragState.startScrollLeft) - dragState.startScrollLeft;
    const delta = Math.round(
      (dragState.lastClientX - dragState.startX + scrollDelta) /
        Math.max(remPerDay * rootFontSizePx, 1)
    );
    if (delta === dragState.lastDelta) {
      return;
    }

    dragState = {
      ...dragState,
      currentDelta: delta,
      lastDelta: delta,
      scrollLeft: bodyEl?.scrollLeft ?? dragState.scrollLeft,
    };
  }

  function getEdgeScrollDelta() {
    if (!dragState || dragState.lastClientX === undefined || !bodyEl) {
      return 0;
    }

    const rect = bodyEl.getBoundingClientRect();
    const x = dragState.lastClientX;

    if (x < rect.left + EDGE_SCROLL_ZONE_PX) {
      const ratio = (rect.left + EDGE_SCROLL_ZONE_PX - x) / EDGE_SCROLL_ZONE_PX;
      return -Math.ceil(ratio * EDGE_SCROLL_MAX_PX);
    }

    if (x > rect.right - EDGE_SCROLL_ZONE_PX) {
      const ratio = (x - (rect.right - EDGE_SCROLL_ZONE_PX)) / EDGE_SCROLL_ZONE_PX;
      return Math.ceil(ratio * EDGE_SCROLL_MAX_PX);
    }

    return 0;
  }

  function runAutoScroll() {
    if (!dragState || !bodyEl) {
      autoScrollFrame = undefined;
      return;
    }

    const delta = getEdgeScrollDelta();
    if (delta !== 0) {
      const before = bodyEl.scrollLeft;
      bodyEl.scrollLeft = Math.max(0, before + delta);

      if (bodyEl.scrollLeft !== before) {
        headerScrollLeft = bodyEl.scrollLeft;
        dragState = {
          ...dragState,
          scrollLeft: bodyEl.scrollLeft,
        };
        updateDragFromPointer();
      }
    }

    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  }

  function startAutoScroll() {
    if (!autoScrollFrame) {
      autoScrollFrame = requestAnimationFrame(runAutoScroll);
    }
  }

  function stopAutoScroll() {
    if (autoScrollFrame) {
      cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = undefined;
    }
  }

  function handleDocumentWheel(event) {
    if (dragState) {
      event.preventDefault();
    }
  }

  function addDragListeners() {
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("wheel", handleDocumentWheel, { passive: false });
  }

  function removeDragListeners() {
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", stopDrag);
    document.removeEventListener("wheel", handleDocumentWheel);
    stopAutoScroll();
  }

  function startCreateDrag(event, row) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const ts = dateFromPointer(event);
    const lockedScroll = getLockedScroll();
    dragState = {
      id: row.id,
      mode: "create",
      anchorTs: ts,
      currentTs: ts,
      lastClientX: event.clientX,
      startScrollLeft: lockedScroll.scrollLeft,
      ...lockedScroll,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    addDragListeners();
  }

  function startDrag(event, row, mode, bar) {
    if (!bar || bar.isInherited) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const lockedScroll = getLockedScroll();
    dragState = {
      id: row.id,
      mode,
      startX: event.clientX,
      startTs: bar.startTs,
      dueTs: bar.dueTs,
      effectiveDueTs: bar.effectiveDueTs,
      lastDelta: undefined,
      currentDelta: 0,
      lastClientX: event.clientX,
      startScrollLeft: lockedScroll.scrollLeft,
      ...lockedScroll,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    addDragListeners();
  }

  function handlePointerMove(event) {
    if (!dragState) {
      return;
    }

    event.preventDefault();
    dragState = {
      ...dragState,
      lastClientX: event.clientX,
    };
    updateDragFromPointer();
    startAutoScroll();
  }

  function stopDrag(event) {
    event?.preventDefault();

    const scrollLeft = bodyEl?.scrollLeft ?? dragState?.scrollLeft ?? 0;
    const scrollTop = bodyEl?.scrollTop ?? dragState?.scrollTop ?? 0;

    if (dragState?.mode === "create") {
      const range = getRangeGeometry(dragState.anchorTs, dragState.currentTs);
      commitTaskDates(dragState.id, {
        "start date": formatDate(range.start),
        "due date": formatDate(range.end),
      });
    } else if (dragState) {
      commitTaskDates(dragState.id, getDragPatch());
    }

    dragState = undefined;
    removeDragListeners();
    restoreLockedScroll(scrollLeft, scrollTop);
    requestAnimationFrame(() => restoreLockedScroll(scrollLeft, scrollTop));
  }

  function handleBodyScroll(event) {
    if (dragState) {
      headerScrollLeft = event.currentTarget.scrollLeft;
      dragState = {
        ...dragState,
        scrollLeft: event.currentTarget.scrollLeft,
        scrollTop: event.currentTarget.scrollTop,
      };
      updateDragFromPointer();
      return;
    }

    headerScrollLeft = event.currentTarget.scrollLeft;
  }

  function handleBodyWheel(event) {
    if (dragState) {
      event.preventDefault();
    }
  }

  function centerOnToday() {
    if (!bodyEl) return;
    const todayPx = todayRem * rootFontSizePx;
    const viewportWidth = bodyEl.clientWidth;
    if (!viewportWidth) return;
    // Position today around the centre of the viewport, but clamp to the
    // total scrollable width so we never scroll past either end.
    const desired = Math.max(0, todayPx - viewportWidth / 2);
    const maxScroll = Math.max(0, bodyEl.scrollWidth - viewportWidth);
    bodyEl.scrollLeft = Math.min(desired, maxScroll);
    headerScrollLeft = bodyEl.scrollLeft;
  }

  let didInitialCentre = false;
  let scaleUnsub;
  onMount(() => {
    updateRootFontSizePx();
    window.addEventListener("resize", updateRootFontSizePx);

    // Centre on today once the layout has settled. tick + 2 rAFs makes sure
    // GanttBodyInner has its real width / scrollWidth before we read them.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!didInitialCentre && totalWidthRem > 0) {
          didInitialCentre = true;
          centerOnToday();
        }
      });
    });

    // Re-centre whenever the user toggles the scale (day / week / month) —
    // pixel distances change wildly between modes so the previous
    // scrollLeft no longer points at today. Done via a manual subscription
    // (rather than `$:`) to avoid Svelte tracking lastScale as a dep and
    // re-running the block in test environments.
    let lastScale = $ganttScale;
    scaleUnsub = ganttScale.subscribe((next) => {
      if (next === lastScale) return;
      lastScale = next;
      requestAnimationFrame(() => {
        requestAnimationFrame(centerOnToday);
      });
    });

    return () => {
      window.removeEventListener("resize", updateRootFontSizePx);
      scaleUnsub?.();
    };
  });

  onDestroy(() => {
    removeDragListeners();
    stopDrag();
  });
</script>

<div class="GanttRoot" class:DraggingTimeline={!!dragState} class:DarkTheme={$theme === "dark"}>
  <!-- Scale toggle + header -->
  <div class="GanttHeader">
    <div class="GanttTitleRow">
      <span class="GanttTitle">Gantt</span>
      <div class="ScaleButtons" role="group" aria-label="表示スケール">
        <button
          type="button"
          class="ScaleBtn"
          class:active={$ganttScale === "day"}
          aria-label="日表示"
          aria-pressed={$ganttScale === "day"}
          title="日表示"
          on:click={() => ($ganttScale = "day")}>日</button
        >
        <button
          type="button"
          class="ScaleBtn"
          class:active={$ganttScale === "week"}
          aria-label="週表示"
          aria-pressed={$ganttScale === "week"}
          title="週表示"
          on:click={() => ($ganttScale = "week")}>週</button
        >
        <button
          type="button"
          class="ScaleBtn"
          class:active={$ganttScale === "month"}
          aria-label="月表示"
          aria-pressed={$ganttScale === "month"}
          title="月表示"
          on:click={() => ($ganttScale = "month")}>月</button
        >
      </div>
    </div>
    <div class="TimelineHeaderViewport">
      <div
        class="TimelineHeader"
        style="width:{totalWidthRem}rem; transform: translateX(-{headerScrollLeft}px);"
      >
        {#each headerCells as cell}
          <div
            class="HeaderCell"
            class:PastCell={cell.tone === "past"}
            class:TodayCell={cell.tone === "today"}
            class:FutureCell={cell.tone === "future"}
            class:WeekendCell={cell.weekend}
            style="left:{cell.leftRem}rem; width:{cell.widthRem}rem;"
          >
            <span class="HeaderCellDate">{cell.label}</span>
            {#if cell.weekdayLabel}
              <span class="HeaderCellWeekday">{cell.weekdayLabel}</span>
            {/if}
          </div>
        {/each}
        <!-- Today line + 1-day highlight in header -->
        {#if todayRem >= 0 && todayRem <= totalWidthRem}
          <div
            class="TodayDayHeader"
            style="left:{todayRem}rem; width:{remPerDay}rem;"
          ></div>
          <div class="TodayLine" style="left:{todayRem}rem;"></div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Body: rows synced with TreeTable -->
  <div
    class="GanttBody"
    bind:this={bodyEl}
    on:scroll={handleBodyScroll}
    on:wheel|nonpassive={handleBodyWheel}
  >
    <div class="GanttBodyInner" style="width:{totalWidthRem}rem; height:{rows.length * 2.5}rem;">
      {#each headerCells as cell}
        <div
          class="GridCell"
          class:PastCell={cell.tone === "past"}
          class:TodayCell={cell.tone === "today"}
          class:FutureCell={cell.tone === "future"}
          class:WeekendCell={cell.weekend}
          style="left:{cell.leftRem}rem; width:{cell.widthRem}rem;"
        ></div>
      {/each}
      <!-- Today 1-day cell + line in body -->
      {#if todayRem >= 0 && todayRem <= totalWidthRem}
        <div
          class="TodayDayBody"
          style="left:{todayRem}rem; width:{remPerDay}rem;"
        ></div>
        <div class="TodayLineFull" style="left:{todayRem}rem;"></div>
      {/if}
      {#each rows as row (row.id)}
        {@const bar = getBarStyle(row, dragState, remPerDay, todayRem, todayTs, timelineStart)}
        {@const preview = getCreatePreview(row, dragState, remPerDay, timelineStart)}
        <div
          class="GanttRow"
          data-row-id={row.id}
          role="presentation"
          on:pointerdown={(event) => startCreateDrag(event, row)}
          on:dblclick={(event) => createRange(event, row, bar)}
        >
          {#if preview}
            <div
              class="CreatePreview"
              style="left:{preview.leftRem}rem; width:{preview.widthRem}rem;"
              aria-hidden="true"
            >
              <span class="PreviewEdge StartEdge"></span>
              <span class="PreviewEdge EndEdge"></span>
            </div>
          {/if}
          {#if bar}
            <button
              type="button"
              class="Bar"
              class:DueMarker={bar.isDue}
              class:StartMarker={bar.isStartOnly}
              class:Inherited={bar.isInherited}
              class:DraggingBar={dragState?.id === row.id && dragState.mode !== "create"}
              style="left:{bar.leftRem}rem; width:{bar.widthRem}rem; background:{bar.color}; opacity:{bar.opacity};"
              aria-label={bar.isDue
                ? "期限日を変更"
                : bar.isStartOnly
                  ? "開始日を変更"
                  : "期間を移動"}
              title={bar.isDue
                ? "期限日を変更"
                : bar.isStartOnly
                  ? "開始日を変更"
                  : "期間を移動"}
              disabled={bar.isInherited}
              on:pointerdown={(event) =>
                startDrag(event, row, bar.isStartOnly ? "start" : "move", bar)}
            ></button>
            {#if bar.overdue}
              <div
                class="OverdueSegment"
                style="left:{bar.overdue.leftRem}rem; width:{bar.overdue
                  .widthRem}rem; background:{bar.overdue.color}; opacity:{bar.opacity};"
                aria-hidden="true"
              ></div>
            {/if}
            {#if !bar.isDue && !bar.isStartOnly && !bar.isInherited}
              <button
                class="BarHandle StartHandle"
                aria-label="開始日を変更"
                title="開始日を変更"
                style="left:{bar.leftRem}rem;"
                on:pointerdown={(event) => startDrag(event, row, "start", bar)}
              ></button>
              <button
                class="BarHandle EndHandle"
                aria-label="期限日を変更"
                title="期限日を変更"
                style="left:{bar.leftRem + bar.widthRem}rem;"
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
    --gantt-header-bg: var(--theme-color-Primary-dark);
    --gantt-header-fg: var(--theme-color-Main-light);
    --gantt-header-border: color-mix(in srgb, var(--theme-color-Primary-dark) 82%, black);
    --gantt-header-active: var(--theme-color-Primary-main);
    --gantt-grid-line: color-mix(in srgb, var(--theme-color-Sub-dark) 16%, transparent);
    --gantt-grid-line-strong: color-mix(in srgb, var(--theme-color-Sub-dark) 26%, transparent);
    --gantt-row-hover: color-mix(in srgb, var(--theme-color-Primary-main) 8%, transparent);

    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--gantt-grid-line-strong);
    background: var(--theme-color-Main-main);
    min-width: 120px;
  }

  .GanttRoot.DarkTheme {
    --gantt-header-bg: var(--theme-color-Primary-light);
    --gantt-header-border: color-mix(in srgb, var(--theme-color-Primary-light) 82%, black);
  }

  .GanttRoot.DraggingTimeline,
  .GanttRoot.DraggingTimeline :global(*) {
    user-select: none;
  }

  .GanttHeader {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    height: 3rem;
    box-sizing: border-box;
    border-bottom: 1px solid var(--gantt-header-border);
    background: var(--gantt-header-bg);
    color: var(--gantt-header-fg);
    position: sticky;
    top: 0;
    z-index: 10;
    overflow: visible;
  }

  /* Scale buttons float in the top-right corner of the gantt area, above the timeline header */
  .GanttTitleRow {
    position: absolute;
    top: 2px;
    right: 2px;
    display: flex;
    height: calc(3rem - 4px);
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    padding: 0;
    box-sizing: border-box;
    background: var(--gantt-header-bg);
    color: var(--gantt-header-fg);
    z-index: 11;
    border-radius: var(--shape-xs);
    box-shadow: -4px 0 8px -4px var(--gantt-header-bg);
  }

  .GanttTitle {
    display: none;
  }

  .ScaleButtons {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    flex-shrink: 0;
    padding: 2px;
    border-radius: var(--shape-xs);
    background-color: color-mix(in srgb, var(--theme-color-Main-main) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--theme-color-Main-main) 35%, transparent);
  }
  .ScaleBtn {
    appearance: none;
    border: none;
    background-color: transparent;
    color: var(--gantt-header-fg);
    font-size: var(--font-label-md);
    font-weight: 600;
    line-height: 1;
    padding: 0;
    margin: 0;
    width: 1.8rem;
    min-width: 1.8rem;
    height: 1.6rem;
    border-radius: var(--shape-xs);
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease,
      box-shadow 0.12s ease;
  }
  .ScaleBtn:hover {
    background-color: color-mix(in srgb, var(--theme-color-Main-main) 22%, transparent);
  }
  .ScaleBtn.active {
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Primary-dark);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--theme-color-Primary-dark) 30%, transparent);
  }
  .ScaleBtn:focus-visible {
    outline: 2px solid var(--theme-color-Main-light);
    outline-offset: 1px;
  }

  .TimelineHeaderViewport {
    flex: 1 1 auto;
    height: 100%;
    overflow: hidden;
    position: relative;
    background: var(--gantt-header-bg);
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
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 0 1px;
    font-size: var(--font-label-sm);
    font-weight: normal;
    line-height: 1.05;
    color: var(--gantt-header-fg);
    border-right: 1px solid var(--gantt-header-border);
    background: var(--gantt-header-bg);
    white-space: nowrap;
    overflow: hidden;
    box-sizing: border-box;
    text-align: center;
  }

  .HeaderCellDate,
  .HeaderCellWeekday {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: clip;
  }
  .HeaderCell.PastCell {
    background-color: color-mix(in srgb, var(--gantt-header-fg) 12%, var(--gantt-header-bg));
  }
  .GridCell.PastCell {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 7%, transparent);
  }
  .HeaderCell.FutureCell {
    background-color: var(--gantt-header-bg);
  }
  .GridCell.FutureCell {
    background-color: color-mix(in srgb, var(--theme-color-Main-main) 80%, transparent);
  }
  .HeaderCell.WeekendCell {
    background-color: color-mix(in srgb, var(--gantt-header-border) 18%, var(--gantt-header-bg));
  }
  .GridCell.WeekendCell {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  /* In day mode the cell width equals one day so the cell-level highlight
     IS the day-level highlight. In week / month modes we suppress the wide
     cell highlight and instead render a 1-day-wide overlay (TodayDayHeader /
     TodayDayBody) at the exact today position so the user can spot today
     precisely. */
  .HeaderCell.TodayCell {
    background-color: transparent;
  }
  .GridCell.TodayCell {
    background-color: transparent;
  }

  .TodayDayHeader {
    position: absolute;
    top: 0;
    bottom: 0;
    /* Use the Accent token: it's a saturated pink/magenta that contrasts
       cleanly with the Primary-blue gantt header in both themes, and
       isn't reserved for error/overdue semantics. */
    background-color: var(--theme-color-Accent-main);
    pointer-events: none;
    z-index: 5;
    /* In week / month modes a single day is only a few pixels wide; bump
       the visible minimum to 8px so it's still recognizable. */
    min-width: 8px;
    box-shadow: 0 0 0 1px var(--theme-color-Accent-dark);
  }
  .TodayDayBody {
    position: absolute;
    top: 0;
    bottom: 0;
    background-color: color-mix(in srgb, var(--theme-color-Accent-main) 22%, transparent);
    pointer-events: none;
    /* Above GridCell (0) and GanttRow (1) so the today fill is never
       hidden by a transparent row. */
    z-index: 2;
    min-width: 8px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-color-Accent-main) 55%, transparent);
  }

  .TodayLine {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    /* Accent instead of Primary: in dark theme Primary-main is nearly
       indistinguishable from the gantt header background. */
    background: var(--theme-color-Accent-main);
    opacity: 1;
    z-index: 6;
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
    border-right: 1px solid var(--gantt-grid-line-strong);
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
    opacity: 0.6;
    pointer-events: none;
    z-index: 5;
  }

  .GanttRow {
    height: 2.5rem;
    min-height: 2.5rem;
    max-height: 2.5rem;
    box-sizing: border-box;
    position: relative;
    border-bottom: 1px solid var(--theme-color-Main-dark);
    cursor: crosshair;
    touch-action: none;
    z-index: 1;
  }

  .GanttRow:hover {
    background-color: var(--gantt-row-hover);
  }

  .CreatePreview {
    position: absolute;
    top: 20%;
    height: 60%;
    min-width: 0.5rem;
    border: 1px solid var(--theme-color-Primary-main);
    border-radius: var(--shape-xs);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 44%, transparent);
    pointer-events: none;
    z-index: 6;
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--theme-color-Main-main) 72%, transparent),
      0 0.2rem 0.45rem rgba(0, 0, 0, 0.22);
  }

  .PreviewEdge {
    position: absolute;
    top: -0.25rem;
    bottom: -0.25rem;
    width: 2px;
    background-color: var(--theme-color-Primary-main);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--theme-color-Main-main) 65%, transparent);
  }

  .StartEdge {
    left: 0;
  }

  .EndEdge {
    right: 0;
  }

  .Bar {
    position: absolute;
    top: 25%;
    height: 50%;
    border: none;
    border-radius: var(--shape-xs);
    min-width: 2px;
    cursor: grab;
    z-index: 3;
    padding: 0;
    touch-action: none;
  }

  .Bar:not(.Inherited):active {
    cursor: grabbing;
  }

  .Bar.DraggingBar {
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--theme-color-Main-main) 72%, transparent),
      0 0.2rem 0.45rem rgba(0, 0, 0, 0.25);
    z-index: 5;
  }

  .OverdueSegment {
    position: absolute;
    top: 25%;
    height: 50%;
    border-radius: var(--shape-xs);
    pointer-events: none;
    z-index: 3;
  }

  .Bar.Inherited {
    pointer-events: none;
  }

  .Bar.DueMarker {
    top: 22%;
    height: 56%;
    border-radius: 999px;
  }

  .Bar.StartMarker {
    top: 22%;
    height: 56%;
    border-radius: 999px;
    /* Subtle outline so the user can tell start-only marker from due-only marker. */
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--theme-color-Main-main) 65%, transparent);
  }

  .BarHandle {
    position: absolute;
    top: 20%;
    width: var(--sp2);
    height: 60%;
    border: none;
    border-radius: var(--shape-xs);
    background: color-mix(in srgb, var(--theme-color-Main-main) 70%, transparent);
    cursor: ew-resize;
    padding: 0;
    touch-action: none;
    z-index: 4;
  }

  .StartHandle {
    transform: translateX(-50%);
  }

  .EndHandle {
    transform: translateX(-50%);
  }
</style>
