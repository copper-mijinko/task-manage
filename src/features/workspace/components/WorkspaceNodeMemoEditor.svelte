<script>
  import { createEventDispatcher } from "svelte";
  import Memo from "@features/memos/components/Memo.svelte";
  import * as platform from "@lib/ipc/platform";
  export let node;
  export let nodeId;
  export let workspacePath;
  const dispatch = createEventDispatcher();
  function update(changes) {
    dispatch("execute", {
      command: { type: "update-node", nodeId, changes },
      origin: "graph",
      workspacePath,
    });
  }
  async function saveAsset(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return (
      await platform.wsSaveGraphAsset(workspacePath, nodeId, file.name || "pasted-image.png", bytes)
    ).relativePath;
  }
</script>

<Memo
  content={node.body || ""}
  format={node.format || "markdown"}
  isWorkspaceProject={true}
  saveImage={saveAsset}
  resolveAsset={async (path) =>
    (await platform.wsResolveGraphAsset(workspacePath, nodeId, path)).url}
  saveMemo={(body) => update({ body, format: node.format || "markdown" })}
/>
