<script>
  import Pane from "./Pane.svelte";
  import SplitPanes from "./SplitPanes.svelte";
  import TreeTable from "./TreeTable.svelte";
  import TaskDetail from "./TaskDetail.svelte";
  import IconButton from "./IconButton.svelte";
  import Card from "./Card.svelte";
  import Dialog from "./Dialog.svelte";
  import SearchBox from "./SearchBox.svelte";
  import { table_selected_id, tree_data, closed_node_ids } from "../stores.js";
  import {
    getNode,
    addNode,
    rmNode,
    getParent,
  } from "../common/tree_control.ts";
  import { getDefaultNode } from "../common/tree_control.ts";

  // Dialog
  let show_confirm = false;
  const toggle_confirm = () => {
    show_confirm = !show_confirm;
  };
  let name_confirm = "";
  const callback_confirm = () => {
    $tree_data.data = rmNode($table_selected_id, $tree_data.data);
    $table_selected_id = undefined;
  };

  let show_alert = false;
  const toggle_alert = () => {
    show_alert = !show_alert;
  };

  // Add
  export function handleAdd(e, action) {
    e.stopPropagation();

    const new_node = getDefaultNode();
    if ($table_selected_id) {
      // 親ノードのIDを特定
      let parentId;
      if (action === "append") {
        // appendの場合は選択されているノードが親
        parentId = $table_selected_id;
      } else {
        // insert_afterの場合は選択されているノードの親
        const parentNode = getParent($table_selected_id, $tree_data.data);
        if (parentNode) {
          parentId = parentNode.id;
        }
      }

      // ノードを追加
      $tree_data.data = addNode(
        new_node,
        $table_selected_id,
        $tree_data.data,
        action,
      );

      // 親ノードが折りたたまれている場合は展開する
      if (parentId && $closed_node_ids.has(parentId)) {
        closed_node_ids.delete(parentId);
      }

      // 新しいノードを選択状態にする
      setTimeout(() => {
        $table_selected_id = new_node.id;

        // DOMの更新を待ってからスクロール処理を行う
        setTimeout(() => {
          const newRow = document.getElementById(new_node.id);
          if (newRow) {
            newRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }, 50); // 少し長めのタイムアウトで確実にDOMが更新されるのを待つ
      }, 0);
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
              <IconButton
                tooltipContent="Add a task under the selected one."
                activeColor={"var(--theme-color-Primary-dark)"}
                normalColor={"var(--theme-color-Primary-main)"}
                on:click={(e) => handleAdd(e, "insert_after")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  ><path
                    d="M12 5V19M5 12H19"
                    stroke="var(--theme-color-Main-main)"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  ></path></svg
                >
              </IconButton>
              <IconButton
                tooltipContent="Add a child task under the selected one."
                activeColor={"var(--theme-color-Primary-dark)"}
                normalColor={"var(--theme-color-Primary-main)"}
                on:click={(e) => handleAdd(e, "append")}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 52 52"
                  fill="var(--theme-color-Main-main)"
                >
                  <g transform="translate(-1159 -1592)">
                    <path
                      stroke="var(--theme-color-Main-main)"
                      d="M1168 1604.54 1171.06 1604.54 1171.06 1626.52 1186.59 1626.52 1181.61 1621.39 1183.77 1619.17 1192.41 1628.05 1192.38 1628.09 1192.41 1628.12 1183.77 1637 1181.61 1634.78 1186.59 1629.66 1171.06 1629.66 1168 1629.66ZM1192.41 1599C1193.26 1599 1193.95 1599.71 1193.95 1600.59L1193.95 1608.3 1201.46 1608.3C1202.31 1608.3 1203 1609.01 1203 1609.88L1203 1609.88C1203 1610.76 1202.31 1611.47 1201.46 1611.47L1193.95 1611.47 1193.95 1619.18C1193.95 1620.06 1193.26 1620.77 1192.41 1620.77L1192.41 1620.77C1191.56 1620.77 1190.87 1620.06 1190.87 1619.18L1190.87 1611.47 1183.36 1611.47C1182.51 1611.47 1181.82 1610.76 1181.82 1609.88 1181.82 1609.01 1182.51 1608.3 1183.36 1608.3L1190.87 1608.3 1190.87 1600.59C1190.87 1599.71 1191.56 1599 1192.41 1599Z"
                    />
                  </g>
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="Delete the selected task."
                activeColor={"var(--theme-color-Error-dark)"}
                normalColor={"var(--theme-color-Error-main)"}
                on:click={(e) => handleRemove(e)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="var(--theme-color-Main-main)"
                  viewBox="0 0 48 48"
                  ><path
                    stroke="var(--theme-color-Main-main)"
                    d="M13.05 42q-1.25 0-2.125-.875T10.05 39V10.5H8v-3h9.4V6h13.2v1.5H40v3h-2.05V39q0 1.2-.9 2.1-.9.9-2.1.9Zm21.9-31.5h-21.9V39h21.9Zm-16.6 24.2h3V14.75h-3Zm8.3 0h3V14.75h-3Zm-13.6-24.2V39Z"
                  /></svg
                >
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
  <Dialog
    show={show_confirm}
    toggle={toggle_confirm}
    header="Confirm."
    content={`Do you really delete "${name_confirm}"?\nThis may delete child nodes.`}
    callback={callback_confirm}
  />
  <Dialog
    show={show_alert}
    toggle={toggle_alert}
    header="Alert."
    content={"Cannot delete the root node."}
    ok={false}
    cancel={"close"}
  />
{:else}
  <h1
    style="color:var(--theme-color-Sub-main); display:flex; justify-content:center"
  >
    Loading...
  </h1>
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
    margin: 0.5rem;
    box-sizing: border-box;
  }
  .SearchBox {
    display: flex;
    flex-direction: row;
    height: 3rem;
    margin: 0.5rem;
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
    width: 0.75rem;
    height: 0.75rem;
  }
  :global(::-webkit-scrollbar-track) {
    border-radius: 0.5rem;
    background: rgba(128, 128, 128, 0.5);
  }
  :global(::-webkit-scrollbar-thumb) {
    border-radius: 0.5rem;
    background: rgba(128, 128, 128, 0.5);
  }
  div.TaskDetail {
    height: calc(100% - 2rem);
    width: calc(100% - 2rem);
    box-sizing: border-box;
    margin: 1rem;
  }
</style>
