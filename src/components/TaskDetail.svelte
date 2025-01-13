<script>
  import { getNode, setNode } from "../common/tree_control.ts";
  import { tree_data, table_selected_id } from "../stores.js";
  import { throttle } from "lodash";
  import MemoTab from "./MemoTab.svelte";

  $: is_selected = $table_selected_id ? true : false;
  $: node = getNode($table_selected_id, $tree_data.data);
  $: name = node ? node.data["name"] : "Select Task";
  $: memo = node ? node.data["memo"] : [];
  const changeData = (node, key, value) => {
    const id = node.id;
    node = getNode(id, $tree_data.data);
    node = { ...node, data: { ...node.data, [key]: value } };
    let data = setNode(node, $tree_data.data);
    $tree_data = { ...$tree_data, data: data };
  };
  const changeDataThrottle = throttle(changeData, 1000);
  const addMemo = (newMemoTitle) => {
    if (newMemoTitle) {
      let newMemo = { title: newMemoTitle, content: "" };
      changeData(node, "memo", [...node.data.memo, newMemo]);
      return true;
    }
  };
  const deleteMemo = (index) => {
    changeData(
      node,
      "memo",
      node.data.memo.filter((_, i) => i !== index)
    );
    return true;
  };
  const saveMemo = (editedContent, selectedMemoIndex) => {
    memo = [...node.data["memo"]];
    memo[selectedMemoIndex].content = editedContent;
    changeDataThrottle(node, "memo", memo);
    return true;
  };
  const renameMemo = (newMemoTitle, selectedMemoIndex) => {
    if (newMemoTitle) {
      memo = [...node.data["memo"]];
      memo[selectedMemoIndex].title = newMemoTitle;
      changeDataThrottle(node, "memo", memo);
      return true;
    }
  };
</script>

<div class="container">
  <div class="memotab-container">
    {#if is_selected}
      <MemoTab {memo} {saveMemo} {addMemo} {deleteMemo} {renameMemo} />
    {:else}
      <h1
        style="color:var(--theme-color-Sub-main); display:flex; justify-content:center"
      >
        No data.
      </h1>
    {/if}
  </div>
</div>

<style>
  .container {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .memotab-container {
    width: 100%;
    flex: 1;
    height: calc(100% - 3.5rem);
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
</style>
