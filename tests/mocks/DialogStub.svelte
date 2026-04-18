<script>
  export let show = false;
  export let header = "";
  export let content = "";
  export let callback = () => {};
  export let toggle = () => {};
</script>

{#if show}
  <div data-testid="dialog-stub">
    <h2>{header}</h2>
    <p>{content}</p>
    <button
      type="button"
      on:click={() => {
        callback();
        toggle();
      }}
    >
      ok
    </button>
    <button type="button" on:click={toggle}>cancel</button>
  </div>
{/if}
