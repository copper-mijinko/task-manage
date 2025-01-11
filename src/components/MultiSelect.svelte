<script>
  import IconButton from "./IconButton.svelte";
  import { clickOutside, ripple } from "../common/common.js";
  export let list = ["first", "second", "third"];
  export let selected = [];
  export let placeholder = "Not selected.";
  let checked = Array.from(list).fill(false);
  let expanded = false;
  $: selected = list.filter((elm, i) => checked[i]);
</script>

<div
  class="container"
  use:clickOutside
  on:outclick={() => {
    expanded = false;
  }}
>
  <div class="selectContainer">
    <button
      on:click={(e) => {
        expanded = !expanded;
        e.stopPropagation();
      }}
      use:ripple
    >
      <div class="svgContainer">
        <svg
          class:emphasized={selected.length > 0}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          ><path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M3 7C3 6.44772 3.44772 6 4 6H20C20.5523 6 21 6.44772 21 7C21 7.55228 20.5523 8 20 8H4C3.44772 8 3 7.55228 3 7ZM6 12C6 11.4477 6.44772 11 7 11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H7C6.44772 13 6 12.5523 6 12ZM9 17C9 16.4477 9.44772 16 10 16H14C14.5523 16 15 16.4477 15 17C15 17.5523 14.5523 18 14 18H10C9.44772 18 9 17.5523 9 17Z"
          ></path></svg
        >
      </div>
      <div class="selection" class:expanded>
        {selected.length == 0
          ? placeholder
          : selected.length == 1
            ? selected[0]
            : `${selected.length} selected.`}
      </div>
      {#if selected.length > 0}
        <IconButton
          style={"margin: 0rem; padding: 0.25rem; margin-left: auto; width: 1.5rem; height: 1.5rem; flex-shrink: 0;"}
          on:click={(e) => {
            expanded = false;
            checked = checked.fill(false);
            e.stopPropagation();
          }}
          activeColor={"transparent"}
          normalColor={"transparent"}
        >
          <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg"
            ><rect id="view-box" width="24" height="24" fill="none"></rect>
            <path
              id="Shape"
              d="M9.291,10.352l-4-4-4.005,4A.75.75,0,1,1,.22,9.291l4.005-4L.22,1.281A.75.75,0,0,1,1.281.22L5.286,4.225l4-4.005a.75.75,0,1,1,1.061,1.061l-4,4.005,4,4a.75.75,0,0,1-1.061,1.061Z"
              transform="translate(6.629 6.8)"
            ></path></svg
          >
        </IconButton>
      {/if}
    </button>
  </div>
  {#if expanded}
    <div class="listContainer">
      {#each list as elm, i}
        <div class="elmContainer">
          <input
            style="margin: auto 0.25rem;"
            id={elm}
            type="checkbox"
            bind:checked={checked[i]}
          />
          <label style="margin: auto 0.25rem;" for={elm}>{elm}</label>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  button {
    display: flex;
    align-items: center;
    border: none;
    border-radius: 0;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    background-color: transparent;
    flex-shrink: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    color: var(--theme-color-Main-light);
  }
  button:focus-visible {
    outline: auto;
  }
  button:active {
    background-color: transparent;
  }
  svg.emphasized {
    fill: var(--theme-color-Accent-main);
  }
  svg {
    fill: var(--theme-color-Main-light);
  }
  .container {
    width: 100%;
    height: 2rem;
    box-sizing: border-box;
    padding: 0;
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    font-weight: 1;
    border-radius: 0.5rem;
  }
  .svgContainer {
    margin: 0;
    padding: 0.25rem;
    width: 1.5rem;
    height: 1.5rem;
    flex-shrink: 0;
  }
  .selectContainer {
    display: flex;
    flex-direction: row;
    align-items: center;
    height: 100%;
    width: 100%;
    flex: 1;
  }
  .listContainer {
    padding: 1rem;
    position: fixed;
    display: flex;
    flex-direction: column;
    justify-content: center;
    z-index: 999999999999;
    background-color: var(--theme-color-Sub-light);
    color: var(--theme-color-Main-light);
  }
  .elmContainer {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin: 0.25rem;
  }
  .selection {
    padding: 0 0.25rem;
    overflow: hidden;
    box-sizing: border-box;
  }
  .expanded {
    border: 1px solid gray;
    border-radius: 0.25rem;
  }
</style>
