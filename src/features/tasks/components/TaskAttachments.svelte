<script>
  import { getContext } from "svelte";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import TaskMenu from "./TaskMenu.svelte";

  const application = getContext(TREEGRID_APPLICATION);

  /**
   * @typedef {Object} Props
   * @property {any} [attachments]
   * @property {any} [taskId]
   * @property {boolean} [readOnly]
   */

  /** @type {Props} */
  let { attachments = [], taskId = null, readOnly = false } = $props();

  let fileInput = $state();
  let isBusy = $state(false);
  let isFileDragActive = $state(false);
  let errorMessage = $state("");
  let attachmentMenu = $state({
    show: false,
    attachment: null,
    position: { x: 0, y: 0, position: "right" },
  });

  let attachmentList = $derived(Array.isArray(attachments) ? attachments : []);
  let canUseAttachments = $derived(Boolean(taskId));
  let attachmentMenuItems = $derived([
    { title: "開く", action: "open" },
    { title: "プログラムから開く", action: "openWith" },
  ]);
  let attachTooltip = $derived(canUseAttachments ? "添付を追加" : "ノードを選ぶと添付できます");
  let isDense = $derived(attachmentList.length > 8);

  function attachmentPath(attachment) {
    return attachment?.relativePath || attachment?.path || attachment?.id || "";
  }

  function formatBytes(size) {
    if (!Number.isFinite(size) || size <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  }

  function chooseFiles() {
    if (!canUseAttachments || isBusy || readOnly) return;
    errorMessage = "";
    fileInput?.click();
  }

  function hasDraggedFiles(event) {
    const transfer = event.dataTransfer;
    if (!transfer) return false;
    if (transfer.files?.length > 0) return true;
    return Array.from(transfer.types ?? []).includes("Files");
  }

  async function saveFiles(files) {
    if (readOnly || isBusy || !canUseAttachments) return;
    const fileList = Array.from(files ?? []);
    if (fileList.length === 0) return;
    const id = taskId;
    const existing = [...attachmentList];
    isBusy = true;
    errorMessage = "";
    try {
      const added = [];
      for (const file of fileList) {
        const relativePath = await application.saveAsset(id, file);
        added.push({ id: crypto.randomUUID(), name: file.name, relativePath, size: file.size });
      }
      await application.update(id, { attachments: [...existing, ...added] });
    } catch (e) {
      errorMessage = e.message;
    } finally {
      isBusy = false;
    }
  }

  async function attachFiles(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await saveFiles(files);
  }

  function handleDragEnter(event) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    if (canUseAttachments && !isBusy) {
      isFileDragActive = true;
    }
  }

  function handleDragOver(event) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    if (canUseAttachments && !isBusy) {
      isFileDragActive = true;
    }
  }

  function handleDragLeave(event) {
    if (!hasDraggedFiles(event)) return;
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    isFileDragActive = false;
  }

  async function handleDrop(event) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    isFileDragActive = false;
    await saveFiles(event.dataTransfer?.files);
  }

  async function openAttachment(attachment, chooseProgram = false) {
    closeAttachmentMenu();
    errorMessage = "";
    try {
      await application.openAsset(taskId, attachmentPath(attachment), chooseProgram);
    } catch (e) {
      errorMessage = e.message;
    }
  }

  function openAttachmentMenu(event, attachment) {
    if (!canUseAttachments || isBusy) return;
    event.preventDefault();
    event.stopPropagation();
    const x = event.clientX;
    const y = event.clientY;
    attachmentMenu = {
      show: true,
      attachment,
      position: {
        x,
        y,
        position: x > window.innerWidth - 240 ? "left" : "right",
      },
    };
  }

  function closeAttachmentMenu() {
    attachmentMenu = {
      ...attachmentMenu,
      show: false,
    };
  }

  function handleAttachmentMenuOpen() {
    if (attachmentMenu.attachment) {
      openAttachment(attachmentMenu.attachment);
    }
  }

  function handleAttachmentMenuOpenWith() {
    if (attachmentMenu.attachment) {
      openAttachment(attachmentMenu.attachment, true);
    }
  }

  // 一覧から外すだけで、ファイルは残す（「元に戻す」で添付を戻せるように）。
  async function deleteAttachment(attachment) {
    if (readOnly || !canUseAttachments || isBusy) return;
    closeAttachmentMenu();
    if (!window.confirm(`「${attachment.name}」を添付一覧から削除しますか？`)) return;
    errorMessage = "";
    try {
      await application.update(taskId, {
        attachments: attachmentList.filter((item) => item.id !== attachment.id),
      });
    } catch (e) {
      errorMessage = e.message;
    }
  }
