<script>
  import { onMount } from "svelte";
  import Card from "@lib/primitives/Card.svelte";
  import Loading from "@lib/primitives/Loading.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import SegmentedControl from "@lib/primitives/SegmentedControl.svelte";
  import { selected_id, selected_type, sidebarCollapsed } from "@stores";
  import { setPendingTaskDetailSelection } from "@stores/ui";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { active_tag } from "@features/memos/stores/tags";
  import { agenda_store, BUCKET_LABELS, BUCKET_ORDER } from "@features/agenda/stores/agenda";

  const STATUS_LABELS = {
    Open: "未着手",
    Pending: "保留",
    "In Progress": "進行中",
    Completed: "完了",
    Canceled: "キャンセル",
  };

  const STATUS_COLORS = {
    Open: "var(--theme-color-Primary-main)",
    "In Progress": "var(--theme-color-Info-main)",
    Pending: "var(--theme-color-Warning-main)",
    Completed: "var(--theme-color-Success-main)",
    Canceled: "var(--theme-color-Sub-main)",
  };

  const SCOPE_OPTIONS = [
    { value: "due", label: "期限あり" },
    { value: "all", label: "すべて" },
  ];

  let scope = "due";
  let query = "";

  $: workspaceReady = Boolean($workspace_store.activeWorkspacePath);
  $: projectCount = $workspace_store.projects?.length ?? 0;
  $: normalizedQuery = query.trim().toLocaleLowerCase();
  $: visibleItems = $agenda_store.items
    .filter((item) => (scope === "all" ? true : Boolean(item.dueDate)))
    .filter((item) => {
      if (!normalizedQuery) return true;
      return (
        item.name.toLocaleLowerCase().includes(normalizedQuery) ||
        item.projectName.toLocaleLowerCase().includes(normalizedQuery) ||
        item.tags.some((tag) => tag.includes(normalizedQuery))
      );
    });
  $: groups = BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    items: visibleItems.filter((item) => item.bucket === bucket),
  })).filter((group) => group.items.length > 0);
  $: overdueCount = $agenda_store.items.filter((item) => item.bucket === "overdue").length;
  $: todayCount = $agenda_store.items.filter((item) => item.bucket === "today").length;

  onMount(() => {
    void agenda_store.load();
  });

  function dueLabel(item) {
    if (!item.dueDate) return "期限なし";
    if (item.daysLeft === 0) return `${item.dueDate}（今日）`;
    if (item.daysLeft === 1) return `${item.dueDate}（明日）`;
    if (item.daysLeft < 0) return `${item.dueDate}（${Math.abs(item.daysLeft)}日超過）`;
    return `${item.dueDate}（あと${item.daysLeft}日）`;
  }

  /**
   * 行を開く。プロジェクトを切り替えたうえで、読み込み完了後に
   * そのタスクを選択させる（読み込みは非同期なので pending 経由で渡す）。
   */
  function openItem(item) {
    setPendingTaskDetailSelection({
      projectId: item.projectRootId,
      taskId: item.taskId,
      selectedType: "WorkspaceProject",
      projectDir: item.projectDir,
    });
    workspace_store.setActiveProject(item.projectDir);
    $selected_type = "WorkspaceProject";
    $selected_id = item.projectRootId;
    $sidebarCollapsed = true;
  }

  function openTag(tag) {
    $active_tag = tag;
  }
</script>

