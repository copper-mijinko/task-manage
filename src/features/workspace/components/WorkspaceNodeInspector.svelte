<script>
  import { createEventDispatcher } from "svelte";
  import NodeMemoEditor from "./WorkspaceNodeMemoEditor.svelte";
  import * as platform from "@lib/ipc/platform";
  export let graph;
  export let nodeId = "";
  export let sourceParentId = "";
  export let view = "graph";
  export let workspacePath = "";
  const dispatch = createEventDispatcher();
  let targetParentId = "",
    copyMode = "node";
  $: node = graph?.nodes?.[nodeId];
  $: parents = (node?.parents || []).map((p) => graph.nodes[p.id]).filter(Boolean);
  $: children = Object.values(graph?.nodes || {}).filter((n) =>
    (n.parents || []).some((p) => p.id === nodeId)
  );
  function run(command, origin = view) {
    dispatch("execute", { command, origin, workspacePath });
  }
  function patch(changes) {
    run({ type: "update-node", nodeId, changes });
  }
  function status(value) {
    patch({ status: value || undefined });
  }
  function remove() {
    if (!node || nodeId === graph.rootId) return;
    const pc = (node.parents || []).length,
      cc = children.length;
    if (
      confirm(
        `「${node.name}」を削除します。親 ${pc} 件との配置と、直接の子 ${cc} 件への接続が外れます。子ノード自体は残り、必要ならルートへの到達性が修復されます。続けますか？`
      )
    )
      run({ type: "delete-node", nodeId });
  }
  function hasCycle() {
    const visiting = new Set(),
      done = new Set();
    function visit(id) {
      if (visiting.has(id)) return true;
      if (done.has(id)) return false;
      visiting.add(id);
      for (const child of Object.values(graph.nodes).filter((n) =>
        (n.parents || []).some((p) => p.id === id)
      ))
        if (visit(child.id)) return true;
      visiting.delete(id);
      done.add(id);
      return false;
    }
    return visit(nodeId);
  }
  $: copyBlocked = copyMode === "subgraph" && view !== "graph" && hasCycle();
  $: copyHelp =
    copyMode === "node"
      ? "対象だけを新しいノードにします。子は付きません。"
      : copyMode === "share-children"
        ? "対象を新しく作り、直接の子は同じノードを共有します。"
        : "到達できる子孫を一度ずつ複製し、共有関係を再現します。";
  async function addAttachment(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const relativePath = (await platform.wsSaveGraphAsset(workspacePath, nodeId, file.name, bytes))
      .relativePath;
    patch({
      attachments: [
        ...(node.attachments || []),
        { id: crypto.randomUUID(), name: file.name, relativePath, size: file.size },
      ],
    });
    event.currentTarget.value = "";
  }
  async function openAttachment(item) {
    const result = await platform.wsResolveGraphAsset(workspacePath, nodeId, item.relativePath);
    await platform.openImageExternal(result.url, item.name);
  }
</script>