</script>

<div
  class="attachments-field"
  class:FileDragActive={isFileDragActive && canUseAttachments && !isBusy}
  role="group"
  aria-label="添付"
  data-testid="task-attachments"
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- 0 件のときはタブが「添付 (0)」と言っていて、入口は下の領域の
       「ファイルを選択」がある。件数とクリップ記号をここで繰り返さない。 -->
  <div class="attachments-header" class:attachments-header-hidden={attachmentList.length === 0}>
    <span class="attachment-label" id="lbl-attachment-count">添付</span>
    <output class="attachment-count" aria-labelledby="lbl-attachment-count"
      >{attachmentList.length}</output
    >
    {#if isDense}
      <span class="attachment-dense-hint">多数の添付</span>
    {/if}
    <IconButton
      tooltipContent={attachTooltip}
      ariaLabel="添付を追加"
      variant="text"
      disabled={!canUseAttachments || isBusy || readOnly}
      activeColor={"var(--theme-color-Primary-main)"}
      normalColor={"var(--theme-color-Sub-main)"}
      onclick={chooseFiles}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21.4 11.6L12.2 20.8C9.7 23.3 5.6 23.3 3.1 20.8C0.6 18.3 0.6 14.2 3.1 11.7L12.7 2.1C14.5 0.4 17.3 0.4 19.1 2.1C20.8 3.9 20.8 6.7 19.1 8.5L9.8 17.8C8.8 18.8 7.2 18.8 6.2 17.8C5.2 16.8 5.2 15.2 6.2 14.2L14.8 5.6"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </IconButton>
    <input
      bind:this={fileInput}
      data-testid="attachment-file-input"
      type="file"
      multiple
      class="attachment-input"
      onchange={attachFiles}
    />
  </div>

  {#if !canUseAttachments}<p>添付はWorkspaceで利用できます。</p>{:else if readOnly}<p>
      アーカイブ済みのため、添付の変更はできません。
    </p>{/if}
  {#if attachmentList.length > 0}
    <ul class="attachment-list" aria-label="添付ファイル">
      {#each attachmentList as attachment (attachmentPath(attachment))}
        <li class="attachment-item">
          <button
            type="button"
            class="attachment-open"
            title={attachment.name}
            disabled={!canUseAttachments || isBusy}
            onclick={() => openAttachment(attachment)}
            oncontextmenu={(event) => openAttachmentMenu(event, attachment)}
          >
            <span class="file-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M14 2H6C5.4 2 5 2.4 5 3V21C5 21.6 5.4 22 6 22H18C18.6 22 19 21.6 19 21V7L14 2Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
                <path
                  d="M14 2V7H19"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="attachment-name">{attachment.name}</span>
            {#if formatBytes(attachment.size)}
              <span class="attachment-size">{formatBytes(attachment.size)}</span>
            {/if}
          </button>
          <button
            class="ui-action"
            aria-label={attachment.name + "の操作"}
            data-task-menu-trigger
            onclick={(event) => openAttachmentMenu(event, attachment)}>…</button
          >
          <span class="attachment-delete">
            <IconButton
              tooltipContent={`添付を削除 ${attachment.name}`}
              ariaLabel={`添付を削除 ${attachment.name}`}
              variant="text"
              disabled={!canUseAttachments || isBusy || readOnly}
              activeColor={"var(--theme-color-Error-main)"}
              normalColor={"var(--theme-color-Sub-main)"}
              onclick={() => deleteAttachment(attachment)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M3 6H21M8 6V4C8 3.4 8.4 3 9 3H15C15.6 3 16 3.4 16 4V6M10 11V17M14 11V17M5 6L6 20C6 20.6 6.4 21 7 21H17C17.6 21 18 20.6 18 20L19 6"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </IconButton>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- 0 件のとき「添付 (0)」(タブ)・「添付 0」(見出し)・「添付なし」(枠) で
       同じことを 3 回言っていた。枠は入力欄のようにも見えるのに押せず、
       すぐ下のドロップ領域と点線の箱が 2 つ縦に並んでいた。件数はタブが
       言っているので、ここは受け口だけを出す。
       ドロップを受けるのは実際にはこの帯ではなく添付欄ぜんたい
       (.attachments-field の ondrop) なので、文言もそう書く。 -->
  {#if canUseAttachments && !readOnly}
    <div
      class="attachment-drop-hint"
      class:attachment-drop-hint-empty={attachmentList.length === 0}
    >
      {#if attachmentList.length === 0}
        <svg class="drop-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21.4 11.6L12.2 20.8C9.7 23.3 5.6 23.3 3.1 20.8C0.6 18.3 0.6 14.2 3.1 11.7L12.7 2.1C14.5 0.4 17.3 0.4 19.1 2.1C20.8 3.9 20.8 6.7 19.1 8.5L9.8 17.8C8.8 18.8 7.2 18.8 6.2 17.8C5.2 16.8 5.2 15.2 6.2 14.2L14.8 5.6"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>この欄にファイルをドロップ</span>
        <button type="button" class="ui-action" disabled={isBusy} onclick={chooseFiles}
          >ファイルを選択</button
        >
      {:else}
        <span>この欄にファイルをドロップして添付</span>
      {/if}
    </div>
  {/if}
  {#if errorMessage}
    <div class="attachment-error" role="alert">{errorMessage}</div>
  {/if}

  <TaskMenu
    menuItems={attachmentMenuItems}
    position={attachmentMenu.position}
    show={attachmentMenu.show}
    onaction={(item) =>
      item.action === "openWith" ? handleAttachmentMenuOpenWith() : handleAttachmentMenuOpen()}
    onclose={closeAttachmentMenu}
  />
</div>

<style>
  .attachment-drop-hint {
    margin: var(--sp2) 0 0;
    padding: var(--sp3);
    border: 1px dashed var(--border-muted);
    border-radius: var(--shape-sm);
    color: var(--fg-muted);
    text-align: center;
    font-size: var(--font-body-sm);
  }
  /* 添付が無いときは、画面でいちばん大きな面を受け口そのものにする。
     44px の帯と 24px のクリップ記号しか入口が無い状態をやめる。 */
  .attachment-drop-hint-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp3);
    min-height: 11.5rem;
  }
  .attachment-drop-hint-empty .drop-icon {
    width: 1.75rem;
    height: 1.75rem;
    opacity: 0.5;
  }
  .attachments-field {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: var(--sp1);
    border-radius: var(--shape-sm);
    outline: 1px dashed transparent;
    outline-offset: 2px;
    color: var(--theme-color-Sub-main);
  }
  .attachments-field.FileDragActive {
    outline-color: var(--theme-color-Primary-main);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 8%, transparent);
  }
  .attachments-header {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--sp1);
  }
  .attachments-header-hidden {
    display: none;
  }
  .attachment-label {
    flex: 0 0 auto;
    min-width: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    line-height: 1.3;
    user-select: none;
  }
  .attachment-count {
    min-width: 1.125rem;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
    font-weight: 600;
  }
  .attachment-input {
    display: none;
  }
  .attachment-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* Keep rows packed at the top when the list is given more height than
       its content (fixed-split mode stretches it to fill the pane). */
    align-content: start;
    gap: var(--sp1);
    min-width: 0;
    margin: 0;
    padding: 0;
    /* Height behavior is mode-dependent and owned by TaskDetail.svelte:
       fixed-split mode gives the list the remaining pane height with an
       internal overflow-y scroll; auto-detail mode caps it with a viewport
       clamp. See the `.detail-pane... :global(.attachment-list)` rules. */
    list-style: none;
  }
  .attachment-item {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 1.5rem;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    border-radius: var(--shape-sm);
    background-color: var(--theme-color-Main-light);
  }
  .attachment-open {
    display: grid;
    grid-template-columns: 0.825rem minmax(0, 1fr) auto;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 1.5rem;
    gap: var(--sp2);
    padding: 0 var(--sp2);
    border: 0;
    background: transparent;
    color: var(--theme-color-Sub-main);
    cursor: pointer;
  }
  .attachment-open:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .file-icon {
    display: flex;
    width: 0.825rem;
    height: 0.825rem;
    color: var(--theme-color-Primary-main);
  }
  .file-icon svg {
    width: 100%;
    height: 100%;
  }
  .attachment-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font-size: var(--font-body-sm);
  }
  .attachment-size {
    color: var(--theme-color-Sub-main);
    opacity: 0.72;
    font-size: var(--font-label-md);
    white-space: nowrap;
  }
  .attachment-delete {
    display: flex;
    flex: 0 0 auto;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .attachment-item:hover .attachment-delete,
  .attachment-item:focus-within .attachment-delete,
  .attachment-delete:focus-within {
    opacity: 1;
  }
  .attachment-dense-hint {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 68%, transparent);
    font-size: var(--font-label-md);
    white-space: nowrap;
  }
  .attachment-error {
    color: var(--theme-color-Error-main);
    font-size: var(--font-label-md);
    font-weight: 600;
  }
</style>
