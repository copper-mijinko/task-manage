<script>
  import { selected_id } from "@stores";
  import { INBOX_SELECTED_ID } from "@features/inbox/stores/inbox";
  import { AGENDA_SELECTED_ID } from "@features/agenda/stores/agenda";
  import { active_tag, tag_index } from "@features/memos/stores/tags";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { workspace_graph_store, workspace_graph } from "@features/workspace/stores/graph";
  import WorkspaceGraphView from "./WorkspaceGraphView.svelte";
  import WorkspaceTreeView from "./WorkspaceTreeView.svelte";
  import WorkspaceFinderView from "./WorkspaceFinderView.svelte";
  import WorkspaceNodeInspector from "./WorkspaceNodeInspector.svelte";
  import NodeGanttPanel from "@features/gantt/components/NodeGanttPanel.svelte";
  let view = "graph",
    selectedId = "",
    selectedOccurrenceId = "",
    sourceParentId = "",
    message = "",
    localError = "",
    loadedPath = "",
    showArchived = false,
    restoredPath = "";
  $: workspacePath = $workspace_store.activeWorkspacePath;
  $: graph = $workspace_graph;
  $: state = $workspace_graph_store;
  $: if (workspacePath && workspacePath !== loadedPath) {
    loadedPath = workspacePath;
    selectedId = "";
    selectedOccurrenceId = "";
    void workspace_graph_store.load(workspacePath).catch(() => {});
  }
  $: if (workspacePath && workspacePath !== restoredPath) {
    restoredPath = workspacePath;
    try {
      const saved = JSON.parse(
        localStorage.getItem(`task-manage:graph-view:${workspacePath}`) || "{}"
      );
      view = saved.view || "graph";
      selectedId = saved.selectedId || "";
      selectedOccurrenceId = saved.selectedOccurrenceId || "";
      sourceParentId = saved.sourceParentId || "";
      showArchived = Boolean(saved.showArchived);
    } catch {
      /* Ignore invalid local view preferences. */
    }
  }
  $: if (workspacePath && restoredPath === workspacePath)
    localStorage.setItem(
      `task-manage:graph-view:${workspacePath}`,
      JSON.stringify({ view, selectedId, selectedOccurrenceId, sourceParentId, showArchived })
    );
  $: if (graph && graph.workspaceId && selectedId && !graph.nodes[selectedId]) {
    selectedId = "";
    selectedOccurrenceId = "";
    sourceParentId = "";
  }
  $: if (graph && $selected_id === AGENDA_SELECTED_ID) {
    view = "gantt";
    $selected_id = graph.rootId;
  }
  $: if (graph && $selected_id === INBOX_SELECTED_ID) {
    view = "tree";
    const inbox = Object.values(graph.nodes).find((node) => node.name.toLowerCase() === "inbox");
    selectedId = inbox?.id || graph.rootId;
    $selected_id = selectedId;
  }
  $: if (graph) {
    const index = new Map();
    for (const node of Object.values(graph.nodes)) {
      if (node.archived && !showArchived) continue;
      for (const raw of node.tags || []) {
        const tag = raw.toLowerCase();
        if (!index.has(tag)) index.set(tag, new Set());
        index.get(tag).add(node.id);
      }
    }
    $tag_index = index;
  }
  $: displayGraph = graph ? filterGraph(graph, $active_tag) : graph;
  function filterGraph(source, tag) {
    if (!tag) return source;
    const include = new Set([source.rootId]);
    for (const node of Object.values(source.nodes))
      if ((node.tags || []).some((value) => value.toLowerCase() === tag)) include.add(node.id);
    const queue = [...include];
    while (queue.length) {
      const node = source.nodes[queue.pop()];
      for (const parent of node?.parents || [])
        if (!include.has(parent.id)) {
          include.add(parent.id);
          queue.push(parent.id);
        }
    }
    return {
      ...source,
      nodes: Object.fromEntries(Object.entries(source.nodes).filter(([id]) => include.has(id))),
    };
  }
  function select(detail) {
    selectedId = detail.nodeId;
    selectedOccurrenceId = detail.occurrenceId || detail.nodeId;
    sourceParentId = detail.parentId || "";
  }
  function friendlyError(error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (/cannot create a cycle|cycle/i.test(raw))
      return "このビューでは循環する関係を作れません。グラフで操作してください。";
    if (/duplicate/i.test(raw)) return "同じ親子関係はすでにあります。";
    if (/root/i.test(raw)) return "Workspace root にはこの操作を実行できません。";
    if (/date|YYYY-MM-DD/i.test(raw))
      return "日付を確認してください。開始日は期限以前に設定します。";
    if (/changed|conflict|revision/i.test(raw))
      return "別の変更が先に保存されました。最新の内容を読み込みました。";
    return "保存できませんでした。入力と接続先を確認してください。";
  }
  async function execute(detail, propagate = false) {
    const target = detail.workspacePath || workspacePath;
    localError = "";
    message = "";
    try {
      const result = await workspace_graph_store.execute(
        detail.command,
        detail.origin || view,
        target
      );
      if (workspacePath !== target) return result;
      if (result.selectedNodeIds?.length) selectedId = result.selectedNodeIds[0];
      message = "保存しました";
      return result;
    } catch (e) {
      if (workspacePath === target) localError = friendlyError(e);
      if (propagate) throw e;
    }
  }
  async function history(direction) {
    const target = workspacePath;
    localError = "";
    try {
      const result = await workspace_graph_store[direction]();
      if (workspacePath !== target) return;
      message = result.changed ? "履歴を更新しました" : "これ以上の履歴はありません";
    } catch (e) {
      if (workspacePath === target) localError = friendlyError(e);
    }
  }
  function createAtRoot() {
    if (graph)
      void execute({
        command: { type: "create-node", parentId: graph.rootId, node: { name: "新しいノード" } },
        origin: "graph",
      });
  }
