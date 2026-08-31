<script>
  import Pane from "@lib/layouts/Pane.svelte";
  import SplitPanes from "@lib/layouts/SplitPanes.svelte";

  export let defaultRatio = [1, 1];
  export let collapsePriority = "both";
  export let collapseSize = 64;
  export let collapsedPane = null;
  export let separatorLabel = "ペインのサイズを変更";
  export let persistenceKey = "";
  export let paneMinWidth = "128px";
</script>

<div style="width: 400px; height: 300px;">
  <SplitPanes
    {defaultRatio}
    {collapsePriority}
    {collapseSize}
    {separatorLabel}
    {persistenceKey}
    bind:collapsedPane
  >
    <!-- The default is px for legacy snap tests; tree-priority coverage also
         passes rem to verify unit-aware minimum-size handling. -->
    <Pane style="height: 100%; min-width: {paneMinWidth};">left</Pane>
    <Pane style="height: 100%; min-width: {paneMinWidth};">right</Pane>
  </SplitPanes>
</div>
