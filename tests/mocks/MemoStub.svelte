<script>
  import { onDestroy } from "svelte";

  export let content = "";
  export let saveMemo = undefined;
  export let memoIndex = 0;
  export let format = undefined;

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
  data-has-save={saveMemo ? "true" : "false"}
>
  {typeof content === "string" ? content : "memo-content"}
</div>
<button type="button" data-testid="memo-save" on:click={() => saveMemo?.("edited")}>Save</button>
