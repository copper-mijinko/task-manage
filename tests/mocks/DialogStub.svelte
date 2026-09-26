<script>
  /**
   * @typedef {Object} Props
   * @property {boolean} [show]
   * @property {string} [header]
   * @property {string} [content]
   * @property {any} [callback]
   * @property {any} [toggle]
   */

  /** @type {Props} */
  let {
    show = false,
    header = "",
    content = "",
    callback = () => {},
    toggle = () => {},
  } = $props();
</script>

{#if show}
  <div data-testid="dialog-stub">
    <h2>{header}</h2>
    <p>{content}</p>
    <button
      type="button"
      onclick={() => {
        callback();
        toggle();
      }}
    >
      ok
    </button>
    <button type="button" onclick={toggle}>cancel</button>
  </div>
{/if}
