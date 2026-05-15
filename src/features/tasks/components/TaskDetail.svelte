<script>
  import { getNode, updateNodeDataById } from "@features/tasks/utils/tree_control";
  import { uuidV4 } from "@lib/utils/uuid";
  import {
    tree_data,
    table_selected_id,
    cancelPendingOperations,
    selected_type,
    selected_id,
    workspace_store,
    tag_index,
    theme,
  } from "@stores";
  import { debounce } from "lodash";
  import { onDestroy } from "svelte";
  import MemoTab from "@features/memos/components/MemoTab.svelte";
  import SplitPanes from "@lib/layouts/SplitPanes.svelte";
  import Pane from "@lib/layouts/Pane.svelte";
  import Card from "@lib/primitives/Card.svelte";
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
  import DateInput from "@lib/primitives/DateInput.svelte";

  /**
   * When TaskDetail is rendered inside its own dedicated window (TaskDetailPage),
   * the "Task Detail" Card title is redundant — the OS-level title bar already
   * says the same thing. Callers pass `hideDetailTitle` to suppress both the
   * detail card title and the memo card title in that context.
   */
  export let hideDetailTitle = false;

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
    "border: 0; padding: 0 var(--sp7) 0 var(--sp2); font-size: 1rem; background-color: transparent;";

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
    <SplitPanes direction="vertical" defaultRatio={[2, 3]}>
      <Pane
        style={"width: 100%; min-height: 15rem; overflow: hidden; align-items: stretch; justify-content: stretch;"}
      >
        <Card
          title={hideDetailTitle ? "" : "Task Detail"}
          padded={false}
          style={"height: 100%; width: 100%; overflow: hidden;"}
        >
          <div class="detail-container">
            <label class="detail-field">
              <span class="detail-label">Name</span>
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
              <span class="detail-label">Status</span>
              <div class="detail-control">
                <StatusSelect
                  status={node.data.status ?? "Open"}
                  style="height: 100%; font-size: var(--font-body-md);"
                  on:change={(event) => changeTaskField("status", event.detail.value)}
                />
              </div>
            </label>

            <label class="detail-field">
              <span class="detail-label">Start Date</span>
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
              <span class="detail-label">Due Date</span>
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

            <div class="detail-field">
              <span class="detail-label" id="lbl-memo-count">Memo 数</span>
              <output
                class="detail-readonly"
                aria-labelledby="lbl-memo-count"
                aria-label="Memo count">{memo.length}</output
              >
            </div>

            <div class="detail-field">
              <span class="detail-label" id="lbl-memo-type">Memo Type</span>
              <output class="detail-badge" aria-labelledby="lbl-memo-type" aria-label="Memo type"
                >{memoType}</output
              >
            </div>
          </div>
        </Card>
      </Pane>

      <Pane
        style={"width: 100%; min-height: 18rem; overflow: hidden; align-items: stretch; justify-content: stretch;"}
      >
        <Card
          title={hideDetailTitle ? "" : "Memo"}
          padded={false}
          style={"height: 100%; width: 100%; overflow: hidden;"}
        >
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
    grid-template-columns: 1fr 1fr;
    align-content: start;
    gap: var(--sp2) var(--sp4);
    flex: 1;
    width: 100%;
    min-height: 0;
    box-sizing: border-box;
    padding: var(--sp3);
    overflow: auto;
    container-type: inline-size;
  }
  .detail-field {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.2rem;
    min-width: 0;
    color: var(--theme-color-Sub-main);
  }
  .detail-label {
    flex: 0 0 auto;
    min-width: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    letter-spacing: 0.01em;
    line-height: 1.3;
    user-select: none;
  }
  .detail-input {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 0;
    padding: 0 var(--sp2);
    color: var(--theme-color-Sub-main);
    background-color: transparent;
    font-size: var(--font-body-md);
  }
  .detail-input:focus {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  .detail-control {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 2rem;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-sm);
    background-color: var(--theme-color-Main-light);
    overflow: hidden;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
    --backgroundColor: var(--theme-color-Main-light);
  }
  .detail-control:focus-within {
    border-color: var(--theme-color-Primary-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
  }
  .detail-readonly {
    padding: var(--sp1) var(--sp2);
    font-size: var(--font-body-md);
    font-weight: 600;
    color: var(--theme-color-Sub-main);
  }
  .detail-badge {
    align-self: flex-start;
    padding: var(--sp1) var(--sp2);
    border-radius: var(--shape-xs);
    background-color: color-mix(in srgb, var(--theme-color-Info-main) 18%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
  }
  .detail-control :global(.StatusContainer) {
    gap: var(--sp1);
    padding: 0 var(--sp1);
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
    padding: var(--sp3);
    overflow: hidden;
  }
  @container (max-width: 28rem) {
    .detail-container {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 760px) {
    .detail-container {
      grid-template-columns: 1fr;
    }
  }
</style>
