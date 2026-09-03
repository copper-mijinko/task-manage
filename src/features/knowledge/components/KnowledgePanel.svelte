<script>
  import { onMount } from "svelte";
  import Card from "@lib/primitives/Card.svelte";
  import Loading from "@lib/primitives/Loading.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import { selected_id, selected_type, sidebarCollapsed } from "@stores";
  import { setPendingTaskDetailSelection } from "@stores/ui";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { active_tag } from "@features/memos/stores/tags";
  import { knowledge_store, filterKnowledgeItems } from "@features/knowledge/stores/knowledge";

  let query = "";

  $: workspaceReady = Boolean($workspace_store.activeWorkspacePath);
  $: projectCount = $workspace_store.projects?.length ?? 0;
  $: visibleItems = filterKnowledgeItems($knowledge_store.items, query);
  $: groups = groupByProject(visibleItems);
  $: archivedCount = $knowledge_store.items.filter((item) => item.fromArchivedTask).length;

  function groupByProject(items) {
    const byProject = new Map();
    for (const item of items) {
      if (!byProject.has(item.projectName)) byProject.set(item.projectName, []);
      byProject.get(item.projectName).push(item);
    }
    return [...byProject.entries()].map(([projectName, groupItems]) => ({
      projectName,
      items: groupItems,
    }));
  }

  onMount(() => {
    void knowledge_store.load();
  });

  /**
   * ナレッジを開く。プロジェクトを切り替えたうえで、読み込み完了後に
   * 由来のタスクを選択させる（読み込みは非同期なので pending 経由で渡す）。
   * メモタブそのものの選択までは行わないので、タスクを開いたあとに
   * 同じタイトルのタブを選ぶ必要がある。
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

<div class="KnowledgeRoot">
  <Card title="ナレッジ" padded={false} style="height: 100%; width: 100%;">
    <svelte:fragment slot="header-actions">
      <span class="HeaderSummary">
        <span class="HeaderBadge">{$knowledge_store.items.length} 件</span>
        {#if archivedCount > 0}
          <span class="HeaderBadge Muted">アーカイブ由来 {archivedCount}</span>
        {/if}
      </span>
      <IconButton
        ariaLabel="ナレッジを再読み込み"
        tooltipContent="再読み込み"
        variant="text"
        normalColor={"var(--theme-color-Sub-main)"}
        activeColor={"var(--theme-color-Primary-main)"}
        on:click={() => knowledge_store.load()}
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

    <div class="Body">
      <div class="Toolbar">
        <input
          class="Search"
          type="search"
          bind:value={query}
          placeholder="タイトル・タグ・タスクで絞り込み"
          aria-label="ナレッジを絞り込み"
        />
        <span class="Count">
          {visibleItems.length} 件 / {projectCount} プロジェクト
        </span>
      </div>

      {#if !workspaceReady}
        <div class="EmptyState">
          <h2>ワークスペースがありません</h2>
          <p>ワークスペースを設定すると、そこに書いたナレッジがここに集まります。</p>
        </div>
      {:else if $knowledge_store.loading && $knowledge_store.items.length === 0}
        <Loading variant="h1" />
      {:else if $knowledge_store.items.length === 0}
        <div class="EmptyState">
          <svg class="EmptyIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3l2.4 5.3 5.6.6-4.2 3.9 1.2 5.7L12 15.6 6.9 18.5l1.2-5.7L4 8.9l5.6-.6z"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
          <h2>ナレッジはまだありません</h2>
          <p>
            メモを「ナレッジ」に昇華すると、書いたタスクが終わったあとも、ここから探せる記録になります。
          </p>
        </div>
      {:else if visibleItems.length === 0}
        <div class="EmptyState">
          <h2>一致するナレッジがありません</h2>
          <p>絞り込みの条件を変えてみてください。</p>
        </div>
      {:else}
        <div class="Groups">
          {#each groups as group (group.projectName)}
            <section class="Group">
              <h3 class="GroupHeader">
                {group.projectName}
                <span class="GroupCount">{group.items.length}</span>
              </h3>
              <ul class="Items">
                {#each group.items as item (item.projectDir + ":" + item.taskId + ":" + item.memoId)}
                  <li>
                    <div class="Item" class:Archived={item.fromArchivedTask}>
                      <button
                        type="button"
                        class="ItemMain"
                        on:click={() => openItem(item)}
                        title={`${item.projectName} / ${item.taskName} を開く`}
                      >
                        <span class="ItemTitle">{item.title}</span>
                        <span class="ItemPath">
                          {#if item.parentPath}
                            <span class="PathPart">{item.parentPath}</span>
                            <span class="PathSep">/</span>
                          {/if}
                          <span class="PathPart">{item.taskName}</span>
                          {#if item.fromArchivedTask}
                            <span class="ArchivedMark">アーカイブ済みのタスク</span>
                          {/if}
                        </span>
                      </button>
                      {#if item.tags.length > 0}
                        <span class="ItemTags">
                          {#each item.tags as tag (tag)}
                            <button
                              type="button"
                              class="TagChip"
                              class:Active={$active_tag === tag}
                              aria-pressed={$active_tag === tag}
                              title={`タグ ${tag} で絞り込む`}
                              on:click|stopPropagation={() => openTag(tag)}
                            >
                              {tag}
                            </button>
                          {/each}
                        </span>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}

      {#if $knowledge_store.failedProjects.length > 0}
        <p class="LoadError" role="alert">
          読み込めなかったプロジェクト: {$knowledge_store.failedProjects.join(", ")}
        </p>
      {/if}
    </div>
  </Card>
</div>

<style>
  .KnowledgeRoot {
    display: flex;
    height: 100%;
    width: 100%;
    min-height: 0;
  }
  .Body {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .HeaderSummary {
    display: inline-flex;
    align-items: center;
    gap: var(--sp2);
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
  .HeaderBadge.Muted {
    opacity: 0.7;
  }

  .Toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    flex-wrap: wrap;
    padding: var(--sp2) var(--sp3);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    flex-shrink: 0;
  }
  .Search {
    flex: 1 1 12rem;
    min-width: 0;
    height: 1.75rem;
    padding: 0 var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 28%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
  }
  .Search:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -1px;
  }
  .Count {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    font-size: var(--font-label-sm);
    font-variant-numeric: tabular-nums;
  }

  .Groups {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .Group {
    display: block;
  }
  .GroupHeader {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    margin: 0;
    padding: var(--sp1) var(--sp3);
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: color-mix(
      in srgb,
      var(--theme-color-Sub-main) 8%,
      var(--theme-color-Main-main)
    );
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 700;
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
    padding: 0 var(--sp3);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 8%, transparent);
  }
  .Item:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 8%, transparent);
  }
  /* アーカイブ由来は一覧から外さず、落ち着かせて置く。ナレッジはタスクの
     寿命に縛られない、というのがこのビューの前提なので消してはいけない。 */
  .Item.Archived .ItemTitle {
    opacity: 0.7;
  }

  .ItemMain {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1 1 auto;
    min-width: 0;
    padding: var(--sp2) 0;
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .ItemMain:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
  }
  .ItemTitle {
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-md);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ItemPath {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
    font-size: var(--font-label-sm);
    overflow: hidden;
  }
  .PathPart {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .PathSep {
    flex-shrink: 0;
    opacity: 0.6;
  }
  .ArchivedMark {
    flex-shrink: 0;
    padding: 0 var(--sp1);
    border-radius: var(--shape-xs);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    font-size: var(--font-label-sm);
  }

  .ItemTags {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    flex: 0 0 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 40%;
  }
  .TagChip {
    padding: 0 var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 45%, transparent);
    border-radius: var(--shape-pill);
    background: transparent;
    color: var(--theme-color-Primary-text);
    font-size: var(--font-label-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  .TagChip.Active {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
  }
  .TagChip:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 1px;
  }

  .EmptyState {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp2);
    padding: var(--sp7) var(--sp4);
    text-align: center;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 75%, transparent);
  }
  .EmptyIcon {
    width: 2.5rem;
    height: 2.5rem;
    opacity: 0.55;
  }
  .EmptyState h2 {
    margin: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-title-sm);
  }
  .EmptyState p {
    margin: 0;
    max-width: 26rem;
    font-size: var(--font-body-sm);
    line-height: 1.7;
  }

  .LoadError {
    margin: 0;
    padding: var(--sp2) var(--sp3);
    color: var(--theme-color-Error-text);
    font-size: var(--font-label-md);
    flex-shrink: 0;
  }
</style>
