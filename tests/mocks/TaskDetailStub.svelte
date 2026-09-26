<script>
  /**
   * @typedef {Object} Props
   * @property {string} [titleOverride]
   * @property {boolean} [showOpenWindowAction]
   */

  /** @type {Props} */
  let { titleOverride = "", showOpenWindowAction = true } = $props();
</script>

<div
  data-testid="task-detail-stub"
  data-title-override={titleOverride}
  data-show-open-window-action={String(showOpenWindowAction)}
>
  task detail stub
</div>