<div class="AgendaRoot">
  <Card title="予定" padded={false} style="height: 100%; width: 100%;">
    <svelte:fragment slot="header-actions">
      <span class="HeaderSummary">
        {#if overdueCount > 0}
          <span class="HeaderBadge Overdue">期限切れ {overdueCount}</span>
        {/if}
        <span class="HeaderBadge">今日 {todayCount}</span>
      </span>
      <IconButton
        ariaLabel="予定を再読み込み"
        tooltipContent="再読み込み"
        variant="text"
        normalColor={"var(--theme-color-Sub-main)"}
        activeColor={"var(--theme-color-Primary-main)"}
        on:click={() => agenda_store.load()}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 11A8 8 0 1 0 18.4 16M20 6v5h-5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </IconButton>
    </svelte:fragment>

    {#if !workspaceReady}
      <div class="EmptyState">
        <h2>ワークスペースがありません</h2>
        <p>ワークスペースを設定すると、全プロジェクトの予定をまとめて確認できます。</p>
      </div>
    {:else}
      <div class="Toolbar">
        <SegmentedControl
          options={SCOPE_OPTIONS}
          value={scope}
          ariaLabel="表示範囲"
          on:change={(event) => (scope = event.detail.value)}
        />
        <input
          class="AgendaSearch"
          type="search"
          bind:value={query}
          placeholder="タスク・プロジェクト・タグで絞り込み"
          aria-label="予定を絞り込み"
        />
        <span class="ToolbarCount">{visibleItems.length}件 / {projectCount}プロジェクト</span>
      </div>

      {#if $agenda_store.failedProjects.length > 0}
        <div class="LoadWarning" role="status">
          読み込めなかったプロジェクト: {$agenda_store.failedProjects.join("、")}
        </div>
      {/if}

      {#if $agenda_store.loading && $agenda_store.items.length === 0}
        <Loading />
      {:else if groups.length === 0}
        <div class="EmptyState">
          <svg class="EmptyIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 4h14v16H5z" />
            <path d="M9 3v3M15 3v3M5 9h14M9 13h6M9 17h4" />
          </svg>
          <h2>表示する予定はありません</h2>
          <p>
            {#if scope === "due"}
              期限の付いた未完了タスクがありません。「すべて」に切り替えると期限なしのタスクも表示します。
            {:else}
              未完了のタスクがありません。
            {/if}
          </p>
        </div>
      {:else}
        <div class="GroupList">
          {#each groups as group (group.bucket)}
            <section class="Group" aria-label={group.label}>
              <h3 class="GroupHeader" class:Overdue={group.bucket === "overdue"}>
                <span class="GroupTitle">{group.label}</span>
                <span class="GroupCount">{group.items.length}</span>
              </h3>
              <ul class="Items">
                {#each group.items as item (item.projectDir + item.taskId)}
                  <li>
                    <button type="button" class="Item" on:click={() => openItem(item)}>
                      <span
                        class="StatusDot"
                        style={`--dot-color: ${STATUS_COLORS[item.status] ?? "var(--theme-color-Sub-main)"}`}
                        title={STATUS_LABELS[item.status] ?? item.status}
                      ></span>
                      <span class="ItemMain">
                        <span class="ItemName">{item.name}</span>
                        <span class="ItemMeta">
                          <span class="ProjectName">{item.projectName}</span>
                          {#if item.parentPath}
                            <span class="ParentPath">/ {item.parentPath}</span>
                          {/if}
                          <span class="StatusText">{STATUS_LABELS[item.status] ?? item.status}</span
                          >
                        </span>
                      </span>
                      {#if item.tags.length > 0}
                        <span class="ItemTags">
                          {#each item.tags.slice(0, 3) as tag (tag)}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <span
                              class="TagChip"
                              title={`タグ ${tag} で絞り込む`}
                              on:click|stopPropagation={() => openTag(tag)}
                            >
                              {tag}
                            </span>
                          {/each}
                        </span>
                      {/if}
                      <span class="ItemDue" class:Overdue={item.bucket === "overdue"}>
                        {dueLabel(item)}
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}
    {/if}
  </Card>
</div>

<style>
  .AgendaRoot {
    display: flex;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: var(--pane-pad);
    overflow: hidden;
  }

  .HeaderSummary {
    display: inline-flex;
    align-items: center;
    gap: var(--sp2);
    margin-right: var(--sp2);
  }

  .HeaderBadge {
    padding: 0 var(--sp2);
    border-radius: var(--shape-pill);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-sm);
    font-weight: 600;
    white-space: nowrap;
  }

  .HeaderBadge.Overdue {
    background-color: color-mix(in srgb, var(--theme-color-Error-main) 22%, transparent);
    color: var(--theme-color-Error-text);
  }

  .Toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    flex-wrap: wrap;
    padding: var(--sp2) var(--sp3);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 35%, transparent);
  }

  .AgendaSearch {
    flex: 1 1 12rem;
    min-width: 8rem;
    height: 1.75rem;
    padding: 0 var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
  }

  .ToolbarCount {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    font-size: var(--font-label-md);
    white-space: nowrap;
  }

  .LoadWarning {
    padding: var(--sp1) var(--sp3);
    background-color: color-mix(in srgb, var(--theme-color-Warning-main) 18%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
  }

  .GroupList {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--sp4);
  }

  .Group {
    display: block;
  }

  .GroupHeader {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--sp2);
    margin: 0;
    padding: var(--sp1) var(--sp3);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 30%, transparent);
    background-color: color-mix(
      in srgb,
      var(--theme-color-Sub-dark) 12%,
      var(--theme-color-Main-main)
    );
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .GroupHeader.Overdue {
    color: var(--theme-color-Error-text);
  }

  .GroupCount {
    padding: 0 var(--sp2);
    border-radius: var(--shape-pill);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 14%, transparent);
    font-size: var(--font-label-sm);
  }

  .Items {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .Item {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    width: 100%;
    padding: var(--sp2) var(--sp3);
    border: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 18%, transparent);
    background: transparent;
    color: var(--theme-color-Sub-main);
    text-align: left;
    cursor: pointer;
  }

  .Item:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 10%, transparent);
  }

  .StatusDot {
    flex: 0 0 auto;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background-color: var(--dot-color);
  }

  .ItemMain {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }

  .ItemName {
    overflow: hidden;
    font-size: var(--font-body-md);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ItemMeta {
    display: flex;
    gap: var(--sp2);
    min-width: 0;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
    font-size: var(--font-label-md);
    overflow: hidden;
    white-space: nowrap;
  }

  .ProjectName {
    font-weight: 600;
  }

  .ParentPath,
  .StatusText {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ItemTags {
    display: flex;
    flex: 0 1 auto;
    gap: var(--sp1);
    overflow: hidden;
  }

  .TagChip {
    padding: 0 var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 55%, transparent);
    border-radius: var(--shape-pill);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 14%, transparent);
    font-size: var(--font-label-sm);
    white-space: nowrap;
  }

  .ItemDue {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 75%, transparent);
    font-size: var(--font-label-md);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .ItemDue.Overdue {
    color: var(--theme-color-Error-text);
    font-weight: 700;
  }

  .EmptyState {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp2);
    padding: var(--sp7) var(--sp4);
    text-align: center;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
  }

  .EmptyState h2 {
    margin: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-title-md);
  }

  .EmptyState p {
    margin: 0;
    max-width: 28rem;
    font-size: var(--font-body-sm);
  }

  .EmptyIcon {
    width: 2.5rem;
    height: 2.5rem;
    fill: none;
    stroke: color-mix(in srgb, var(--theme-color-Primary-main) 75%, transparent);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
