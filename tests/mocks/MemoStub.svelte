<script>
  export let content = "";
  export let saveMemo = undefined;
  export let memoIndex = 0;
</script>

<div
  data-testid="memo-stub"
  data-memo-index={memoIndex}
  data-has-save={saveMemo ? "true" : "false"}
>
  {typeof content === "string" ? content : "memo-content"}
</div>
