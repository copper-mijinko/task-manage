<script>
  import Modal from "@lib/primitives/Modal.svelte";
  import Button from "@lib/primitives/Button.svelte";
  export let show = false;
  export let toggle;
  export let header;
  export let content;
  export let callback = undefined;
  export let ok = "ok";
  export let cancel = "cancel";
  export let width = "28rem";
  export let height = "auto";

  const dialogHeaderId = `dialog-header-${Math.random().toString(36).slice(2)}`;
</script>

<Modal {show} {toggle} {width} {height} labelledBy={dialogHeaderId}>
  <div class="container">
    <div class="header" id={dialogHeaderId}>{header}</div>
    <div class="content">{content}</div>
    {#if ok || cancel}
      <div class="control">
        {#if cancel}
          <Button use_ripple={false} variant="text" content={cancel} on:click={toggle} />
        {/if}
        {#if ok}
          <Button
            use_ripple={false}
            variant="filled"
            content={ok}
            on:click={() => {
              callback();
              toggle();
            }}
          />
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
    border-radius: var(--shape-md);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    width: 100%;
    padding: var(--sp4);
    margin: 0;
    box-sizing: border-box;
    font-weight: 600;
    font-size: var(--font-title-md);
    color: var(--theme-color-Sub-main);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    background-color: var(--theme-color-Main-main);
  }
  .content {
    display: flex;
    width: 100%;
    padding: var(--sp4);
    margin: 0;
    box-sizing: border-box;
    font-size: var(--font-body-md);
    line-height: 1.5;
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
    gap: var(--sp2);
    width: 100%;
    padding: var(--sp2) var(--sp4);
    margin: 0;
    box-sizing: border-box;
    border-top: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
</style>
