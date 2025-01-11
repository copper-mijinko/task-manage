<script>
  import IconButton from "./IconButton.svelte";
  import { clickOutside } from "../common/common";
  export let show = false;
  export let toggle;
</script>

{#if show}
  <div class="Mask" />
{/if}
<div
  class:Container={true}
  class:Shown={show}
  use:clickOutside
  on:outclick={toggle()}
>
  <div class="IconButtonContainer">
    <IconButton
      on:click={toggle()}
      use_ripple={false}
      activeColor={"transparent"}
      normalColor={"transparent"}
      style={"box-shadow: none; width: 3rem; height: 3rem;"}
    >
      <svg fill="white" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
        ><path
          d="M15.7071 4.29289C16.0976 4.68342 16.0976 5.31658 15.7071 5.70711L9.41421 12L15.7071 18.2929C16.0976 18.6834 16.0976 19.3166 15.7071 19.7071C15.3166 20.0976 14.6834 20.0976 14.2929 19.7071L7.29289 12.7071C7.10536 12.5196 7 12.2652 7 12C7 11.7348 7.10536 11.4804 7.29289 11.2929L14.2929 4.29289C14.6834 3.90237 15.3166 3.90237 15.7071 4.29289Z"
        ></path></svg
      >
    </IconButton>
  </div>
  <div class="MenuContainer">
    <slot />
  </div>
</div>

<style>
  .Mask {
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.25);
    position: absolute;
    z-index: 99999;
  }
  .IconButtonContainer {
    align-self: last baseline;
  }
  .IconButtonContainer svg {
    fill: white;
  }
  .MenuContainer {
    padding: 1rem;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }
  .Container {
    width: 0;
    transition: all 0.2s ease;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: start;
    justify-content: start;
    position: absolute;
    left: 0;
    height: 100%;
    z-index: 99999;
    box-shadow:
      0 0.2rem 0.5rem rgba(0, 0, 0, 0.25),
      0 0.1em 0.25rem rgba(0, 0, 0, 0);
    background-color: var(--theme-color-Theme-main);
  }
  .Container.Shown {
    width: 15rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: start;
    justify-content: start;
    position: absolute;
    left: 0;
    height: 100%;
    z-index: 99999;
    box-shadow:
      0 0.2rem 0.5rem rgba(0, 0, 0, 0.25),
      0 0.1em 0.25rem rgba(0, 0, 0, 0);
    background-color: var(--theme-color-Theme-main);
  }
</style>
