<script>
  import WorkspaceNodeInspector from "../../src/features/workspace/components/WorkspaceNodeInspector.svelte";
  export let graph;
  let detail = null;
  function handleExecute(event) {
    detail = event.detail;
    if (detail.command.type === "update-node") {
      const current = graph.nodes[detail.command.nodeId];
      graph = {
        ...graph,
        nodes: {
          ...graph.nodes,
          [current.id]: { ...current, ...detail.command.changes },
        },
      };
    }
  }
</script>

<WorkspaceNodeInspector
  {graph}
  nodeId="a"
  workspacePath="C:/fixture"
  sourceParentId="root"
  view="graph"
  on:execute={handleExecute}
/>
<output data-testid="execute-detail">{detail ? JSON.stringify(detail) : ""}</output>
