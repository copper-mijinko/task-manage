<script>
  import { onMount } from "svelte";
  import Card from "@lib/primitives/Card.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import DateInput from "@lib/primitives/DateInput.svelte";
  import Pane from "@lib/layouts/Pane.svelte";
  import SplitPanes from "@lib/layouts/SplitPanes.svelte";
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
  import { tooltip } from "@lib/actions";
  import { inbox_store } from "@features/inbox/stores/inbox";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { theme } from "@stores/theme";
  import { showQuickCapture } from "@stores/ui";
  import ProjectTargetPicker from "./ProjectTargetPicker.svelte";
  import InboxDetailPanel from "./InboxDetailPanel.svelte";

  // Open the QuickCapture modal automatically whenever the user lands on
  // Inbox. App.svelte mounts InboxPanel each time selected_type flips to
  // "Inbox", so onMount fires on every navigation into Inbox — exactly the
  // "open Inbox = start capturing" cadence the user wants.
  onMount(() => {
    if ($workspace_store.activeWorkspacePath) {
      $showQuickCapture = true;
    }
  });

  const INBOX_DRAG_MIME = "application/x-task-manage-inbox-items";

  let filterQuery = "";
  let selectedIds = new Set();
  let activeItemId = null;
  let lastAnchorId = null;
  let showSendPicker = false;
  let sendError = "";

  $: items = $inbox_store.items;
  $: normalizedFilter = filterQuery.trim().toLowerCase();
  $: visibleItems = normalizedFilter
    ? items.filter((item) => (item.name || "").toLowerCase().includes(normalizedFilter))
    : items;
  $: selectionCount = selectedIds.size;
  $: workspaceReady = Boolean($workspace_store.activeWorkspacePath);
  $: isDark = $theme === "dark";
  $: activeItem = activeItemId ? (items.find((item) => item.id === activeItemId) ?? null) : null;

  // When items disappear (sendToProject, external watcher events), purge stale
  // selection ids and clear the active item if it no longer exists.
  $: {
    const visibleIdSet = new Set(items.map((item) => item.id));
    let changed = false;
    const next = new Set();
    for (const id of selectedIds) {
      if (visibleIdSet.has(id)) {
        next.add(id);
      } else {
        changed = true;
      }
    }
    if (changed) {
      selectedIds = next;
      if (lastAnchorId && !next.has(lastAnchorId)) {
        lastAnchorId = next.size > 0 ? [...next][0] : null;
      }
    }
    if (activeItemId && !visibleIdSet.has(activeItemId)) {
      activeItemId = null;
    }
  }

  function setActive(id) {
    activeItemId = id;
  }

  function selectOnly(id) {
    selectedIds = new Set([id]);
    lastAnchorId = id;
    setActive(id);
  }
  function toggleSelect(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
      if (lastAnchorId === id) {
        const first = next.values().next();
        lastAnchorId = first.done ? null : first.value;
      }
    } else {
      next.add(id);
      lastAnchorId = id;
    }
    selectedIds = next;
    // After a toggle, focus follows the most recent click — but only if
    // the row is part of the new selection. Otherwise, fall back to any
    // remaining row, or null when the selection is empty.
    if (next.has(id)) {
      setActive(id);
    } else if (lastAnchorId) {
      setActive(lastAnchorId);
    } else {
      setActive(null);
    }
  }
  function selectRange(targetId) {
    if (!lastAnchorId) {
      selectOnly(targetId);
      return;
    }
    const ids = visibleItems.map((item) => item.id);
    const a = ids.indexOf(lastAnchorId);
    const b = ids.indexOf(targetId);
    if (a === -1 || b === -1) {
      selectOnly(targetId);
      return;
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    selectedIds = new Set(ids.slice(lo, hi + 1));
    setActive(targetId);
  }

  function handleRowClick(e, id) {
    if (e.shiftKey) {
      selectRange(id);
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelect(id);
    } else {
      selectOnly(id);
    }
  }

  function selectAllVisible() {
    selectedIds = new Set(visibleItems.map((item) => item.id));
    lastAnchorId = visibleItems[0]?.id ?? null;
    setActive(lastAnchorId);
  }
  function clearSelection() {
    selectedIds = new Set();
    lastAnchorId = null;
    setActive(null);
  }

  async function handleDeleteSelected() {
    if (selectionCount === 0) return;
    const ids = [...selectedIds];
    await inbox_store.deleteItems(ids);
    clearSelection();
  }

  function handleNameInput(id, e) {
    const name = e.currentTarget.value;
    inbox_store.updateItem(id, { name });
  }
  function handleStatusChange(id, e) {
    const status = e.detail?.value ?? e.target?.value;
    if (!status) return;
    inbox_store.updateItem(id, { status });
  }
  function handleDueChange(id, e) {
    const value = e.currentTarget?.value || undefined;
    inbox_store.updateItem(id, { dueDate: value });
  }

  // Row-level drag state. The payload (INBOX_DRAG_MIME) is consumed by the
  // other Inbox rows in this panel for in-list reorder. The sidebar does
  // not accept Inbox drops — it's used as a Drawer (folded by default) and
  // shouldn't be a permanent drop target. Cross-project sending happens
  // through the ProjectTargetPicker modal instead.
  let dragOverItemId = null;
  /** "before" | "after" — where to insert relative to dragOverItemId. */
  let dragOverPosition = null;
  /** Snapshot of which ids are being dragged in the current operation. */
  let dragSourceIds = [];

  function handleRowDragStart(e, id) {
    if (!e.dataTransfer) return;
    const payload = selectedIds.has(id) ? [...selectedIds] : [id];
    dragSourceIds = payload;
    e.dataTransfer.setData(INBOX_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.classList.add("Dragging");
  }
  function handleRowDragEnd(e) {
    e.currentTarget.classList.remove("Dragging");
    dragOverItemId = null;
    dragOverPosition = null;
    dragSourceIds = [];
  }

  function handleRowDragOver(e, id) {
    if (!e.dataTransfer) return;
    const hasInboxPayload = Array.from(e.dataTransfer.types || []).includes(INBOX_DRAG_MIME);
    if (!hasInboxPayload) return;
    // Don't draw the reorder indicator on rows that are themselves being
    // dragged — they're the source, not a valid drop target.
    if (dragSourceIds.includes(id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? "before" : "after";
    if (dragOverItemId !== id || dragOverPosition !== position) {
      dragOverItemId = id;
      dragOverPosition = position;
    }
  }

  function handleRowDragLeave(e, id) {
    // dragleave fires when entering child elements too. Only clear if the
    // pointer left the row entirely (relatedTarget is outside this row).
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    if (dragOverItemId === id) {
      dragOverItemId = null;
      dragOverPosition = null;
    }
  }

  function handleRowDrop(e, targetId) {
    if (!e.dataTransfer) return;
    const raw = e.dataTransfer.getData(INBOX_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();

    let draggedIds = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        draggedIds = parsed.filter((id) => typeof id === "string");
      }
    } catch {
      // ignore malformed payload
    }
    const position = dragOverPosition;
    dragOverItemId = null;
    dragOverPosition = null;
    if (draggedIds.length === 0 || draggedIds.includes(targetId)) return;

    // Compute the post-move id order. Pull dragged ids out first, then
    // re-insert them as a contiguous block at the drop site so multi-select
    // groups don't get split.
    const allIds = items.map((item) => item.id);
    const draggedSet = new Set(draggedIds);
    const remaining = allIds.filter((id) => !draggedSet.has(id));
    const targetIdx = remaining.indexOf(targetId);
    if (targetIdx === -1) return;
    const insertAt = position === "after" ? targetIdx + 1 : targetIdx;
    remaining.splice(insertAt, 0, ...draggedIds);
    inbox_store.reorder(remaining);
  }

  function openSendPicker(e) {
    e?.stopPropagation?.();
    if (selectionCount === 0) return;
    sendError = "";
    showSendPicker = true;
  }
  function closeSendPicker() {
    showSendPicker = false;
  }

  async function handlePickerConfirm(event) {
    const { targetProjectDir, targetRootId, targetParentId } = event.detail;
    if (selectionCount === 0) return;
    const ids = [...selectedIds];
    const result = await inbox_store.sendToProject({
      targetProjectDir,
      targetRootId,
      targetParentId,
      taskIds: ids,
    });
    if (result.success) {
      showSendPicker = false;
      clearSelection();
    } else {
      sendError = result.error || "送信に失敗しました";
    }
  }
</script>

<div class="InboxRoot">
  {#if !workspaceReady}
    <Card title="Inbox" padded={false} style="height: 100%; width: 100%;">
      <span slot="header-actions" class="storage-badge">Workspace</span>
      <div class="EmptyState">
        <p>Workspaceを設定するとInboxが使えます。</p>
        <p class="EmptySub">サイドバーのワークスペース管理から追加してください。</p>
      </div>
    </Card>
  {:else}
    <SplitPanes defaultRatio={[3, 2]}>
      <Pane style="min-width: 14rem;">
        <Card title="Inbox" padded={false} style="height: 100%; width: 100%;">
          <span slot="header-actions" class="storage-badge">Workspace</span>

          <div class="Toolbar">
            <div class="ToolbarGroup">
              <button
                type="button"
                class="AddBtn"
                on:click={() => ($showQuickCapture = true)}
                use:tooltip={{
                  color: "var(--on-theme-tooltip-fg)",
                  backgroundColor: "var(--on-theme-tooltip-bg)",
                  content: "クイック追加 (Ctrl+Shift+I)",
                  force: true,
                }}
                aria-label="Inboxに追加"
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 5V19M5 12H19"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                追加
              </button>
            </div>

            <span class="ToolbarSep" aria-hidden="true"></span>

            <div class="ToolbarGroup">
              <IconButton
                tooltipContent={selectionCount > 0
                  ? `${selectionCount}件を削除`
                  : "削除する項目を選択してください"}
                ariaLabel="削除"
                variant="text"
                normalColor="var(--theme-color-Error-main)"
                activeColor="var(--theme-color-Error-main)"
                disabled={selectionCount === 0}
                on:click={handleDeleteSelected}
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

            <span class="ToolbarSep" aria-hidden="true"></span>

            <div class="ToolbarGroup">
              <button
                type="button"
                class="SendBtn"
                class:Disabled={selectionCount === 0}
                disabled={selectionCount === 0}
                on:click={openSendPicker}
                use:tooltip={{
                  color: "var(--on-theme-tooltip-fg)",
                  backgroundColor: "var(--on-theme-tooltip-bg)",
                  content:
                    selectionCount === 0
                      ? "プロジェクトへ送る項目を選択してください"
                      : `${selectionCount}件をプロジェクトへ送る（送信先のツリー位置を指定）`,
                  force: true,
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M5 12H19M13 6L19 12L13 18"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                プロジェクトへ送る...
              </button>
            </div>

            <span class="ToolbarSep" aria-hidden="true"></span>

            <div class="ToolbarGroup">
              <button
                type="button"
                class="LinkBtn"
                on:click={selectAllVisible}
                disabled={visibleItems.length === 0}
              >
                全選択
              </button>
              <button
                type="button"
                class="LinkBtn"
                on:click={clearSelection}
                disabled={selectionCount === 0}
              >
                解除
              </button>
            </div>

            <div class="FilterBox">
              <svg viewBox="0 0 24 24" class="FilterIcon" aria-hidden="true">
                <path d="M21 21L16.7 16.7M18 11A7 7 0 1 1 4 11A7 7 0 0 1 18 11Z" />
              </svg>
              <input
                bind:value={filterQuery}
                type="text"
                placeholder="絞り込み"
                aria-label="Inboxを絞り込み"
              />
            </div>

            <div class="ToolbarMeta">
              {selectionCount} / {items.length}
            </div>
          </div>

          <div class="ListContainer">
            {#if items.length === 0}
              <div class="EmptyList">
                <p>Inboxは空です。</p>
                <p class="EmptySub">
                  ツールバーの「追加」ボタン、または <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> から思いついたタスクを素早く追加できます。
                </p>
              </div>
            {:else if visibleItems.length === 0}
              <div class="EmptyList">
                <p>条件に一致する項目がありません。</p>
              </div>
            {:else}
              <ul class="ItemList" role="listbox" aria-multiselectable="true">
                {#each visibleItems as item (item.id)}
                  <li
                    class="ItemRow"
                    class:Selected={selectedIds.has(item.id)}
                    class:Active={activeItemId === item.id}
                    class:DragOverBefore={dragOverItemId === item.id &&
                      dragOverPosition === "before"}
                    class:DragOverAfter={dragOverItemId === item.id && dragOverPosition === "after"}
                    draggable="true"
                    on:dragstart={(e) => handleRowDragStart(e, item.id)}
                    on:dragend={handleRowDragEnd}
                    on:dragover={(e) => handleRowDragOver(e, item.id)}
                    on:dragleave={(e) => handleRowDragLeave(e, item.id)}
                    on:drop={(e) => handleRowDrop(e, item.id)}
                    on:click={(e) => handleRowClick(e, item.id)}
                    role="option"
                    aria-selected={selectedIds.has(item.id)}
                    tabindex="0"
                    on:keydown={(e) => {
                      if (e.key === " ") {
                        e.preventDefault();
                        toggleSelect(item.id);
                      }
                    }}
                  >
                    <span
                      class="DragHandle"
                      aria-hidden="true"
                      use:tooltip={{
                        content: "ドラッグして並べ替え",
                        color: "var(--theme-color-Sub-main)",
                        backgroundColor: "var(--theme-color-Main-light)",
                      }}>⋮⋮</span
                    >
                    <input
                      type="checkbox"
                      class="RowCheckbox"
                      checked={selectedIds.has(item.id)}
                      on:click|stopPropagation
                      on:change={() => toggleSelect(item.id)}
                      aria-label="この項目を選択"
                    />
                    <input
                      type="text"
                      class="NameInput"
                      value={item.name}
                      on:click|stopPropagation
                      on:input={(e) => handleNameInput(item.id, e)}
                      aria-label="項目名"
                    />
                    <div class="StatusCell">
                      <StatusSelect
                        status={item.status || "Open"}
                        on:change={(e) => handleStatusChange(item.id, e)}
                      />
                    </div>
                    <div class="DueCell">
                      <DateInput
                        value={item.dueDate || ""}
                        is_dark={isDark}
                        on:change={(e) => handleDueChange(item.id, e)}
                      />
                    </div>
                    {#if (item.memos?.length ?? 0) > 0}
                      <span
                        class="MemoBadge"
                        use:tooltip={{
                          content: `メモ ${item.memos.length}件`,
                          color: "var(--theme-color-Sub-main)",
                          backgroundColor: "var(--theme-color-Main-light)",
                        }}
                      >
                        📝 {item.memos.length}
                      </span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </Card>
      </Pane>

      <Pane style="min-width: 14rem;">
        <InboxDetailPanel item={activeItem} />
      </Pane>
    </SplitPanes>
  {/if}
</div>

{#if showSendPicker}
  <ProjectTargetPicker
    itemCount={selectionCount}
    on:confirm={handlePickerConfirm}
    on:close={closeSendPicker}
  />
{/if}

{#if sendError}
  <div class="send-error-toast" role="alert">
    <span>{sendError}</span>
    <button type="button" on:click={() => (sendError = "")} aria-label="閉じる">✕</button>
  </div>
{/if}

<style>
  .InboxRoot {
    display: flex;
    flex: 1;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    width: 100%;
    background-color: var(--theme-color-Main-dark);
  }
  .storage-badge {
    flex: 0 0 auto;
    padding: 0.15rem var(--sp2);
    border-radius: var(--shape-xs);
    background-color: color-mix(in srgb, var(--theme-color-Info-main) 18%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 600;
    white-space: nowrap;
  }
  .Toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    margin: 0 var(--sp3);
    padding: var(--sp2) 0;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .ToolbarGroup {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
  }
  .ToolbarSep {
    display: inline-block;
    width: 1px;
    height: 1.5rem;
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
  }
  /* Theme color (deep navy) + white text mirrors the app header chrome,
     which guarantees enough contrast in both light and dark themes —
     Primary-main is light blue in dark mode and white-on-light-blue was
     hard to read. */
  .AddBtn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    padding: 0.3rem var(--sp3);
    border: 1px solid var(--theme-color-Theme-main);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Theme-main);
    color: #ffffff;
    font-weight: 600;
    font-size: var(--font-label-md);
    cursor: pointer;
  }
  .AddBtn:hover {
    background-color: var(--theme-color-Theme-light);
    border-color: var(--theme-color-Theme-light);
  }
  .AddBtn:focus-visible {
    outline: 2px solid var(--theme-color-Theme-light);
    outline-offset: 2px;
  }
  .AddBtn svg {
    width: 1rem;
    height: 1rem;
  }
  .SendBtn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    padding: 0.3rem var(--sp3);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 40%, transparent);
    border-radius: var(--shape-xs);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 8%, transparent);
    color: var(--theme-color-Primary-main);
    font-weight: 600;
    font-size: var(--font-label-md);
    cursor: pointer;
  }
  .SendBtn:disabled,
  .SendBtn.Disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .SendBtn svg {
    width: 1rem;
    height: 1rem;
  }
  .send-error-toast {
    position: fixed;
    bottom: var(--sp4);
    right: var(--sp4);
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2) var(--sp3);
    background-color: var(--theme-color-Main-light);
    border: 1px solid var(--theme-color-Error-main);
    border-radius: var(--shape-sm);
    color: var(--theme-color-Error-main);
    font-size: var(--font-body-sm);
    box-shadow: var(--elevation-3);
    z-index: 100000;
  }
  .send-error-toast button {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    line-height: 1;
    padding: 0 var(--sp1);
  }
  .LinkBtn {
    border: none;
    background: transparent;
    color: var(--theme-color-Primary-main);
    font-size: var(--font-label-md);
    cursor: pointer;
    padding: 0.2rem var(--sp1);
  }
  .LinkBtn:disabled {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 45%, transparent);
    cursor: not-allowed;
  }
  .FilterBox {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    flex: 1 1 12rem;
    max-width: 24rem;
    min-width: 8rem;
    margin-left: auto;
    padding: 0.2rem var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
  }
  .FilterIcon {
    width: 0.9rem;
    height: 0.9rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 55%, transparent);
  }
  .FilterBox input {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
  }
  .ToolbarMeta {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
    font-size: var(--font-label-md);
    font-variant-numeric: tabular-nums;
  }
  .ListContainer {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--sp2) var(--sp3) var(--sp3);
  }
  .EmptyState,
  .EmptyList {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--sp4);
    color: var(--theme-color-Sub-main);
    gap: var(--sp1);
    flex: 1;
  }
  .EmptySub {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 60%, transparent);
    font-size: var(--font-body-sm);
    margin: 0;
  }
  .EmptySub kbd {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 25%, transparent);
    border-radius: var(--shape-xs);
    padding: 0 0.3rem;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 0.8rem;
  }
  .ItemList {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ItemRow {
    display: grid;
    grid-template-columns: 1.25rem 1.25rem 1fr auto auto auto;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2) var(--sp2) var(--sp2) var(--sp1);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-main);
    border: 1px solid transparent;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
  }
  .ItemRow:hover {
    background-color: color-mix(
      in srgb,
      var(--theme-color-Primary-main) 6%,
      var(--theme-color-Main-main)
    );
  }
  .ItemRow.Selected {
    background-color: color-mix(
      in srgb,
      var(--theme-color-Primary-main) 14%,
      var(--theme-color-Main-main)
    );
    border-color: color-mix(in srgb, var(--theme-color-Primary-main) 45%, transparent);
  }
  .ItemRow.Active {
    border-color: var(--theme-color-Primary-main);
    box-shadow: inset 2px 0 0 var(--theme-color-Primary-main);
  }
  .ItemRow:global(.Dragging) {
    opacity: 0.55;
  }
  /* Reorder indicators — drawn as 2px coloured bands at the top or bottom
     edge of the hovered row. Use box-shadow rather than border so we don't
     change the row's geometry mid-drag (which would jitter the layout). */
  .ItemRow.DragOverBefore {
    box-shadow: inset 0 2px 0 var(--theme-color-Primary-main);
  }
  .ItemRow.DragOverAfter {
    box-shadow: inset 0 -2px 0 var(--theme-color-Primary-main);
  }
  .ItemRow.DragOverBefore.Active,
  .ItemRow.DragOverAfter.Active {
    /* Keep the active "left ribbon" indicator when also showing a reorder
       band, by stacking both insets. */
    box-shadow:
      inset 2px 0 0 var(--theme-color-Primary-main),
      inset 0 2px 0 var(--theme-color-Primary-main);
  }
  .ItemRow.DragOverAfter.Active {
    box-shadow:
      inset 2px 0 0 var(--theme-color-Primary-main),
      inset 0 -2px 0 var(--theme-color-Primary-main);
  }
  .DragHandle {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 40%, transparent);
    font-size: 0.8rem;
    user-select: none;
    cursor: grab;
    text-align: center;
    line-height: 1;
  }
  .ItemRow:active .DragHandle {
    cursor: grabbing;
  }
  .RowCheckbox {
    accent-color: var(--theme-color-Primary-main);
    cursor: pointer;
  }
  .NameInput {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    outline: 1px solid transparent;
    background-color: transparent;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-md);
    padding: 0.2rem var(--sp1);
    border-radius: var(--shape-xs);
  }
  .NameInput:hover {
    outline-color: color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
  }
  .NameInput:focus {
    outline-color: var(--theme-color-Primary-main);
    background-color: var(--theme-color-Main-light);
  }
  .StatusCell {
    display: inline-flex;
    align-items: center;
  }
  .DueCell {
    display: inline-flex;
    align-items: center;
    min-width: 9rem;
  }
  .MemoBadge {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    font-size: var(--font-label-sm);
    font-variant-numeric: tabular-nums;
    padding: 0 var(--sp1);
    cursor: help;
  }
</style>