<aside class="inspector" aria-label="ノード詳細">
  {#if node}
    <div class="title">
      <h2>{node.name}</h2>
      {#if nodeId === graph.rootId}<span>Workspace root</span>{/if}
    </div>
    <button
      on:click={() =>
        run({ type: "create-node", parentId: nodeId, node: { name: "新しいノード" } })}
      >子ノードを作成</button
    >
    <label
      >名前<input
        value={node.name}
        on:change={(e) => patch({ name: e.currentTarget.value })}
      /></label
    >
    <label
      >ステータス<select value={node.status || ""} on:change={(e) => status(e.currentTarget.value)}
        ><option value="">ステータスなし</option><option value="Undefined">未定義</option><option
          value="Open">未着手</option
        ><option value="Pending">保留</option><option value="In Progress">進行中</option><option
          value="Completed">完了</option
        ><option value="Canceled">キャンセル</option></select
      ></label
    >
    <div class="dates">
      <label
        >開始日<input
          type="date"
          value={node.startDate || ""}
          on:change={(e) => patch({ startDate: e.currentTarget.value || undefined })}
        /></label
      ><label
        >期限<input
          type="date"
          value={node.dueDate || ""}
          on:change={(e) => patch({ dueDate: e.currentTarget.value || undefined })}
        /></label
      >
    </div>
    <label
      >タグ<input
        value={(node.tags || []).join(", ")}
        on:change={(e) =>
          patch({
            tags: e.currentTarget.value
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          })}
      /></label
    >
    <fieldset>
      <legend>配置</legend><label
        >操作元の親<select bind:value={sourceParentId}
          ><option value="">選択…</option>{#each parents as p}<option value={p.id}>{p.name}</option
            >{/each}</select
        ></label
      ><label
        >配置先<select bind:value={targetParentId}
          ><option value="">選択…</option
          >{#each Object.values(graph.nodes).filter((n) => n.id !== nodeId) as n}<option
              value={n.id}>{n.name}</option
            >{/each}</select
        ></label
      >
      <div class="buttons">
        <button
          disabled={!targetParentId || nodeId === graph.rootId}
          on:click={() => run({ type: "link", childId: nodeId, parentId: targetParentId })}
          >別の場所にも置く</button
        ><button
          disabled={!sourceParentId || !targetParentId || nodeId === graph.rootId}
          on:click={() =>
            run({
              type: "move",
              childId: nodeId,
              fromParentId: sourceParentId,
              toParentId: targetParentId,
            })}>ここから移動</button
        ><button
          disabled={!sourceParentId || nodeId === graph.rootId}
          on:click={() => run({ type: "detach", childId: nodeId, parentId: sourceParentId })}
          >ここから外す</button
        >
      </div>
    </fieldset>
    <fieldset>
      <legend>コピー</legend><select bind:value={copyMode}
        ><option value="node">ノードだけコピー</option><option value="share-children"
          >子を共有してコピー</option
        ><option value="subgraph">子孫ごとコピー</option></select
      >
      <p>{copyHelp}</p>
      {#if copyBlocked}<p>
          この子孫には循環があるため、子孫ごとのコピーはグラフで実行してください。
        </p>{/if}<button
        disabled={!targetParentId || nodeId === graph.rootId || copyBlocked}
        on:click={() => run({ type: "copy", nodeId, targetParentId, mode: copyMode })}
        >選択した場所へコピー</button
      >
    </fieldset>
    <fieldset>
      <legend>添付</legend><input
        aria-label="添付を追加"
        type="file"
        on:change={addAttachment}
      />{#each node.attachments || [] as item}<div class="attachment">
          <button on:click={() => openAttachment(item)}>{item.name}</button><button
            aria-label={`${item.name}を削除`}
            on:click={() =>
              patch({ attachments: (node.attachments || []).filter((x) => x.id !== item.id) })}
            >×</button
          >
        </div>{/each}
    </fieldset>
    <div class="danger">
      <button
        disabled={nodeId === graph.rootId}
        on:click={() =>
          patch({
            archived: !node.archived,
            archivedAt: node.archived ? undefined : new Date().toISOString(),
          })}>{node.archived ? "復元" : "アーカイブ"}</button
      ><button disabled={nodeId === graph.rootId} on:click={remove}>ノードを削除</button>
    </div>
    <section class="memo" aria-label="本文">
      {#key `${workspacePath}:${nodeId}`}<NodeMemoEditor
          {node}
          {nodeId}
          {workspacePath}
          on:execute={(event) => dispatch("execute", event.detail)}
        />{/key}
    </section>
  {:else}<p>ノードを選択してください。</p>{/if}
</aside>

<style>
  .inspector {
    border-left: 1px solid var(--theme-color-Sub-dark);
    padding: 1rem;
    overflow: auto;
    background: var(--theme-color-Main-main);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .title h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .title span,
  fieldset p {
    font-size: 0.7rem;
    color: var(--theme-color-Sub-main);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0.6rem 0;
    font-size: 0.78rem;
  }
  input,
  select {
    box-sizing: border-box;
    width: 100%;
    min-height: 2rem;
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-sm);
    background: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-light);
    padding: 0.35rem;
  }
  button {
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-sm);
    background: var(--theme-color-Main-light);
    color: inherit;
    padding: 0.4rem 0.55rem;
  }
  button:disabled {
    opacity: 0.4;
  }
  .dates,
  .buttons,
  .danger,
  .attachment {
    display: flex;
    gap: 0.4rem;
  }
  .dates > * {
    flex: 1;
  }
  .buttons {
    flex-wrap: wrap;
  }
  fieldset {
    margin: 0.8rem 0;
    padding: 0.55rem;
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-sm);
  }
  .attachment {
    margin-top: 0.35rem;
  }
  .attachment button:first-child {
    flex: 1;
    text-align: left;
  }
  .memo {
    height: 18rem;
    border-top: 1px solid var(--theme-color-Sub-dark);
    padding-top: 0.6rem;
  }
</style>
