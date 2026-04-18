<script>
  export let defaultRatio = [];
</script>

<div data-testid="passthrough-stub" data-default-ratio={defaultRatio.join(",")}>
  <slot />
</div>
