<script>
  import { tick } from 'svelte';
  import { ripple, tooltip } from '../common/common.js';

	export let text;
  export let color = "var(--theme-color-Sub-main)"
  export let backgroundColor = "transparent"
	let input;
  let wrapper;
	let disabled = true;
  const params = {
    color:"var(--theme-color-Main-main)", 
    backgroundColor: "var(--theme-color-Sub-main)",
    wrapped: true,
  }
	const toggle = async () => {
		disabled = !disabled;
		if (!disabled) {
			await tick();
			input.focus();
		}
	}
</script>

<div 
  style="--color:{color}; --backgroundColor:{backgroundColor};" 
  bind:this={wrapper}
>
  <input 
    type="text" 
    bind:this={input} 
    value={text} 
    {disabled} 
    draggable="true" 
    on:blur={() => {disabled = true;}} 
    on:input 
    on:click={(e) => {e.stopPropagation();}} 
    on:keydown={(e) => {if(["Enter", "Escape"].includes(e.key)){disabled = true;}}}
    on:dragstart={(e) => {if(!disabled){e.preventDefault(); e.stopPropagation();}}}
    on:drag={(e) => {if(!disabled){e.preventDefault(); e.stopPropagation();}}}
    on:dragend={(e) => {if(!disabled){e.preventDefault(); e.stopPropagation();}}}
    use:tooltip={params}
  >
  <button use:ripple={{duration:350, color:color}}  on:click={(e) => {e.stopPropagation(); toggle();}}>
    <svg height="100%" viewBox="-4 -4 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M18.111,2.293,9.384,11.021a.977.977,0,0,0-.241.39L8.052,14.684A1,1,0,0,0,9,16a.987.987,0,0,0,.316-.052l3.273-1.091a.977.977,0,0,0,.39-.241l8.728-8.727a1,1,0,0,0,0-1.414L19.525,2.293A1,1,0,0,0,18.111,2.293ZM11.732,13.035l-1.151.384.384-1.151L16.637,6.6l.767.767Zm7.854-7.853-.768.767-.767-.767.767-.768ZM3,5h8a1,1,0,0,1,0,2H4V20H17V13a1,1,0,0,1,2,0v8a1,1,0,0,1-1,1H3a1,1,0,0,1-1-1V6A1,1,0,0,1,3,5Z"></path></svg>
  </button>
</div>

<style>
  div {
    width: 100%;
    height: 100%;
    padding: 0 0.5rem;
    margin: 0;
    display: flex;
    align-items: center;
    flex: 1;
  }
	input {
		border: none;
    padding: 0;
    margin: 0;
    width: 100%;
    position: relative;
	}
	input:focus {
		outline: auto;
	}
	input:disabled {
    background-color: var(--backgroundColor);
    color: var(--color)
	}
  button {
    height: calc(100% - 0.5rem);
    aspect-ratio: 1;
    display: flex;
    justify-content: center;
    align-items: center;
		border-radius: 50%;
    border: none;
    cursor: pointer;
    background-color: transparent !important;
    margin: 0.25rem;
    padding: 0;
  }
	button:focus-visible {
		outline: auto;
	}
  button svg {
    fill: var(--color);
  }
</style>
