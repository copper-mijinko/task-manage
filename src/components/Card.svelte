<script>
  export let style = "";
</script>

<div class="container" style={style}>
  <slot />
</div>

<style>
  .container {
		display: flex;
		flex-direction: column;
		box-shadow: 0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);
		border-radius: 0.5rem;
    overflow: auto;
    box-sizing: border-box;
    padding: 0;
    background-color: var(--theme-color-Main-main);
  }
</style>