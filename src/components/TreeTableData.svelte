<script context="module">
	let dragged_id;  // Share this in TreeTableData components.
</script>

<script>
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { tree_data, table_selected_id, not_expanded_ids } from '../stores.js';
	import { isChild, reorderTree, setNode } from '../common/tree_control.ts'
	import { ripple } from '../common/common.js';
  import { THEME_DARK } from '../common/theme.js';
  import { theme } from '../stores.js';
	import TextInput from './TextInput.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import DateInput from './DateInput.svelte';
  
	// node;
	export let node;
  $: id = node.id;
  $: data = node.data;
  $: children = node.children;

  export let depth = 0;

	let table_row; //Bind

	$: HasChildren = children.length > 0;
  $: Expanded = ! $not_expanded_ids.has(id);
	$: Selected = $table_selected_id == id;

  $: is_dark = $theme == THEME_DARK;

	function select(e) {
		e.stopPropagation();
		$table_selected_id = id;
	}

	function toggle(e) {
		e.stopPropagation();
		if ($not_expanded_ids.has(id)) {
			$not_expanded_ids.delete(id);
		} else {
			$not_expanded_ids.add(id);
		}
		Expanded = ! $not_expanded_ids.has(id); // for reactive doesn't work.
	}

  const changeData = (node, key, value) => {
    node = {...node, "data": {...node.data, [key]: value}};
    let data = setNode(node, $tree_data.data);
    $tree_data = {...$tree_data, "data": data}
  };

	onMount(() => {
		// set z-index
		let datas = table_row.querySelectorAll(".TableData");
		datas.forEach((data, index) => {
			data.style.zIndex  = index + 100;
		});

		// set drag'n drop
		setDND();
	});

	// drag'n drop
	let dragOverType;
	function dragStart(e) {
		this.classList.add("Dragging");

		const name_text = this.querySelector("div:first-child div:last-child input").value;
		const name_tag = document.createElement('div');
		name_tag.classList.add('NameTag');
		name_tag.innerText = name_text;
		document.body.appendChild(name_tag);

		const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
		e.dataTransfer.setDragImage(name_tag, -rem, -rem);

		dragged_id = e.currentTarget.id;
	}

	function dragEnd() {
		dragOverType = undefined;
		this.classList.remove("Dragging");
		document.querySelector(".NameTag").remove();
	}

	function dragOver(e) {
		e.preventDefault();
		if (! this.classList.contains("Dragging") 
		&& ! isChild(this.id, dragged_id, $tree_data.data) 
		&& this.id != $tree_data.data.id) {
			const rect = this.getBoundingClientRect();
			const y = e.clientY;
			if (y <= rect.top + rect.height/2) {
				if (dragOverType != "DragOverTop") {
					dragOverType = "DragOverTop";
					this.classList.remove("DragOverBottom");
					this.classList.add("DragOverTop");
				}
			} else if (dragOverType != "DragOverBottom") {
					dragOverType = "DragOverBottom";
					this.classList.remove("DragOverTop");
					this.classList.add("DragOverBottom");
			}
		}
	}

	function dragLeave() {
		dragOverType = undefined;
		this.classList.remove("DragOverTop");
		this.classList.remove("DragOverBottom");
	}

	function dragDrop() {
		switch(dragOverType) {
			case "DragOverTop":
				$tree_data.data = reorderTree(dragged_id, this.id, $tree_data.data, "insert");
				this.classList.remove("DragOverTop");
				break;
			case "DragOverBottom":
				$tree_data.data = reorderTree(dragged_id, this.id, $tree_data.data, "append");
				this.classList.remove("DragOverBottom");
				break;
		}
		dragOverType = undefined;
		dragged_id = undefined;
	}

	function setDND() {
		// drag item
		table_row.addEventListener('dragstart', dragStart);
		table_row.addEventListener('dragend', dragEnd);

		// drop area
		table_row.addEventListener('dragover', dragOver);
		table_row.addEventListener('dragleave', dragLeave);
		table_row.addEventListener('drop', dragDrop);
	}
</script>

