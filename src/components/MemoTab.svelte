<script>
  import { tick } from 'svelte';
  import { table_selected_id } from '../stores.js';
  import { ripple, tooltip } from '../common/common.js'
  import IconButton from './IconButton.svelte';
  import Button from "./Button.svelte";
  import Memo from "./Memo.svelte";
  import Dialog from './Dialog.svelte';

  // Dialog
  let show_confirm = false;
  const toggle_confirm = () => {show_confirm = !show_confirm}
  let name_confirm = "";
  const callback_confirm = () => {
    if (deleteMemo(selectedMemoIndex)) {
      selectedMemoIndex = selectedMemoIndex == 0 ? 0: selectedMemoIndex-1;
    }
  }

  // Create a writable store for the memo
  export let memo = [];
  export let saveMemo;
  export let addMemo;
  export let deleteMemo;
  export let renameMemo;
  export let disabled = false;
  let selectedMemoIndex = 0;
  $: if ($table_selected_id) { selectedMemoIndex = 0 }
  $: editedContent = memo.length > selectedMemoIndex ? memo[selectedMemoIndex].content : "";
  let newMemoTitle = "memo";
  
  let inputs = [];
	let edit = false;
	const toggle = async () => {
    if (memo.length > 0) {
      edit = !edit;
      if (edit) {
        await tick();
        inputs[selectedMemoIndex].focus();
      }
    }
	}


</script>

<div class="container">
  <div class="memotab-container">
      <div class="memotab">
      {#if memo.length == 0}
        <span class="memotab-item">{"Tabs here"}</span>
      {:else}
        {#each memo as memo, i (i)}
          <button 
            use:ripple={{duration:350, color:"var(--theme-color-Sub-main)"}} 
            class="memotab-item" 
            class:selected={i == selectedMemoIndex} 
            on:click={() => {selectedMemoIndex = i;}}
          >
            <input
              type="text" 
              value={memo.title} 
              bind:this={inputs[i]}
              disabled={!edit||i!=selectedMemoIndex} 
              on:blur={() => {edit = false;}} 
              on:input={(e) => {renameMemo(e.target.value, selectedMemoIndex)}}
              on:click={(e) => {e.stopPropagation();}} 
              on:keydown={(e) => {if(e.key == "Enter"){edit = false;}}}
              use:tooltip={{
                color:"var(--theme-color-Main-main)", 
                backgroundColor: "var(--theme-color-Sub-main)",
                wrapped: true
              }}
            >
          </button>
        {/each}
      {/if}
      </div>
      <div class="memotab-control">
        <IconButton tooltipContent="Add a memo." {disabled} activeColor={"var(--theme-color-Primary-dark)"} normalColor={"var(--theme-color-Primary-main)"} on:click={() => {if (addMemo(newMemoTitle)) {selectedMemoIndex = memo.length;}}}>
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5V19M5 12H19" stroke="var(--theme-color-Main-main)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </IconButton>
        <IconButton tooltipContent="Delete the selected memo." {disabled} activeColor={"var(--theme-color-Error-dark)"} normalColor={"var(--theme-color-Error-main)"} on:click={() => {show_confirm=true; name_confirm=memo[selectedMemoIndex].title;}}>
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 12L18 12" stroke="var(--theme-color-Main-main)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </IconButton>
        <Button {disabled} variant={"text"} activeColor={"var(--theme-color-Info-dark)"} normalColor={"var(--theme-color-Info-main)"} on:click={toggle} content="rename" />
      </div>
  </div>
  
  <div class="memotab-content">
    {#if memo[selectedMemoIndex]}
      <Memo saveMemo={(editedContent) => saveMemo(editedContent, selectedMemoIndex)} content={editedContent}/>
    {:else}
      <textarea placeholder="No page" disabled></textarea>
    {/if}
  </div>

</div>

<Dialog show={show_confirm} toggle={toggle_confirm} header="Confirm." content={`Do you really delete "${name_confirm}"?`} callback={callback_confirm} />

<style>
	button {
		border: none;
		padding: 0;
    margin: 0;
		border-radius: 0;
		background-color: transparent;
	}
  button:focus-visible {
    outline: auto;
  }
  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
  }
  .memotab-container {
    display: flex;
    flex-direction: row;
    height: 3rem;
    width: 100%;
  }
  .memotab {
    display: flex;
    flex-direction: row;
    height: 2rem;
    padding: 0.5rem;
    overflow-x: auto;
    flex: 1;
  }
  .memotab-control {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    margin-left: auto;
  }
	input {
		border: none;
    padding: 0;
    margin: 0;
    width: 100%;
    text-align: center;
	}
	input:focus {
		outline: auto;
    cursor: text !important;
	}
	input:disabled {
    color: var(--theme-color-Sub-main);
    background-color: transparent;
	}
  input:hover {
    cursor: pointer;
  }
  .memotab-item {
		display: flex;
    box-sizing: border-box;
		height: 100%;
		min-width: 5rem;
    max-width: 10rem;
    padding: 0.5rem;
    flex: 1;
    justify-content: center;
    align-items: center;
    color: var(--theme-color-Sub-main)
  }
	span.memotab-item {
		display: inline-block;
		vertical-align: middle;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
		line-height: 100%;
    cursor: default !important;
	}
  .memotab-item:hover {
    cursor: pointer;
  }
  .selected {
    border-bottom: 0.2rem solid var(--theme-color-Accent-main);
  }
  .memotab-content {
    display: flex;
    box-sizing: border-box;
    height: calc(100% - 5.5rem);
    flex: 1;
    overflow: hidden;
  }
  .memotab-content textarea {
    height: 100%;
    width: 100%;
    flex: 1;
    resize: none;
  }
</style>
