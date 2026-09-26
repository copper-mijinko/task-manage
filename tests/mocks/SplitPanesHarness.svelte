<script>
  import Pane from "@lib/layouts/Pane.svelte";
  import SplitPanes from "@lib/layouts/SplitPanes.svelte";

  /**
   * @typedef {Object} Props
   * @property {any} [defaultRatio]
   * @property {string} [collapsePriority]
   * @property {number} [collapseSize]
   * @property {any} [collapsedPane]
   * @property {string} [separatorLabel]
   * @property {string} [persistenceKey]
   * @property {string} [paneMinWidth]
   */

  /** @type {Props} */
  let {
    defaultRatio = [1, 1],
    collapsePriority = "both",
    collapseSize = 64,
    collapsedPane = $bindable(null),
    separatorLabel = "ペインのサイズを変更",
    persistenceKey = "",
    paneMinWidth = "128px",
  } = $props();
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
