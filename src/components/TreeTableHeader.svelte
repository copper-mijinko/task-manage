<script>
	import { filter } from "../stores.js";
  import MultiSelect from "./MultiSelect.svelte";
  export let headers;
	let selected = [];
	$: $filter = {...$filter, "status": selected.length > 0? selected: undefined}
</script>

<div class:TableRow={true}>
	{#each headers as header}
		<div class:TableHeader={true}>
			<div style="display: flex; flex: 1; width:100%; height:100%; justify-content: center; align-items: center;">
				<span class:TextOverFlow={true}>{header.name}</span>
			</div>
			{#if header.name == "status"}
			<div style="display: flex; flex: 1; width:100%; height:100%; justify-content: center; align-items: center;">
				<MultiSelect 
					bind:selected={selected}
					list = {["Open", "Pending", "In Progress", "Completed", "Canceled"]}
					placeholder = "No filter."
				/>
			</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.TableRow {
		position: sticky;
		top: 0;
		display: flex;
		flex-grow: 1;
    box-sizing: border-box;
		height: 4rem;
		padding: 0;
    width: 100%;
		z-index: 9999;
	}
	.TableHeader {
		position: relative;
		height: 4rem;
    box-sizing: border-box;
		min-width: 4rem;
		display: flex;
		flex-direction: column;
		border-right: 1px solid;
		border-left: 1px solid;
		border-bottom: 1px solid;
		background-color: var(--theme-color-Sub-light);
		color: var(--theme-color-Main-light);
		align-items: center;
		justify-content: center;
		font-weight: bold;
  }
	.TableHeader:last-child {
		border-right: 0px;
	}
	.TableHeader:first-child {
		border-left: 0px;
	}
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
</style>