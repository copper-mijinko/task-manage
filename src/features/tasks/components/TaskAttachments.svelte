<script>
  import IconButton from "@lib/primitives/IconButton.svelte";
  import * as platform from "@lib/ipc/platform";
  import TaskMenu from "./TaskMenu.svelte";

  export let attachments = [];
  export let isWorkspaceProject = false;
  export let workspaceProjectDir = null;
  export let taskId = null;
  export let onAttachmentsChange = undefined;

  let fileInput;
  let isBusy = false;
  let isFileDragActive = false;
  let errorMessage = "";
  let attachmentMenu = {
    show: false,
    attachment: null,
    position: { x: 0, y: 0, position: "right" },
  };

  $: attachmentList = Array.isArray(attachments) ? attachments : [];
  $: canUseAttachments = Boolean(isWorkspaceProject && workspaceProjectDir && taskId);
  $: attachmentMenuItems = [
    { title: "開く", action: "open" },
    { title: "プログラムから開く", action: "openWith" },
  ];
  $: attachTooltip = canUseAttachments ? "添付を追加" : "ワークスペースプロジェクトで利用できます";

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

  function updateAttachments(nextAttachments) {
    onAttachmentsChange?.(nextAttachments);
  }

  function chooseFiles() {
    if (!canUseAttachments || isBusy) return;
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
    const fileList = Array.from(files ?? []).filter((file) => file?.arrayBuffer);
    if (!canUseAttachments || fileList.length === 0) return;

    isBusy = true;
    errorMessage = "";
    const savedAttachments = [];

    try {
      for (const file of fileList) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await platform.wsSaveTaskAttachment(
          workspaceProjectDir,
          taskId,
          file.name,
          bytes
        );
        if (!result?.success || !result.attachment) {
          errorMessage = result?.error ?? "添付を保存できませんでした";
          continue;
        }
        savedAttachments.push(result.attachment);
      }

      if (savedAttachments.length > 0) {
        updateAttachments([...attachmentList, ...savedAttachments]);
      }
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

  async function openAttachment(attachment) {
    if (!canUseAttachments || isBusy) return;
    closeAttachmentMenu();
    errorMessage = "";
    const result = await platform.wsOpenTaskAttachment(
      workspaceProjectDir,
      taskId,
      attachmentPath(attachment)
    );
    if (!result?.success) {
      errorMessage = result?.error ?? "添付を開けませんでした";
    }
  }

  async function openAttachmentWith(attachment) {
    if (!canUseAttachments || isBusy) return;
    closeAttachmentMenu();
    errorMessage = "";
    const result = await platform.wsOpenTaskAttachmentWith(
      workspaceProjectDir,
      taskId,
      attachmentPath(attachment)
    );
    if (!result?.success) {
      errorMessage = result?.error ?? "プログラムから開けませんでした";
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
      openAttachmentWith(attachmentMenu.attachment);
    }
  }

  async function deleteAttachment(attachment) {
    if (!canUseAttachments || isBusy) return;
    closeAttachmentMenu();
    const confirmed = window.confirm?.(`"${attachment.name}" を削除しますか？`);
    if (confirmed === false) return;

    isBusy = true;
    errorMessage = "";
    try {
      const result = await platform.wsDeleteTaskAttachment(
        workspaceProjectDir,
        taskId,
        attachmentPath(attachment)
      );
      if (!result?.success) {
        errorMessage = result?.error ?? "添付を削除できませんでした";
        return;
      }
      updateAttachments(
        result.attachments ??
          attachmentList.filter((entry) => attachmentPath(entry) !== attachmentPath(attachment))
      );
    } finally {
      isBusy = false;
    }
  }
</script>

<div
  class="attachments-field"
  class:FileDragActive={isFileDragActive && canUseAttachments && !isBusy}
  role="group"
  aria-label="添付"
  data-testid="task-attachments"
  on:dragenter={handleDragEnter}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
>
  <div class="attachments-header">
    <span class="attachment-label" id="lbl-attachment-count">添付</span>
    <output class="attachment-count" aria-labelledby="lbl-attachment-count"
      >{attachmentList.length}</output
    >
    <IconButton
      tooltipContent={attachTooltip}
      ariaLabel="添付を追加"
      variant="text"
      disabled={!canUseAttachments || isBusy}
      activeColor={"var(--theme-color-Primary-main)"}
      normalColor={"var(--theme-color-Sub-main)"}
      on:click={chooseFiles}
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
      on:change={attachFiles}
    />
  </div>

  {#if attachmentList.length > 0}
    <ul class="attachment-list" aria-label="添付ファイル">
      {#each attachmentList as attachment (attachmentPath(attachment))}
        <li class="attachment-item">
          <button
            type="button"
            class="attachment-open"
            title={attachment.name}
            disabled={!canUseAttachments || isBusy}
            on:click={() => openAttachment(attachment)}
            on:contextmenu={(event) => openAttachmentMenu(event, attachment)}
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
          <IconButton
            tooltipContent={`添付を削除 ${attachment.name}`}
            ariaLabel={`添付を削除 ${attachment.name}`}
            variant="text"
            disabled={!canUseAttachments || isBusy}
            activeColor={"var(--theme-color-Error-main)"}
            normalColor={"var(--theme-color-Sub-main)"}
            on:click={() => deleteAttachment(attachment)}
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
        </li>
      {/each}
    </ul>
  {:else}
    <div class="attachment-empty" aria-label="添付なし">なし</div>
  {/if}

  {#if errorMessage}
    <div class="attachment-error" role="alert">{errorMessage}</div>
  {/if}

  <TaskMenu
    menuItems={attachmentMenuItems}
    position={attachmentMenu.position}
    show={attachmentMenu.show}
    on:open={handleAttachmentMenuOpen}
    on:openWith={handleAttachmentMenuOpenWith}
    on:close={closeAttachmentMenu}
  />
</div>

<style>
  .attachments-field {
    display: flex;
    flex-direction: column;
    grid-column: 1 / -1;
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
    min-width: 1.5rem;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
    font-weight: 600;
  }
  .attachment-input {
    display: none;
  }
  .attachment-list {
    display: grid;
    gap: var(--sp1);
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .attachment-item {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 2rem;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    border-radius: var(--shape-sm);
    background-color: var(--theme-color-Main-light);
  }
  .attachment-open {
    display: grid;
    grid-template-columns: 1.1rem minmax(0, 1fr) auto;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 2rem;
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
    width: 1.1rem;
    height: 1.1rem;
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
  .attachment-empty {
    display: flex;
    align-items: center;
    min-height: 2rem;
    padding: 0 var(--sp2);
    border: 1px dashed color-mix(in srgb, var(--theme-color-Sub-main) 26%, transparent);
    border-radius: var(--shape-sm);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 68%, transparent);
    font-size: var(--font-body-sm);
  }
  .attachment-error {
    color: var(--theme-color-Error-main);
    font-size: var(--font-label-md);
    font-weight: 600;
  }
</style>
