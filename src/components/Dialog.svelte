<script>
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  export let show = false;
  export let toggle;
  export let header;
  export let content;
  export let callback;
  export let ok = "ok";
  export let cancel = "cancel";
</script>

<Modal show={show} toggle={toggle} width="30rem" height="15rem">
  <div class="container">
    <div class="header">{header}</div>
    <div class="content">{content}</div>
    {#if (ok || cancel)}
      <div class="control">
        {#if (cancel)}
          <Button use_ripple={false} variant="text" content={cancel} on:click={toggle}/>
        {/if}
        {#if (ok)}
          <Button use_ripple={false} variant="filled" content={ok} on:click={() => {callback(); toggle();}}/>
        {/if}
      </div>
    {/if}
  </div>
</Modal>

<style>
  .container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    background-color: var(--theme-color-Main-light);
  }
  .header {
    display: flex;
    width: 100%;
    height: 4rem;
    padding: 1rem;
    margin: 0;
    box-sizing: border-box;
    font-weight: bold;
    font-size: 2rem;
    color: var(--theme-color-Sub-main);
    border-bottom: 1px solid var(--theme-color-Sub-main);
    background-color: var(--theme-color-Main-main);
  }
  .content {
    display: flex;
    width: calc(100% - 1rem);
    padding: 0.5rem;
    margin: 0.5rem;
    box-sizing: border-box;
    font-size: 1rem;
    color: var(--theme-color-Sub-main);
    overflow-y: auto;
    flex: 1;
    white-space: pre-wrap;
  }
  .control {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    width: 100%;
    padding-bottom: .5rem;
    padding-top: .5rem;
    margin: 0;
    box-sizing: border-box;
  }
</style>