<script lang="ts">
  import type { WorkspaceTask } from "@app-types/workspace";
  import {
    buildNodeSchedule,
    isValidIsoDate,
    scheduleDate,
    type NodeScheduleRow,
  } from "@features/gantt/utils/node_schedule";

  export let nodes: Record<string, WorkspaceTask> = {};
  export let rootId = "";
  export let selectedId: string | undefined = undefined;
  export let onSelect: (id: string) => void = () => {};
  export let onUpdate: (
    id: string,
    patch: { startDate?: string; dueDate?: string }
  ) => Promise<void> | void = () => {};
  export let showArchived = false;

  let message = "";
  let updating = new Set<string>();

  $: rows = buildNodeSchedule(nodes, rootId, { showArchived });
  $: datedRows = rows.filter((row) => row.kind === "bar" || row.kind === "point");
  $: statusRows = rows.filter((row) => row.kind === "status-only");
  $: dates = datedRows
    .flatMap((row) => [row.startDate, row.dueDate].filter(Boolean) as string[])
    .filter(isValidIsoDate)
    .sort();
  $: rangeStart = dates[0];
  $: rangeEnd = dates[dates.length - 1];

  function datePosition(date: string | undefined): number {
    if (!date || !rangeStart || !rangeEnd) return 0;
    const start = Date.parse(`${rangeStart}T00:00:00Z`);
    const end = Date.parse(`${rangeEnd}T00:00:00Z`);
    const value = Date.parse(`${date}T00:00:00Z`);
    const edgePadding = 4;
    return end === start
      ? 50
      : edgePadding + ((value - start) / (end - start)) * (100 - edgePadding * 2);
  }

  async function updateDate(row: NodeScheduleRow, field: "startDate" | "dueDate", value: string) {
    const other = field === "startDate" ? row.dueDate : row.startDate;
    if (value && !isValidIsoDate(value)) {
      message = "日付は YYYY-MM-DD 形式で入力してください";
      return;
    }
    if (
      (field === "startDate" && value && other && isValidIsoDate(other) && other < value) ||
      (field === "dueDate" && value && other && isValidIsoDate(other) && value < other)
    ) {
      message = "期限日は開始日以降にしてください";
      return;
    }
    message = "";
    updating = new Set(updating).add(row.id);
    try {
      await onUpdate(row.id, { [field]: value || undefined });
    } catch (error) {
      message = error instanceof Error ? error.message : "日付を更新できませんでした";
    } finally {
      const next = new Set(updating);
      next.delete(row.id);
      updating = next;
    }
  }
</script>

