<script>
  import { selected_type, selected_id, init_store } from "./stores.js";
  import ProjectPage from "./components/ProjectPage.svelte";
  import Header from "./components/Header.svelte";
  import InfoPage from "./components/InfoPage.svelte";
  import Modal from "./components/Modal.svelte";
  import Button from "./components/Button.svelte";

  let show = Array(4).fill(false);

  ////////////// Initial Settings //////////////
  init_store();
</script>

<div class:Container={true}>
  <div class="Header">
    <Header />
  </div>
  <div class="Main">
    {#if !($selected_type && $selected_id)}
      <h1
        style="color:var(--theme-color-Sub-main); display:flex; justify-content:center"
      >
        No data.
      </h1>
    {/if}
    {#if $selected_type == "Projects"}
      <ProjectPage />
    {/if}
    {#if $selected_type == "Info"}
      <div
        style="height:100%; display: flex; flex-direction: column; justify-content: center; align-items: center;"
      >
        {#each [1, 2, 3, 4] as i}
          <Button
            content="Setp{i}"
            on:click={() => {
              show[i - 1] = !show[i - 1];
            }}
          />
          <Modal
            show={show[i - 1]}
            toggle={() => {
              show[i - 1] = !show[i - 1];
            }}
          >
            <InfoPage index={i} />
          </Modal>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  :global(html) {
    font-size: 75%;
  }
  :global(body) {
    font-family: "Roboto", "Helvetica", "Arial", sans-serif;
    padding: 0;
    margin: 0;
  }
  div.Container {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    width: 100%;
    background-color: var(--theme-color-Main-dark);
    margin: 0;
    padding: 0;
    overflow: auto;
  }
  div.Header {
    height: 3.5rem;
  }
  div.Main {
    display: flex;
    justify-content: center;
    align-items: center;
    height: calc(100% - 3.5rem);
    width: 100%;
    flex: 1;
  }
</style>
