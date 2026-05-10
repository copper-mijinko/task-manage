<script>
  import { getNode, updateNodeDataById } from "../common/tree_control.ts";
  import { uuidV4 } from "../common/uuid";
  import {
    tree_data,
    table_selected_id,
    cancelPendingOperations,
    selected_type,
    selected_id,
    workspace_store,
    tag_index,
  } from "../stores.ts";
  import { debounce } from "lodash";
  import { onDestroy } from "svelte";
  import MemoTab from "./MemoTab.svelte";

  $: is_selected = $table_selected_id ? true : false;
  $: node =
    $table_selected_id && $tree_data ? getNode($table_selected_id, $tree_data.data) : undefined;
  $: name = node ? node.data["name"] : "Select Task";
  $: memo = node ? node.data["memo"] : [];
  $: isWorkspaceProject = $selected_type === "WorkspaceProject";
  $: workspaceProjectDir = isWorkspaceProject ? $workspace_store.activeProjectDir : null;

  const getEditContext = () => ({
    selectedType: $selected_type,
    selectedId: $selected_id,
    tableSelectedId: $table_selected_id,
    activeProjectDir: $workspace_store.activeProjectDir,
  });

  const contextMatches = (context) =>
    context &&
    context.selectedType === $selected_type &&
    context.selectedId === $selected_id &&
    context.tableSelectedId === $table_selected_id &&
    context.activeProjectDir === $workspace_store.activeProjectDir;

  const changeData = (node, key, value, editContext = getEditContext()) => {
    if (!contextMatches(editContext)) {
      return;
    }
    if (!node) {
      return;
    }
    const data = updateNodeDataById($tree_data.data, node.id, { [key]: value });
    if (data !== $tree_data.data) {
      $tree_data = { ...$tree_data, data };
    }
  };
  const changeDataDebounce = debounce(changeData, 500);
  let previousEditContextKey = "";

  $: editContextKey = [
    $selected_type ?? "",
    $selected_id ?? "",
    $table_selected_id ?? "",
    $workspace_store.activeProjectDir ?? "",
  ].join(":");

  $: if (editContextKey !== previousEditContextKey) {
    changeDataDebounce.cancel();
    previousEditContextKey = editContextKey;
  }

  const unsubscribeCancelPending = cancelPendingOperations.subscribe(() => {
    changeDataDebounce.cancel();
  });

  onDestroy(() => {
    changeDataDebounce.cancel();
    unsubscribeCancelPending();
  });
  $: allTags = [...$tag_index.keys()].sort();

  const addMemo = (newMemoTitle) => {
    if (newMemoTitle) {
      let newMemo = { id: uuidV4(), title: newMemoTitle, content: "", tags: [] };
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
    const editContext = getEditContext();
    const updatedMemo = [...node.data["memo"]];
    updatedMemo[selectedMemoIndex] = {
      ...updatedMemo[selectedMemoIndex],
      content: editedContent,
    };
    node.data["memo"] = updatedMemo;
    changeData(node, "memo", updatedMemo, editContext);
    return true;
  };
  const renameMemo = (newMemoTitle, selectedMemoIndex) => {
    if (newMemoTitle) {
      const editContext = getEditContext();
      memo = [...node.data["memo"]];
      memo[selectedMemoIndex].title = newMemoTitle;
      changeDataDebounce(node, "memo", memo, editContext);
      return true;
    }
  };
  const reorderMemo = (fromIndex, toIndex) => {
    const updatedMemo = [...node.data["memo"]];
    const [moved] = updatedMemo.splice(fromIndex, 1);
    updatedMemo.splice(toIndex, 0, moved);
    changeData(node, "memo", updatedMemo);
  };
  const saveMemoTags = (selectedMemoIndex, tags) => {
    const editContext = getEditContext();
    const updatedMemo = [...node.data["memo"]];
    updatedMemo[selectedMemoIndex] = { ...updatedMemo[selectedMemoIndex], tags };
    node.data["memo"] = updatedMemo;
    changeData(node, "memo", updatedMemo, editContext);
  };
</script>

<div class="container">
  <div class="memotab-container">
    {#if is_selected}
      <MemoTab
        {memo}
        {saveMemo}
        {addMemo}
        {deleteMemo}
        {renameMemo}
        {reorderMemo}
        {saveMemoTags}
        {allTags}
        {isWorkspaceProject}
        {workspaceProjectDir}
        taskId={$table_selected_id ?? null}
      />
    {:else}
      <h1 style="color:var(--theme-color-Sub-main); display:flex; justify-content:center">
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
