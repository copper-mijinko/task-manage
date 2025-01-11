<script>
  export let disabled = false;
  export let id;
  export let value;
  export let style = "";
  export let backgroundColor = "var(--theme-color-Main-light)";
  export let color = "var(--theme-color-Sub-main)";
</script>

<div
  class="select"
  style="--backgroundColor: {backgroundColor}; --color: {color}; {style}"
>
  <select
    {id}
    {value}
    {disabled}
    on:change
    on:click={(e) => {
      e.stopPropagation();
    }}
  >
    <slot />
  </select>
  <svg viewBox="-12 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"
    ><path
      d="M0.88 23.28c-0.2 0-0.44-0.080-0.6-0.24-0.32-0.32-0.32-0.84 0-1.2l5.76-5.84-5.8-5.84c-0.32-0.32-0.32-0.84 0-1.2 0.32-0.32 0.84-0.32 1.2 0l6.44 6.44c0.16 0.16 0.24 0.36 0.24 0.6s-0.080 0.44-0.24 0.6l-6.4 6.44c-0.2 0.16-0.4 0.24-0.6 0.24z"
    ></path></svg
  >
</div>

<style>
  .select select {
    /* Reset Select */
    appearance: none;
    outline: 0;
    box-shadow: none;
    /* Personalize */
    flex: 1;
    color: var(--color);
    background-color: var(--backgroundColor);
    background-image: none;
    cursor: pointer;
    height: 100%;
    width: 100%;
    padding: 0;
    padding-right: 2rem;
    padding-left: 0.5rem;
    margin: 0;
    border: none;
  }
  .select select:focus-visible {
    outline: auto;
  }
  /* Remove IE arrow */
  .select select::-ms-expand {
    display: none;
  }
  /* Custom Select wrapper */
  .select {
    display: flex;
    position: relative;
    border-radius: 0.25em;
    height: 100%;
    width: 100%;
    flex: 1;
    overflow: hidden;
    background-color: var(--backgroundColor);
  }
  /* Arrow */
  .select svg {
    position: absolute;
    height: 100%;
    top: 0;
    right: 0;
    transition: 0.25s fill ease;
    pointer-events: none;
    transform: rotate(90deg);
    background-color: transparent;
    fill: var(--theme-color-Sub-light);
  }
  /* Transition */
  .select:hover svg {
    scale: 1.2;
  }
  .select :global(option) {
    color: var(--theme-color-Sub-light);
  }
</style>
