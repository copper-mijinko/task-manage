<script>
  import WorkspaceNodeInspector from "../../src/features/workspace/components/WorkspaceNodeInspector.svelte";
  export let graph;
  let detail = null;
</script>

<WorkspaceNodeInspector
  {graph}
  nodeId="a"
  workspacePath="C:/fixture"
  sourceParentId="root"
  view="graph"
  on:execute={(event) => (detail = event.detail)}
/>
<output data-testid="execute-detail">{detail ? JSON.stringify(detail) : ""}</output>
