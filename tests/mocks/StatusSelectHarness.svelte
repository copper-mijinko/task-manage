<script>
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";

  export let status = "Open";
  /** Callback exposed to the test instead of `component.$on("change", ...)`,
   *  since Svelte 5 dropped that API on component instances. */
  export let onChange = undefined;

  let lastDetail = null;
  let changeCount = 0;

  function handleChange(event) {
    lastDetail = event.detail;
    changeCount += 1;
    onChange?.(event);
  }
</script>

<StatusSelect {status} on:change={handleChange} />

<p data-testid="change-count">{changeCount}</p>
<p data-testid="last-value">{lastDetail?.value ?? ""}</p>
<p data-testid="last-target-value">{lastDetail?.target?.value ?? ""}</p>
