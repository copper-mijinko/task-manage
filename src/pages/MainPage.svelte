<script>
  import Pane from "@lib/layouts/Pane.svelte";
  import SplitPanes from "@lib/layouts/SplitPanes.svelte";
  import TreeTable from "@features/tasks/components/TreeTable.svelte";
  import GanttPanel from "@features/gantt/components/GanttPanel.svelte";
  import TaskDetail from "@features/tasks/components/TaskDetail.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import Card from "@lib/primitives/Card.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import SearchBox from "@lib/primitives/SearchBox.svelte";
  import { tick } from "svelte";
  import { table_selected_id, tree_data, closed_node_ids, ganttVisible } from "@stores";
  import {
    getNode,
    addNode,
    rmNode,
    getParent,
    moveNodeUp,
    moveNodeDown,
    indentNode,
    outdentNode,
  } from "@features/tasks/utils/tree_control";
  import { getDefaultNode } from "@features/tasks/utils/tree_control";
  import { undoHistory, redoHistory } from "@features/tasks/stores/tree";

  // ページ内検索はstoresから共有

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
  let alert_content = "Cannot delete the root node.";
  const toggle_alert = () => {
    show_alert = !show_alert;
  };

  let detailPaneVisible = true;

  // Add
  export async function handleAdd(e, action) {
    e.stopPropagation();

    if (!$tree_data?.data) {
      return;
    }

    const new_node = getDefaultNode();
    const rootId = $tree_data.data.id;
    // Inserting a sibling next to the EXPLICITLY-selected project root is
    // meaningless: the root has no parent to receive the new node. Surface
    // that as an error rather than silently re-routing the add to "append
    // as child", which used to confuse users into thinking the wrong button
    // worked. (If nothing is selected, we still fall through to the friendly
    // "append under root" behaviour so a single-click on an empty tree
    // creates the first task.)
    if ($table_selected_id === rootId && action === "insert_after") {
      alert_content =
        "Cannot insert a sibling at the project root.\nSelect a task, or use 子タスク追加 to add a child here.";
      show_alert = true;
      return;
    }
    const selectedId = $table_selected_id ?? rootId;
    const addAction = selectedId === rootId ? "append" : action;

    if (selectedId) {
      // 親ノードのIDを特定
      let parentId;
      if (addAction === "append") {
        // appendの場合は選択されているノードが親
        parentId = selectedId;
      } else {
        // insert_afterの場合は選択されているノードの親
        const parentNode = getParent(selectedId, $tree_data.data);
        if (parentNode) {
          parentId = parentNode.id;
        }
      }

      // ノードを追加
      $tree_data.data = addNode(new_node, selectedId, $tree_data.data, addAction);

      // 親ノードが折りたたまれている場合は展開する
      if (parentId && $closed_node_ids.has(parentId)) {
        closed_node_ids.delete(parentId);
      }

      // 新しいノードを選択状態にしてDOMの更新を待つ
      $table_selected_id = new_node.id;
      await tick();

      const newRow = document.getElementById(new_node.id);
      if (newRow) {
        newRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  // Remove
  export function handleRemove(e) {
    e.stopPropagation();
    if ($table_selected_id) {
      const node = getNode($table_selected_id, $tree_data.data);
      if (node && node.id == $tree_data.data.id) {
        alert_content = "Cannot delete the root node.";
        show_alert = true;
        return;
      }
      if (node) {
        show_confirm = true;
        name_confirm = node.data.name;
      }
    }
  }

  // Move / indent helpers — tree_control functions mutate the tree in-place
  // and return the SAME reference, so we must force Svelte reactivity by
  // reassigning the store with a shallow-cloned wrapper.
  function withSelectedNode(updater) {
    if (!$table_selected_id || !$tree_data?.data) return;
    const target = $table_selected_id;
    updater(target, $tree_data.data);
    $tree_data = { ...$tree_data, data: $tree_data.data };
  }
  const handleMoveUp = (e) => {
    e?.stopPropagation?.();
    withSelectedNode(moveNodeUp);
  };
  const handleMoveDown = (e) => {
    e?.stopPropagation?.();
    withSelectedNode(moveNodeDown);
  };
  const handleIndent = (e) => {
    e?.stopPropagation?.();
    withSelectedNode(indentNode);
  };
  const handleOutdent = (e) => {
    e?.stopPropagation?.();
    withSelectedNode(outdentNode);
  };
  const handleExpandAll = () => closed_node_ids.expandAll();
  const handleCollapseAll = () => closed_node_ids.collapseAll();
</script>

{#if $tree_data}
  <div class:Content={true}>
    <SplitPanes defaultRatio={detailPaneVisible ? [3, 2] : [1]}>
      <Pane style={"min-width: 10rem;"}>
        <Card
          title="Task Tree"
          padded={false}
          style={"height: 100%; width: 100%;"}
        >
          <div class="TaskListToolbar">
            <!-- Group 1: Add / Delete -->
            <div class="TbGroup">
              <IconButton
                tooltipContent="タスク追加"
                ariaLabel="タスク追加"
                activeColor={"var(--theme-color-Primary-dark)"}
                normalColor={"var(--theme-color-Primary-main)"}
                on:click={(e) => handleAdd(e, "insert_after")}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
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
                tooltipContent="子タスク追加"
                ariaLabel="子タスク追加"
                variant="outlined"
                activeColor={"var(--theme-color-Primary-main)"}
                normalColor={"var(--theme-color-Primary-main)"}
                on:click={(e) => handleAdd(e, "append")}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M5 4V12C5 13.1 5.9 14 7 14H14"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                  <path
                    d="M11 11L14 14L11 17"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M18 14V18M16 16H20"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="削除"
                ariaLabel="削除"
                variant="text"
                activeColor={"var(--theme-color-Error-main)"}
                normalColor={"var(--theme-color-Error-main)"}
                on:click={(e) => handleRemove(e)}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M3 6H21M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M10 11V17M14 11V17M5 6L6 20C6 20.6 6.4 21 7 21H17C17.6 21 18 20.6 18 20L19 6"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
            <span class="TbSep" aria-hidden="true"></span>

            <!-- Group 2: Move / Indent -->
            <div class="TbGroup">
              <IconButton
                tooltipContent="上に移動 (Alt+↑)"
                ariaLabel="上に移動"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={handleMoveUp}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 19V5M5 12L12 5L19 12"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="下に移動 (Alt+↓)"
                ariaLabel="下に移動"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={handleMoveDown}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 5V19M5 12L12 19L19 12"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="アウトデント (Shift+Tab)"
                ariaLabel="アウトデント"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={handleOutdent}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M21 4H10M21 12H10M21 20H10M7 8L3 12L7 16"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="インデント (Tab)"
                ariaLabel="インデント"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={handleIndent}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M3 4H14M3 12H14M3 20H14M17 8L21 12L17 16"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
            <span class="TbSep" aria-hidden="true"></span>

            <!-- Group 3: Expand / Collapse -->
            <div class="TbGroup">
              <IconButton
                tooltipContent="すべて展開"
                ariaLabel="すべて展開"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={handleExpandAll}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M8 10L12 6L16 10M8 14L12 18L16 14"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="すべて折りたたみ"
                ariaLabel="すべて折りたたみ"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={handleCollapseAll}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M8 6L12 10L16 6M8 18L12 14L16 18"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
            <span class="TbSep" aria-hidden="true"></span>

            <!-- Group 4: Undo / Redo -->
            <div class="TbGroup">
              <IconButton
                tooltipContent="元に戻す (Ctrl+Z)"
                ariaLabel="元に戻す"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={undoHistory}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M3 7L7 3M3 7L7 11M3 7H15C18.3 7 21 9.7 21 13C21 16.3 18.3 19 15 19H9"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent="やり直し (Ctrl+Y)"
                ariaLabel="やり直し"
                variant="text"
                normalColor={"var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={redoHistory}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M21 7L17 3M21 7L17 11M21 7H9C5.7 7 3 9.7 3 13C3 16.3 5.7 19 9 19H15"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </IconButton>
            </div>

            <!-- Tree filter search (filters rows by name) -->
            <div class="TbSearch">
              <SearchBox />
            </div>

            <!-- Group 5: View toggles -->
            <div class="TbGroup">
              <IconButton
                tooltipContent={$ganttVisible ? "ガントチャートを閉じる" : "ガントチャートを表示"}
                ariaLabel="ガントチャートの表示切替"
                variant="text"
                normalColor={$ganttVisible
                  ? "var(--theme-color-Primary-main)"
                  : "var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={() => ($ganttVisible = !$ganttVisible)}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="4" width="4" height="3" rx="0.5" fill="currentColor" />
                  <rect x="3" y="10.5" width="7" height="3" rx="0.5" fill="currentColor" />
                  <rect x="3" y="17" width="5" height="3" rx="0.5" fill="currentColor" />
                </svg>
              </IconButton>
              <IconButton
                tooltipContent={detailPaneVisible ? "Hide detail pane" : "Show detail pane"}
                ariaLabel={detailPaneVisible ? "Hide detail pane" : "Show detail pane"}
                variant="text"
                normalColor={detailPaneVisible
                  ? "var(--theme-color-Primary-main)"
                  : "var(--theme-color-Sub-main)"}
                activeColor={"var(--theme-color-Primary-main)"}
                on:click={() => (detailPaneVisible = !detailPaneVisible)}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect
                    x="3"
                    y="4"
                    width="18"
                    height="16"
                    rx="2"
                    stroke="currentColor"
                    stroke-width="1.8"
                  />
                  <path d="M15 4V20" stroke="currentColor" stroke-width="1.8" />
                </svg>
              </IconButton>
            </div>
          </div>
          <div class="TreeAndGantt">
            {#if $ganttVisible}
              <SplitPanes defaultRatio={[3, 2]}>
                <Pane style={"height: 100%; min-width: 6rem;"}>
                  <div class="TreeTable">
                    <TreeTable />
                  </div>
                </Pane>
                <Pane style={"height: 100%; min-width: 120px;"}>
                  <GanttPanel />
                </Pane>
              </SplitPanes>
            {:else}
              <div class="TreeTable">
                <TreeTable />
              </div>
            {/if}
          </div>
        </Card>
      </Pane>
      {#if detailPaneVisible}
        <Pane style={"min-width: 10rem;"}>
          <div class:TaskDetail={true}>
            <TaskDetail />
          </div>
        </Pane>
      {/if}
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
    content={alert_content}
    ok={false}
    cancel={"close"}
  />
{:else}
  <h1 style="color:var(--theme-color-Sub-main); display:flex; justify-content:center">
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
  .TbGroup {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    margin: 0;
    box-sizing: border-box;
    flex: 0 0 auto;
  }
  .TbSearch {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    margin-left: auto;
    height: 2rem;
    min-width: 8rem;
    max-width: 22rem;
  }
  .TaskListToolbar {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--sp2);
    width: 100%;
    min-width: 0;
    padding: var(--sp2) var(--sp3);
    box-sizing: border-box;
    flex-wrap: wrap;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    flex-shrink: 0;
  }
  .TbSep {
    display: inline-block;
    width: 1px;
    height: 1.5rem;
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    flex: 0 0 auto;
    align-self: center;
  }
  .TreeAndGantt {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .TreeAndGantt :global(.SplitPaneRoot),
  .TreeAndGantt :global(.Pane) {
    min-height: 0;
  }
  .TreeAndGantt :global(.Pane) {
    align-items: stretch;
    justify-content: stretch;
    overflow: hidden;
  }
  .TreeTable {
    height: 100%;
    width: 100%;
    min-height: 0;
    box-sizing: border-box;
    flex: 1;
  }
  :global(::-webkit-scrollbar) {
    width: 0.75rem;
    height: 0.75rem;
  }
  :global(::-webkit-scrollbar-track) {
    border-radius: var(--shape-sm);
    background: rgba(128, 128, 128, 0.5);
  }
  :global(::-webkit-scrollbar-thumb) {
    border-radius: var(--shape-sm);
    background: rgba(128, 128, 128, 0.5);
  }
  div.TaskDetail {
    flex: 1;
    min-height: 0;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    margin: 0;
  }

</style>
