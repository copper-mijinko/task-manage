<script>
  import Memo from "@features/memos/components/Memo.svelte";
  import * as platform from "@lib/ipc/platform";
  let { node, nodeId, workspacePath, onexecute } = $props();
  function update(changes) {
    onexecute?.({
      command: { type: "update-node", nodeId, changes },
      origin: "graph",
      workspacePath,
    });
  }
  async function saveAsset(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return (
      await platform.wsSaveGraphAsset(
        workspacePath,
        nodeId,
        file.name || "pasted-image.png",
        bytes,
        "image"
      )
    ).relativePath;
  }
</script>

<!-- 読み込みでは本文を読まない（`bodyLoaded: false`）。空の本文を編集・保存させないため、
     読んでいないノードではエディターを出さない（この画面は、いまはどこからも開かない）。 -->
{#if node.bodyLoaded !== false}
  <Memo
    content={node.body || ""}
    format={node.format || "markdown"}
    saveImage={saveAsset}
    resolveAsset={async (path) =>
      (await platform.wsResolveGraphAsset(workspacePath, nodeId, path)).url}
    saveMemo={(body) => update({ body, format: node.format || "markdown" })}
  />
{/if}
