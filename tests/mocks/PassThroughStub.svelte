<script>
  let { defaultRatio = [], children } = $props();
</script>

<div data-testid="passthrough-stub" data-default-ratio={defaultRatio.join(",")}>
  {@render children?.()}
</div>
