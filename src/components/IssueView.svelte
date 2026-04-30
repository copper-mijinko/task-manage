<script lang="ts">
  import { filtered_data, table_selected_id } from "../stores.ts";
  import type { TaskStatus, TreeData } from "../common/tree_control.ts";

  type IssueItem = {
    id: string;
    name: string;
    status: TaskStatus;
    dueDate: string | undefined;
    path: string[];
  };

  type StatusFilter = TaskStatus | "All";

  const STATUSES: TaskStatus[] = ["Open", "Pending", "In Progress", "Completed", "Canceled"];

  const STATUS_COLORS: Record<TaskStatus, string> = {
    Open: "var(--theme-color-Sub-light)",
    Pending: "var(--theme-color-Warning-main)",
    "In Progress": "var(--theme-color-Primary-main)",
    Completed: "var(--theme-color-Success-main)",
    Canceled: "var(--theme-color-Error-main)",
  };

  let statusFilter: StatusFilter = "All";

  function collectIssues(node: TreeData, path: string[]): IssueItem[] {
    const result: IssueItem[] = [];
    for (const child of node.children ?? []) {
      const name = child.data.name || "(Untitled)";
      result.push({
        id: child.id,
        name,
        status: child.data.status,
        dueDate: child.data["due date"],
        path,
      });
      result.push(...collectIssues(child, [...path, name]));
    }
    return result;
  }

  $: issues = $filtered_data ? collectIssues($filtered_data, []) : [];
  $: displayed = statusFilter === "All" ? issues : issues.filter((i) => i.status === statusFilter);
  $: counts = Object.fromEntries(
    (["All", ...STATUSES] as StatusFilter[]).map((s) => [
      s,
      s === "All" ? issues.length : issues.filter((i) => i.status === s).length,
    ])
  );

  const DAYS_5_MS = 5 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function dueDateUrgency(dueDate: string | undefined, status: TaskStatus): string | null {
    if (!dueDate || status === "Completed" || status === "Canceled") return null;
    const diff = new Date(dueDate).getTime() - Date.now() + DAY_MS - 1;
    if (diff < 0) return "overdue";
    if (diff < DAYS_5_MS) return "due-soon";
    return null;
  }
</script>

<div class="IssueView">
  <div class="FilterTabs">
    {#each ["All", ...STATUSES] as s}
      <button
        class="FilterTab"
        class:active={statusFilter === s}
        on:click={() => (statusFilter = s as StatusFilter)}
      >
        {s}
        <span class="Count">{counts[s]}</span>
      </button>
    {/each}
  </div>

  <div class="IssueList">
    {#if displayed.length === 0}
      <div class="Empty">No issues</div>
    {:else}
      {#each displayed as issue (issue.id)}
        {@const urgency = dueDateUrgency(issue.dueDate, issue.status)}
        <button
          class="IssueRow"
          class:selected={$table_selected_id === issue.id}
          on:click={() => ($table_selected_id = issue.id)}
          id={issue.id}
        >
          <span class="StatusIcon" style="color: {STATUS_COLORS[issue.status] ?? 'inherit'}">
            {#if issue.status === "Open"}
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else if issue.status === "Pending"}
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12 12H12.01M16 12H16.01M8 12H8.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else if issue.status === "In Progress"}
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12 21C16.9706 21 21 16.9706 21 12H12V3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else if issue.status === "Completed"}
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 12.3333L10.4615 15L16 9M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else if issue.status === "Canceled"}
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M9 9L15 15M15 9L9 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {/if}
          </span>

          <div class="IssueContent">
            <span class="IssueName">{issue.name}</span>
            {#if issue.path.length > 0}
              <span class="IssuePath">{issue.path.join(" / ")}</span>
            {/if}
          </div>

          {#if issue.dueDate}
            <span
              class="DueDate"
              class:overdue={urgency === "overdue"}
              class:due-soon={urgency === "due-soon"}
            >
              {issue.dueDate}
            </span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .IssueView {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .FilterTabs {
    display: flex;
    flex-direction: row;
    gap: 0.125rem;
    padding: 0.5rem 0.5rem 0;
    flex-shrink: 0;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--theme-color-Sub-main);
    margin-bottom: 0.5rem;
  }

  .FilterTab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0.375rem 0.375rem 0 0;
    background: transparent;
    color: var(--theme-color-Sub-light);
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.15s;
    margin-bottom: -1px;
  }

  .FilterTab:hover {
    background: var(--theme-color-Shadow-main);
    color: var(--theme-color-Main-light);
  }

  .FilterTab.active {
    color: var(--theme-color-Main-light);
    border-bottom-color: var(--theme-color-Primary-main);
  }

  .Count {
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 1rem;
    background: var(--theme-color-Shadow-sub);
  }

  .IssueList {
    flex: 1;
    overflow-y: auto;
    padding: 0 0.5rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .IssueRow {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    background: transparent;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.1s;
    box-sizing: border-box;
  }

  .IssueRow:hover {
    background: var(--theme-color-Shadow-main);
    border-color: var(--theme-color-Sub-main);
  }

  .IssueRow.selected {
    background: var(--theme-color-Shadow-sub);
    border-color: var(--theme-color-Primary-main);
  }

  .StatusIcon {
    flex-shrink: 0;
    width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
  }

  .StatusIcon svg {
    width: 100%;
    height: 100%;
  }

  .IssueContent {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .IssueName {
    font-size: 0.9rem;
    color: var(--theme-color-Main-light);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .IssuePath {
    font-size: 0.75rem;
    color: var(--theme-color-Sub-light);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 0.1rem;
  }

  .DueDate {
    flex-shrink: 0;
    font-size: 0.8rem;
    color: var(--theme-color-Sub-light);
  }

  .DueDate.overdue {
    color: var(--theme-color-Error-main);
    font-weight: 600;
  }

  .DueDate.due-soon {
    color: var(--theme-color-Warning-main);
  }

  .Empty {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 3rem;
    color: var(--theme-color-Sub-main);
    font-size: 0.9rem;
  }
</style>