</script>

<main class="page" aria-label="Workspace nodes" style="width:100%;flex:1;align-self:stretch">
  <header>
    <div>
      <h1>Workspace</h1>
      <p>一つのノードを複数の見方で整理します。</p>
    </div>
    <nav aria-label="表示形式">
      {#each [["graph", "グラフ"], ["tree", "ツリー"], ["finder", "Finder"], ["gantt", "ガント"]] as tab}<button
          class:active={view === tab[0]}
          aria-pressed={view === tab[0]}
          on:click={() => (view = tab[0])}>{tab[1]}</button
        >{/each}
    </nav>
    <label class="archived"
      ><input type="checkbox" bind:checked={showArchived} />アーカイブを表示</label
    ><button on:click={createAtRoot} disabled={!graph}>ルートに作成</button><button
      on:click={() => history("undo")}>元に戻す</button
    ><button on:click={() => history("redo")}>やり直す</button>
  </header>
  {#if localError || state.error}<div class="alert" role="alert">
      {localError || state.error}
    </div>{:else if message}<div class="status" role="status">{message}</div>{/if}
  {#if state.loading}<div class="empty">グラフを読み込んでいます…</div>{:else if graph}
    <div class="body">
      <section class="canvas">
        {#if view === "graph"}<WorkspaceGraphView
            graph={displayGraph}
            {selectedId}
            on:select={(e) => select(e.detail)}
            on:execute={(e) => execute(e.detail)}
          />
        {:else if view === "tree"}<WorkspaceTreeView
            graph={displayGraph}
            {showArchived}
            {selectedOccurrenceId}
            persistenceKey={workspacePath}
            on:select={(e) => {
              if (e.detail.cycleReference) view = "graph";
              select(e.detail);
            }}
          />
        {:else if view === "finder"}<WorkspaceFinderView
            graph={displayGraph}
            {showArchived}
            {selectedOccurrenceId}
            persistenceKey={workspacePath}
            on:select={(e) => select(e.detail)}
            on:showgraph={() => (view = "graph")}
          />
        {:else}<NodeGanttPanel
            nodes={graph.nodes}
            rootId={graph.rootId}
            {selectedId}
            onSelect={(id) => select({ nodeId: id, occurrenceId: id, parentId: "" })}
            onUpdate={(id, changes) =>
              execute(
                { command: { type: "update-node", nodeId: id, changes }, origin: "graph" },
                true
              )}
          />{/if}
      </section>
      <WorkspaceNodeInspector
        {graph}
        nodeId={selectedId}
        bind:sourceParentId
        {view}
        {workspacePath}
        on:execute={(e) => execute(e.detail)}
      />
    </div>
  {:else}<div class="empty">
      {workspacePath ? "Workspace graph を読み込めませんでした" : "Workspaceを選択してください"}
    </div>{/if}
</main>

<style>
  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-light);
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid var(--theme-color-Sub-dark);
    background: var(--theme-color-Main-main);
  }
  header h1 {
    margin: 0;
    font-size: 1.15rem;
  }
  header p {
    margin: 0.15rem 1rem 0 0;
    color: var(--theme-color-Sub-main);
    font-size: 0.75rem;
  }
  nav {
    display: flex;
    gap: 0.2rem;
    margin-left: auto;
  }
  button {
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-sm);
    background: var(--theme-color-Main-light);
    color: inherit;
    padding: 0.4rem 0.6rem;
  }
  button.active {
    background: var(--theme-color-Primary-main);
    color: white;
  }
  .archived {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 21rem;
    flex: 1;
    min-height: 0;
  }
  .canvas {
    min-width: 0;
    overflow: auto;
    padding: 1rem;
  }
  .alert,
  .status {
    padding: 0.4rem 1rem;
    font-size: 0.8rem;
  }
  .alert {
    color: var(--theme-color-Error-main);
  }
  .status {
    color: var(--theme-color-Success-main);
  }
  .empty {
    padding: 3rem;
    text-align: center;
    color: var(--theme-color-Sub-main);
  }
  @media (max-width: 900px) {
    header {
      flex-wrap: wrap;
    }
    .body {
      grid-template-columns: 1fr;
    }
    .body :global(.inspector) {
      border-left: 0;
      border-top: 1px solid var(--theme-color-Sub-dark);
    }
  }
</style>
