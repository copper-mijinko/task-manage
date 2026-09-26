<script>
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";

  /**
   * @typedef {Object} Props
   * @property {string} [status]
   * @property {any} [onChange] - Callback exposed to the test instead of `component.$on("change", ...)`,
since Svelte 5 dropped that API on component instances.
   */

  /** @type {Props} */
  let { status = "Open", onChange = undefined } = $props();

  let lastDetail = $state(null);
  let changeCount = $state(0);

  function handleChange(event) {
    lastDetail = event;
    changeCount += 1;
    onChange?.(event);
  }
</script>

<StatusSelect {status} onchange={handleChange} />

<p data-testid="change-count">{changeCount}</p>
<p data-testid="last-value">{lastDetail?.value ?? ""}</p>
<p data-testid="last-target-value">{lastDetail?.target?.value ?? ""}</p>
