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
    theme,
  } from "../stores.ts";
  import { debounce } from "lodash";
  import { onDestroy } from "svelte";
  import MemoTab from "./MemoTab.svelte";
  import SplitPanes from "./SplitPanes.svelte";
  import Pane from "./Pane.svelte";
  import Card from "./Card.svelte";
  import StatusSelect from "./StatusSelect.svelte";
  import DateInput from "./DateInput.svelte";

  $: is_selected = $table_selected_id ? true : false;
  $: node =
    $table_selected_id && $tree_data ? getNode($table_selected_id, $tree_data.data) : undefined;
  $: name = node ? node.data["name"] : "Select Task";
  $: memo = node ? node.data["memo"] : [];
  $: isWorkspaceProject = $selected_type === "WorkspaceProject";
  $: workspaceProjectDir = isWorkspaceProject ? $workspace_store.activeProjectDir : null;
  $: memoType = isWorkspaceProject ? "Markdown" : "Quill";
  $: isDark = $theme === "dark";

  const detailDateStyle =
    "border: 0; padding: 0 2rem 0 0.45rem; font-size: 1rem; background-color: transparent;";

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

  const changeTaskField = (key, value, debounceChange = false) => {
    if (!node) {
      return;
    }

    const editContext = getEditContext();
    node.data[key] = value;
    if (debounceChange) {
      changeDataDebounce(node, key, value, editContext);
    } else {
      changeData(node, key, value, editContext);
    }
  };

  const handleNameInput = (event) => {
    changeTaskField("name", event.target.value, true);
  };

  const flushNameChange = () => {
    changeDataDebounce.flush?.();
  };
</script>

<div class="container">
  {#if is_selected && node}
    <SplitPanes direction="vertical" defaultRatio={[1, 4]}>
      <Pane
        style={"width: 100%; min-height: 9rem; overflow: hidden; align-items: stretch; justify-content: stretch;"}
      >
        <Card style={"height: 100%; width: 100%; padding: 0.75rem; gap: 0.5rem; overflow: hidden;"}>
          <div class="PaneTitle">Task Detail</div>
          <div class="detail-container">
            <label class="detail-field">
              <span>Name</span>
              <div class="detail-control">
                <input
                  class="detail-input"
                  type="text"
                  value={name}
                  aria-label="Task name"
                  on:input={handleNameInput}
                  on:blur={flushNameChange}
                />
              </div>
            </label>

            <label class="detail-field">
              <span>Status</span>
              <div class="detail-control">
                <StatusSelect
                  status={node.data.status ?? "Open"}
                  style="height: 100%; font-size: 1rem;"
                  on:change={(event) => changeTaskField("status", event.target.value)}
                />
              </div>
            </label>

            <label class="detail-field">
              <span>Start Date</span>
              <div class="detail-control">
                <DateInput
                  is_dark={isDark}
                  id="detail-start-date"
                  backgroundColor={"var(--theme-color-Main-light)"}
                  style={detailDateStyle}
                  value={node.data["start date"] ?? ""}
                  on:change={(event) =>
                    changeTaskField("start date", event.target.value || undefined)}
                />
              </div>
            </label>

            <label class="detail-field">
              <span>Due Date</span>
              <div class="detail-control">
                <DateInput
                  is_dark={isDark}
                  id="detail-due-date"
                  backgroundColor={"var(--theme-color-Main-light)"}
                  style={detailDateStyle}
                  value={node.data["due date"] ?? ""}
                  on:change={(event) =>
                    changeTaskField("due date", event.target.value || undefined)}
                />
              </div>
            </label>

            <label class="detail-field">
              <span>memo数</span>
              <div class="detail-control">
                <input
                  class="detail-input"
                  type="number"
                  value={memo.length}
                  aria-label="Memo count"
                  readonly
                />
              </div>
            </label>

            <label class="detail-field">
              <span>memo type</span>
              <div class="detail-control">
                <input
                  class="detail-input"
                  type="text"
                  value={memoType}
                  aria-label="Memo type"
                  readonly
                />
              </div>
            </label>
          </div>
        </Card>
      </Pane>

      <Pane
        style={"width: 100%; min-height: 18rem; overflow: hidden; align-items: stretch; justify-content: stretch;"}
      >
        <Card style={"height: 100%; width: 100%; padding: 1rem; gap: 0.75rem; overflow: hidden;"}>
          <div class="PaneTitle">Memo</div>
          <div class="memotab-container">
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
          </div>
        </Card>
      </Pane>
    </SplitPanes>
  {:else}
    <h1 style="color:var(--theme-color-Sub-main); display:flex; justify-content:center">
      No data.
    </h1>
  {/if}
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
  .detail-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    align-content: start;
    gap: 0.4rem 0.6rem;
    flex: 1;
    width: 100%;
    min-height: 0;
    box-sizing: border-box;
    padding: 0;
    overflow: auto;
  }
  .PaneTitle {
    display: flex;
    align-items: center;
    min-height: 2rem;
    padding: 0 0.75rem;
    border-left: 0.25rem solid var(--theme-color-Accent-main);
    border-radius: 6px;
    color: var(--theme-color-Sub-light);
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 12%, transparent);
    font-size: 1.15rem;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0;
    flex: 0 0 auto;
  }
  .detail-field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    color: var(--theme-color-Sub-main);
    font-size: 1rem;
    font-weight: 700;
  }
  .detail-field > span {
    flex: 0 0 5.3rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1;
  }
  .detail-input {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 0;
    padding: 0 0.45rem;
    color: var(--theme-color-Sub-light);
    background-color: transparent;
    font-size: 1rem;
  }
  .detail-input[readonly] {
    color: var(--theme-color-Sub-main);
  }
  .detail-input:focus {
    outline: auto;
  }
  .detail-control {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 2rem;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 35%, transparent);
    border-radius: 5px;
    background-color: var(--theme-color-Main-light);
    overflow: hidden;
    --backgroundColor: var(--theme-color-Main-light);
  }
  .detail-control :global(.StatusContainer) {
    gap: 0.35rem;
    padding: 0 0.35rem;
    box-sizing: border-box;
  }
  .detail-control :global(.StatusContainer svg) {
    flex: 0 0 1.1rem;
    width: 1.1rem;
  }
  .detail-control :global(.select select) {
    font-size: 1rem;
  }
  .detail-control :global(.Date) {
    font-size: 1rem;
  }
  .memotab-container {
    flex: 1;
    width: 100%;
    min-height: 0;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  @media (max-width: 760px) {
    .detail-container {
      grid-template-columns: 1fr;
    }
  }
</style>