<button bind:this={table_row} id={id} class:TableRow={true} class:Selected use:ripple on:click={select} draggable="true">
  {#each $tree_data.headers as header, i}
    <div class:TableData={true} class:HasChildren>
			{#if header.name == "name"}
				{#each [...Array(depth)].map((_, i) => i) as i}
					<div class:TreeLine={true} style="flex-shrink: 0"/>
				{/each}
				{#if HasChildren}
					<button class:Expanded class:ExpandButton={true} style="flex-shrink: 0" on:click={toggle}>
						<svg viewBox="-12 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M0.88 23.28c-0.2 0-0.44-0.080-0.6-0.24-0.32-0.32-0.32-0.84 0-1.2l5.76-5.84-5.8-5.84c-0.32-0.32-0.32-0.84 0-1.2 0.32-0.32 0.84-0.32 1.2 0l6.44 6.44c0.16 0.16 0.24 0.36 0.24 0.6s-0.080 0.44-0.24 0.6l-6.4 6.44c-0.2 0.16-0.4 0.24-0.6 0.24z"></path></svg>
					</button>
				{/if}
				<TextInput text={data[header.name]} on:input={(e) => {changeData(node, "name", e.target.value);}} />
			{:else if header.name == "status"}
				<StatusSelect node={node} status={data[header.name]} />
			{:else if header.name == "due date"}
				<DateInput {is_dark} id="due-date" backgroundColor={"var(--backgroundColor)"} value={data[header.name]} on:change={(e) => {changeData(node, "due date", e.target.value)}} />
			{:else}
				<span class:TextOverFlow={true} >{header.name == "memo" ? data[header.name].length : data[header.name]}</span>
			{/if}
		</div>
  {/each}
</button>
{#if Expanded}
	{#each children as child}
		<div style="display: flex; flex-direction: column">
			<svelte:self depth={depth + 1} node={child} />
		</div>
	{/each}
{/if}

<style>
	button {
		border: none;
		padding: 0;
    margin: 0;
		border-radius: 0;
		background-color: transparent;
	}
	:global(.NameTag) {
		position: absolute;
		top: -1000rem;
		display: inline;
		background-color:var(--theme-color-Accent-dark);
		border: 1px solid var(--theme-color-Accent-dark);
		color: var(--theme-color-Sub-main);
		padding: 0 0.5rem;
	}
	.TableRow:global(.Dragging) {
		opacity: 0.6;
	}
	.TableRow:global(.DragOverTop):before {
		border-top: 0.2rem solid var(--theme-color-Accent-dark);
		position: absolute;
		content: "";
		height: 2rem;
		padding: 0;
    width: 100%;
		box-sizing: border-box;
		z-index: 999999999999;
		pointer-events: none;
	}
	.TableRow:global(.DragOverBottom):before {
		border: 0.2rem solid var(--theme-color-Accent-dark);
		position: absolute;
		content: "";
		height: 2rem;
		padding: 0;
    width: 100%;
		box-sizing: border-box;
		z-index: 999999999999;
		pointer-events: none;
	}
	.TableRow {
		display: flex;
		flex-direction: row;
    box-sizing: border-box;
    position: relative;
		height: 2rem;
		padding: 0;
    width: 100%;
	}
	.TableRow :global(*) {
		--backgroundColor: var(--theme-color-Main-light);
	}
	.TableRow:focus-visible {
		outline: auto;
		z-index: 999;
	}
	.TableRow:hover :global(*), .TableRow.Selected :global(*) {
		--backgroundColor: var(--theme-color-Main-main);
	}
	.TableRow:hover .TableData {
		background-color: var(--backgroundColor);
	}
	.TableRow:hover::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		width: .2rem;
		height: 100%;
		background-color: var(--theme-color-Accent-dark);
		z-index: 999;
	}
	.TableRow.Selected::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		width: .2rem;
		height: 100%;
		background-color: var(--theme-color-Accent-dark);
		z-index: 999;
	}
	.TableData {
		display: flex;
		position: relative;
    box-sizing: border-box;
		height: 100%;
		min-width: 4rem;
		background-color: var(--backgroundColor);
		padding: 0 .5rem;
		align-items: center;
		color: var(--theme-color-Sub-light);
  }
	.TableData span {
		flex: 1;
		flex-shrink: 0;
		display: flex;
		justify-content: center;
		align-items: center;
	}
	.TreeLine {
		position: relative;
		display: inline-block;
		height: 100%;
		width: 1rem;
		margin-left: 1rem;
		border-left: 1px solid gray;
	}
	.ExpandButton:focus-visible {
		outline: auto;
		z-index: 999;
	}
	.HasChildren:first-child .ExpandButton {
		cursor: pointer;
		width: 1.5rem;
		height: 1.5rem;
		margin: 0.25rem;
		border-radius: 50%;
		transform: rotate(0deg);
		transition: all 0.05s ease;
	}
	.HasChildren:first-child .ExpandButton svg {
		width: 100%;
		height: 100%;
		fill: var(--theme-color-Sub-light);
	}
	.HasChildren:first-child .ExpandButton.Expanded {
		transform: rotate(90deg);
	}
	:not(.HasChildren) .ExpandButton {
		width: 1rem;
		height: 1rem;
	}
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
</style>