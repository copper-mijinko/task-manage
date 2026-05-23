<script>
  import { uuidV4 } from "@lib/utils/uuid";
  import Card from "@lib/primitives/Card.svelte";
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
  import DateInput from "@lib/primitives/DateInput.svelte";
  import MemoTab from "@features/memos/components/MemoTab.svelte";
  import {
    convertMemoContent,
    isQuillDelta,
    normalizeMemoFormat,
  } from "@features/memos/utils/memo_utils";
  import { inbox_store } from "@features/inbox/stores/inbox";
  import { tag_index, theme } from "@stores";

  /** @type {import("@app-types/workspace").WorkspaceTask | null} */
  export let item = null;

  const DETAIL_DATE_STYLE =
    "border: 0; padding: 0 var(--sp7) 0 var(--sp2); font-size: 1rem; background-color: transparent;";
  // Inbox is workspace-backed, so memos default to markdown.
  const DEFAULT_MEMO_FORMAT = "markdown";

  $: isDark = $theme === "dark";
  $: memos = item?.memos ?? [];
  $: allTags = [...$tag_index.keys()].sort();
  $: workspaceProjectDir = $inbox_store.projectDir ?? null;
  // Keep MemoTab focused on the current item when switching rows.
  $: detailKey = item?.id ?? "";

  function updateField(key, value) {
    if (!item) return;
    inbox_store.updateItem(item.id, { [key]: value });
  }

  function handleNameInput(e) {
    updateField("name", e.currentTarget.value);
  }

  function handleStatusChange(e) {
    const value = e.detail?.value ?? e.target?.value;
    if (!value) return;
    updateField("status", value);
  }

  function handleStartChange(e) {
    updateField("startDate", e.currentTarget?.value || undefined);
  }

  function handleDueChange(e) {
    updateField("dueDate", e.currentTarget?.value || undefined);
  }

  // ── Memo handlers (mirror TaskDetail's patterns but bound to inbox_store) ──

  function updateMemos(nextMemos) {
    if (!item) return;
    inbox_store.updateItem(item.id, { memos: nextMemos });
  }

  function modifyMemoAtIndex(index, updater) {
    if (!item) return false;
    const list = item.memos ?? [];
    const current = list[index];
    if (!current) return false;
    const next = updater(current);
    if (!next) return false;
    const out = list.slice();
    out[index] = next;
    updateMemos(out);
    return true;
  }

  function addMemo(title) {
    if (!item || !title) return false;
    const newMemo = {
      id: uuidV4(),
      title,
      content: "",
      tags: [],
      format: DEFAULT_MEMO_FORMAT,
    };
    updateMemos([...(item.memos ?? []), newMemo]);
    return true;
  }

  function deleteMemo(index) {
    if (!item) return false;
    const next = (item.memos ?? []).filter((_, i) => i !== index);
    updateMemos(next);
    return true;
  }

  function saveMemo(editedContent, index) {
    return modifyMemoAtIndex(index, (current) => {
      const targetFormat = normalizeMemoFormat(current.format, DEFAULT_MEMO_FORMAT);
      const sourceFormat = isQuillDelta(editedContent) ? "quill" : "markdown";
      return {
        ...current,
        content: convertMemoContent(editedContent, sourceFormat, targetFormat),
      };
    });
  }

  function renameMemo(newTitle, index) {
    if (!newTitle) return false;
    return modifyMemoAtIndex(index, (current) => ({ ...current, title: newTitle }));
  }

  function reorderMemo(fromIndex, toIndex) {
    if (!item) return;
    const list = (item.memos ?? []).slice();
    if (fromIndex < 0 || fromIndex >= list.length) return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    updateMemos(list);
  }

  function saveMemoTags(index, tags) {
    return modifyMemoAtIndex(index, (current) => ({ ...current, tags }));
  }

  function changeMemoFormat(index, nextFormat) {
    return modifyMemoAtIndex(index, (current) => {
      const currentFormat = normalizeMemoFormat(current.format, DEFAULT_MEMO_FORMAT);
      if (currentFormat === nextFormat) return current;
      return {
        ...current,
        format: nextFormat,
        content: convertMemoContent(current.content, currentFormat, nextFormat),
      };
    });
  }
