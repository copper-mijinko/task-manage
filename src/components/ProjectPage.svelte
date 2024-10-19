<script>
  import Pane from './Pane.svelte';
  import SplitPanes from './SplitPanes.svelte';
	import TreeTable from './TreeTable.svelte'
  import TaskDetail from './TaskDetail.svelte'
  import IconButton from './IconButton.svelte';
  import Card from './Card.svelte';
  import Dialog from './Dialog.svelte';
  import SearchBox from './SearchBox.svelte';
  import { table_selected_id, tree_data } from '../stores.js';
  import { getNode, addNode, rmNode } from '../common/tree_control.ts'
  import { getDefaultNode } from '../common/tree_control.ts';

  // Dialog
  let show_confirm = false;
  const toggle_confirm = () => {show_confirm = !show_confirm}
  let name_confirm = "";
  const callback_confirm = () => {
    $tree_data.data = rmNode($table_selected_id, $tree_data.data);
    $table_selected_id = undefined;
  }

  let show_alert = false;
  const toggle_alert = () => {show_alert = !show_alert}

  // Add
  export function handleAdd(e, action) {
    e.stopPropagation();

    const new_node = getDefaultNode();
    if ($table_selected_id) {
      $tree_data.data = addNode(new_node, $table_selected_id, $tree_data.data, action);
    }
  }
  
  // Remove
  export function handleRemove(e) {
    e.stopPropagation();
    if ($table_selected_id) {
      const node = getNode($table_selected_id, $tree_data.data);
      if (node && node.id == $tree_data.data.id) {
        show_alert = true;
        return;
      }
      if (node) {
        show_confirm = true;
        name_confirm = node.data.name;
      }
    }
  }
</script>

{#if $tree_data}
    <div class:Content={true}>
      <SplitPanes defaultRatio={[3, 2]}>
        <Pane style={"padding: 1rem; min-width: 10rem;"}>
          <Card style={"height: 100%; width: 100%; padding: 1rem;"}>
            <div style="display: flex; flex-direction: row">
              <div class:TableButtons={true}>
                <IconButton tooltipContent="Add a task under the selected one." activeColor={"var(--theme-color-Primary-dark)"} normalColor={"var(--theme-color-Primary-main)"} on:click={(e) => handleAdd(e, "insert_after")}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="var(--theme-color-Main-main)" viewBox="0 0 48 48"><path stroke="var(--theme-color-Main-main)" d="m24 40-2.1-2.15L34.25 25.5H8v-3h26.25L21.9 10.15 24 8l16 16Z"/></svg>
                </IconButton>
                <IconButton tooltipContent="Add a child task under the selected one." activeColor={"var(--theme-color-Primary-dark)"} normalColor={"var(--theme-color-Primary-main)"} on:click={(e) => handleAdd(e, "append")}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="var(--theme-color-Main-main)" viewBox="0 0 48 48"><path stroke="var(--theme-color-Main-main)" d="m28.3 42-2.15-2.15 8.1-8.1H10V8h3v20.75h21.3l-8.1-8.1 2.15-2.15L40 30.15Z"/></svg>
                </IconButton>
                <IconButton tooltipContent="Delete the selected task." activeColor={"var(--theme-color-Error-dark)"} normalColor={"var(--theme-color-Error-main)"} on:click={(e) => handleRemove(e)}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="var(--theme-color-Main-main)" viewBox="0 0 48 48"><path stroke="var(--theme-color-Main-main)" d="M13.05 42q-1.25 0-2.125-.875T10.05 39V10.5H8v-3h9.4V6h13.2v1.5H40v3h-2.05V39q0 1.2-.9 2.1-.9.9-2.1.9Zm21.9-31.5h-21.9V39h21.9Zm-16.6 24.2h3V14.75h-3Zm8.3 0h3V14.75h-3Zm-13.6-24.2V39Z"/></svg>
                </IconButton>
              </div>
                <div class:SearchBox={true}>
                  <SearchBox />
                </div>
              </div>
            <Card>
              <div class:TreeTable={true}>
                <TreeTable />
              </div>
            </Card>
          </Card>
        </Pane>
        <Pane style={"padding: 1rem; min-width: 10rem;"}>
          <Card style={"height: 100%; width: 100%;"}>
            <div class:TaskDetail={true}>
              <TaskDetail />
            </div>
          </Card>
        </Pane>
      </SplitPanes>
    </div>
    <Dialog show={show_confirm} toggle={toggle_confirm} header="Confirm." content={`Do you really delete "${name_confirm}"?\nThis may delete child nodes.`} callback={callback_confirm} />
    <Dialog show={show_alert} toggle={toggle_alert} header="Alert." content={"Cannot delete the root node."} ok={false} cancel={"close"} />
{:else}
  <h1 style="color:var(--theme-color-Sub-main); display:flex; justify-content:center">Loading...</h1>
{/if}

<style>
  div.Content {
		display: flex;
    flex: 1;
		flex-direction: row;
    box-sizing: border-box;
    height: 100%;
    background-color: var(--theme-color-Main-dark);
    margin: 0;
    padding: 0;
    overflow: auto;
  }
  .TableButtons {
		display: flex;
		flex-direction: row;
    height: 3rem;
    margin: .5rem;
    box-sizing: border-box;
  }
  .SearchBox {
		display: flex;
		flex-direction: row;
    height: 3rem;
    margin: .5rem;
    box-sizing: border-box;
    margin-left: auto;
  }
  .TreeTable {
    height: calc(100% - 4rem);
    width: 100%;
    box-sizing: border-box;
    flex: 1;
  }
	:global(::-webkit-scrollbar) {
		width: .75rem;
		height: .75rem;
	}
	:global(::-webkit-scrollbar-track) {
		border-radius: .5rem;
		background: rgba(128, 128, 128, .5);
	}
	:global(::-webkit-scrollbar-thumb) {
		border-radius: .5rem;
		background: rgba(128, 128, 128, .5);
	}
	div.TaskDetail {
    height: calc(100% - 2rem);
    width: calc(100% - 2rem);
    box-sizing: border-box;
		margin: 1rem;
	}
</style>
