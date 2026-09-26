<script>
  import { onDestroy } from "svelte";

  export function flush() {}
  export function startEditing() {}
  /**
   * @typedef {Object} Props
   * @property {string} [content]
   * @property {any} [saveMemo]
   * @property {number} [memoIndex]
   * @property {any} [format]
   * @property {string} [currentMemoTitle]
   */

  /** @type {Props} */
  let {
    content = "",
    saveMemo = undefined,
    memoIndex = 0,
    format = undefined,
    currentMemoTitle = "",
  } = $props();

  onDestroy(() => {
    if (window.__memoStubSaveOnDestroy) {
      saveMemo?.(window.__memoStubSaveOnDestroy);
    }
  });
</script>

<div
  data-testid="memo-stub"
  data-memo-index={memoIndex}
  data-format={format}
  data-current-memo-title={currentMemoTitle}
  data-has-save={saveMemo ? "true" : "false"}
>
  {typeof content === "string" ? content : "memo-content"}
</div>
<button type="button" data-testid="memo-save" onclick={() => saveMemo?.("edited")}>Save</button>
