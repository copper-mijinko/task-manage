<script>
  import IconButton from "./IconButton.svelte";
  import { tooltip } from "../common/common.js";
  import { filter } from "../stores.js";

  let search_text = "";
  let search_key = "name";
  let search_box; //bind
  const search = () => {
    console.log(search_key, search_text);
    $filter = {
      ...$filter,
      name: search_text != "" ? [search_text] : undefined,
    };
    console.log($filter);
  };
  const params = {
    color: "var(--theme-color-Main-main)",
    backgroundColor: "var(--theme-color-Sub-main)",
    wrapped: true,
  };
</script>

<div>
  <input
    class="SearchBoxInput"
    type="text"
    bind:this={search_box}
    bind:value={search_text}
    draggable="false"
    on:blur
    on:input
    on:click={(e) => {
      e.stopPropagation();
    }}
    on:keydown={(e) => {
      if ("Enter" == e.key) {
        search();
        search_box.blur();
      } else if ("Escape" == e.key) {
        search_box.blur();
      }
    }}
    use:tooltip={params}
  />
  <IconButton
    on:click={() => {
      search();
    }}
    use_ripple={true}
    normalColor="var(--theme-color-Shadow-sub)"
    activeColor="var(--theme-color-Shadow-sub-translucent)"
    style={"box-shadow: none; width: 2rem; height: 2rem;"}
  >
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
      ><path
        d="M15.7955 15.8111L21 21M18 10.5C18 14.6421 14.6421 18 10.5 18C6.35786 18 3 14.6421 3 10.5C3 6.35786 6.35786 3 10.5 3C14.6421 3 18 6.35786 18 10.5Z"
        stroke="#000000"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  </IconButton>
</div>

<style>
  div {
    width: 20rem;
    height: 2rem;
    margin: 0.5rem;
    display: flex;
    flex-direction: row;
    align-items: center;
    box-sizing: border-box;
  }
  .SearchBoxInput {
    box-sizing: border-box;
    margin: 0;
    padding: 0 1rem;
    height: 100%;
    width: calc(100% - 2rem);
    border-radius: 100vh;
  }
</style>
