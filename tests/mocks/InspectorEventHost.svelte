<script>
  import WorkspaceNodeInspector from "../../src/features/workspace/components/WorkspaceNodeInspector.svelte";
  let { graph = $bindable() } = $props();
  let detail = $state(null);
  function handleExecute(event) {
    detail = event;
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
  onexecute={handleExecute}
/>
<output data-testid="execute-detail">{detail ? JSON.stringify(detail) : ""}</output>