<section class="NodeGanttRoot" aria-label="ノードガント">
  <header class="NodeGanttHeader">
    <h2>ノードの予定</h2>
    <span>{rows.length} 件</span>
  </header>
  {#if message}<p class="NodeGanttMessage" role="alert">{message}</p>{/if}
  {#if rows.length === 0}
    <p class="NodeGanttEmpty" role="status">表示できるノードがありません。</p>
  {:else}
    <div class="NodeGanttScroll" role="region" aria-label="予定一覧">
      <div class="NodeGanttRows">
        {#if rangeStart}
          <div class="NodeGanttAxis" aria-label="日付の目盛り">
            <span>{rangeStart}</span><span>{rangeEnd}</span>
          </div>
        {/if}
        {#each rows.filter((row) => row.kind !== "status-only") as row (row.id)}
          <article class:selected={row.id === selectedId} class="NodeGanttRow" data-row-id={row.id}>
            <button class="NodeGanttName" type="button" on:click={() => onSelect(row.id)}
              >{row.task.name}</button
            >
            <div class="NodeGanttDates">
              <label
                >開始 <input
                  aria-label={`${row.task.name} の開始日`}
                  type="date"
                  value={row.startDate ?? ""}
                  disabled={updating.has(row.id)}
                  on:change={(event) => updateDate(row, "startDate", event.currentTarget.value)}
                /></label
              >
              <label
                >期限 <input
                  aria-label={`${row.task.name} の期限日`}
                  type="date"
                  value={row.dueDate ?? ""}
                  disabled={updating.has(row.id)}
                  on:change={(event) => updateDate(row, "dueDate", event.currentTarget.value)}
                /></label
              >
            </div>
            <div
              class="NodeGanttTrack"
              aria-label={row.kind === "status-only" ? "日付未設定" : undefined}
            >
              {#if row.kind === "bar"}
                <span
                  class="NodeGanttBar"
                  style={`left:${datePosition(row.startDate)}%;width:${Math.max(1, datePosition(row.dueDate) - datePosition(row.startDate))}%`}
                ></span>
              {:else if row.kind === "point"}
                <span class="NodeGanttPoint" style={`left:${datePosition(scheduleDate(row))}%`}
                ></span>
              {:else if row.kind === "status-only"}
                <span class="NodeGanttUnset">日付未設定</span>
              {:else}
                <span class="NodeGanttError" role="alert">{row.error}</span>
              {/if}
            </div>
          </article>
        {/each}
        {#if statusRows.length}
          <h3 class="NodeGanttSectionTitle">日付未設定</h3>
          {#each statusRows as row (row.id)}
            <article
              class:selected={row.id === selectedId}
              class="NodeGanttRow"
              data-row-id={row.id}
            >
              <button class="NodeGanttName" type="button" on:click={() => onSelect(row.id)}
                >{row.task.name}</button
              >
              <div class="NodeGanttDates">
                <label
                  >開始 <input
                    aria-label={`${row.task.name} の開始日`}
                    type="date"
                    value=""
                    disabled={updating.has(row.id)}
                    on:change={(event) => updateDate(row, "startDate", event.currentTarget.value)}
                  /></label
                >
                <label
                  >期限 <input
                    aria-label={`${row.task.name} の期限日`}
                    type="date"
                    value=""
                    disabled={updating.has(row.id)}
                    on:change={(event) => updateDate(row, "dueDate", event.currentTarget.value)}
                  /></label
                >
              </div>
              <div class="NodeGanttTrack"><span class="NodeGanttUnset">日付未設定</span></div>
            </article>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .NodeGanttRoot {
    display: flex;
    flex-direction: column;
    min-height: 0;
    color: var(--theme-color-Sub-main);
    background: var(--theme-color-Main-main);
  }
  .NodeGanttHeader {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp3) var(--sp4);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 16%, transparent);
  }
  h2 {
    margin: 0;
    font-size: var(--font-title-md);
  }
  .NodeGanttHeader span {
    opacity: 0.65;
    font-size: var(--font-label-md);
  }
  .NodeGanttMessage,
  .NodeGanttEmpty {
    margin: var(--sp3) var(--sp4);
  }
  .NodeGanttMessage,
  .NodeGanttError {
    color: var(--theme-color-Error-main);
  }
  .NodeGanttScroll {
    overflow: auto;
    min-height: 8rem;
  }
  .NodeGanttRows {
    min-width: 52rem;
  }
  .NodeGanttAxis {
    display: grid;
    grid-template-columns: minmax(12rem, 18rem) 17rem minmax(24rem, 1fr);
    gap: var(--sp3);
    padding: var(--sp2) var(--sp4) 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-sm);
    opacity: 0.7;
  }
  .NodeGanttAxis span:first-child {
    grid-column: 3;
    justify-self: start;
    margin-left: 4%;
  }
  .NodeGanttAxis span:last-child {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
    margin-right: 4%;
  }
  .NodeGanttSectionTitle {
    margin: var(--sp4) var(--sp4) var(--sp1);
    font-size: var(--font-label-md);
    color: var(--theme-color-Sub-main);
  }
  .NodeGanttRow {
    display: grid;
    grid-template-columns: minmax(12rem, 18rem) 17rem minmax(24rem, 1fr);
    align-items: center;
    gap: var(--sp3);
    min-height: 3.25rem;
    padding: var(--sp2) var(--sp4);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 10%, transparent);
  }
  .NodeGanttRow.selected {
    background: color-mix(in srgb, var(--theme-color-Primary-main) 10%, transparent);
  }
  .NodeGanttName {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  .NodeGanttName:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
  }
  .NodeGanttDates {
    display: flex;
    gap: var(--sp2);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--font-label-sm);
    opacity: 0.8;
  }
  input {
    width: 7.25rem;
  }
  .NodeGanttTrack {
    position: relative;
    height: 1.5rem;
    border-radius: var(--shape-xs);
    background: color-mix(in srgb, var(--theme-color-Sub-main) 8%, transparent);
  }
  .NodeGanttBar {
    position: absolute;
    top: 25%;
    height: 50%;
    border-radius: 999px;
    background: var(--theme-color-Primary-main);
  }
  .NodeGanttPoint {
    position: absolute;
    top: 15%;
    width: 0.8rem;
    height: 0.8rem;
    transform: translateX(-50%);
    border-radius: 50%;
    background: var(--theme-color-Info-main);
  }
  .NodeGanttUnset {
    padding: 0 var(--sp2);
    font-size: var(--font-label-sm);
    opacity: 0.65;
  }
  .NodeGanttError {
    padding: 0 var(--sp2);
    font-size: var(--font-label-sm);
  }
</style>
