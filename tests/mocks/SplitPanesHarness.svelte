<script>
  import Pane from "@lib/layouts/Pane.svelte";
  import SplitPanes from "@lib/layouts/SplitPanes.svelte";

  export let defaultRatio = [1, 1];
</script>

<div style="width: 400px; height: 300px;">
  <SplitPanes {defaultRatio}>
    <!-- min-width in px (not rem) so jsdom's getComputedStyle returns a
         pixel value the resizer can parseFloat() correctly. -->
    <Pane style="height: 100%; min-width: 128px;">left</Pane>
    <Pane style="height: 100%; min-width: 128px;">right</Pane>
  </SplitPanes>
</div>