</script>

{#if item}
  <Card
    title={item.name || "Untitled"}
    padded={false}
    style="height: 100%; width: 100%; overflow: hidden;"
  >
    <div class="detail-body">
      <div class="detail-pane">
        <div class="detail-container">
          <label class="detail-field">
            <span class="detail-label">Name</span>
            <div class="detail-control">
              <input
                class="detail-input"
                type="text"
                value={item.name}
                aria-label="Task name"
                on:input={handleNameInput}
              />
            </div>
          </label>

          <label class="detail-field">
            <span class="detail-label">Status</span>
            <div class="detail-control">
              <StatusSelect
                status={item.status ?? "Open"}
                style="height: 100%; font-size: var(--font-body-md);"
                on:change={handleStatusChange}
              />
            </div>
          </label>

          <label class="detail-field">
            <span class="detail-label">Start Date</span>
            <div class="detail-control">
              <DateInput
                is_dark={isDark}
                backgroundColor={"var(--theme-color-Main-light)"}
                style={DETAIL_DATE_STYLE}
                value={item.startDate ?? ""}
                on:change={handleStartChange}
              />
            </div>
          </label>

          <label class="detail-field">
            <span class="detail-label">Due Date</span>
            <div class="detail-control">
              <DateInput
                is_dark={isDark}
                backgroundColor={"var(--theme-color-Main-light)"}
                style={DETAIL_DATE_STYLE}
                value={item.dueDate ?? ""}
                on:change={handleDueChange}
              />
            </div>
          </label>

          <div class="detail-field">
            <span class="detail-label" id="lbl-memo-count">Memo 数</span>
            <output class="detail-readonly" aria-labelledby="lbl-memo-count">{memos.length}</output>
          </div>
        </div>
      </div>

      <div class="memo-pane">
        <div class="memotab-container">
          {#key detailKey}
            <MemoTab
              memo={memos}
              {saveMemo}
              {addMemo}
              {deleteMemo}
              {renameMemo}
              {reorderMemo}
              {saveMemoTags}
              {changeMemoFormat}
              {allTags}
              isWorkspaceProject={true}
              defaultMemoFormat={DEFAULT_MEMO_FORMAT}
              {workspaceProjectDir}
              taskId={item.id}
            />
          {/key}
        </div>
      </div>
    </div>
  </Card>
{:else}
  <div class="empty-state">
    <p>
      左のリストから項目を選択するか、ツールバーの「追加」ボタン（または <kbd>Ctrl</kbd>+<kbd
        >Shift</kbd
      >+<kbd>I</kbd>）から追加してください。
    </p>
  </div>
{/if}

<style>
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    text-align: center;
    padding: var(--sp4);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
    font-size: var(--font-body-md);
  }
  .empty-state kbd {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 25%, transparent);
    border-radius: var(--shape-xs);
    padding: 0 0.3rem;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 0.85rem;
  }

  .detail-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .detail-pane {
    flex: 0 0 auto;
    min-height: 0;
    box-sizing: border-box;
    overflow: hidden;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 14%, transparent);
  }

  .memo-pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    box-sizing: border-box;
    overflow: hidden;
  }

  .detail-container {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--sp2) var(--sp3);
    padding: var(--sp3) var(--sp4);
    align-items: center;
  }

  .detail-field {
    display: contents;
  }

  .detail-label {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    font-size: var(--font-label-md);
    font-weight: 600;
    white-space: nowrap;
  }

  .detail-control {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .detail-input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-md);
    padding: 0.3rem var(--sp2);
    outline: none;
  }

  .detail-input:focus {
    border-color: var(--theme-color-Primary-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 25%, transparent);
  }

  .detail-readonly {
    color: var(--theme-color-Sub-main);
    font-variant-numeric: tabular-nums;
  }

  .memotab-container {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
</style>
