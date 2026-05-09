<script>
  import Pane from "../../src/components/Pane.svelte";
  import SplitPanes from "../../src/components/SplitPanes.svelte";

  export let defaultRatio = [1, 1];
</script>

<div style="width: 400px; height: 300px;">
  <SplitPanes {defaultRatio}>
    <Pane style="height: 100%; min-width: 4rem;">left</Pane>
    <Pane style="height: 100%; min-width: 4rem;">right</Pane>
  </SplitPanes>
</div>
