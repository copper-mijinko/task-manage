<script lang="ts">
  import { normalizeMemoFormat, type MemoFormat } from "@features/memos/utils/memo_utils";
  import { pendingMemoDrafts } from "@features/memos/stores/pending_drafts";
  import { windowClose } from "@lib/ipc/platform";

  export let saveMemo: (content: unknown) => unknown;
  export let content: unknown = "";
  export let draftKey = "";
  export let freezeTarget = false;
  const instanceSave = saveMemo;
  const instanceDraftKey = draftKey;
  const initialDraft = pendingMemoDrafts.get(draftKey);
  let recoveredDraft = initialDraft;
  let recoveryError = Boolean(initialDraft);
  $: editorContent = recoveredDraft ? recoveredDraft.content : content;
  export let readOnly = false;
  export let memoTitles: string[] = [];
  export let currentMemoTitle = "";
  export let openMemoLink: ((title: string) => void) | undefined = undefined;
  export let workspaceProjectDir: string | null = null;
  export let taskId: string | null = null;
  export let isWorkspaceProject = false;
  export let format: MemoFormat | undefined = undefined;
  export let saveImage: ((file: File) => Promise<string | null>) | undefined = undefined;
  export let resolveAsset: ((relativePath: string) => Promise<string | null>) | undefined =
    undefined;

  let editor:
    | (import("svelte").SvelteComponent & {
        flush?: () => unknown | Promise<unknown>;
        hasPendingSave?: () => boolean;
        startEditing?: () => void;
      })
    | undefined;
  let closing = false;
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!freezeTarget || (!editor?.hasPendingSave?.() && !pendingMemoDrafts.size)) return;
    event.preventDefault();
    event.returnValue = "";
    if (closing) return;
    closing = true;
    void flush()
      .then((result) => {
        if (result !== false && !pendingMemoDrafts.size) windowClose();
        else recoveryError = true;
      })
      .finally(() => (closing = false));
  }
  export async function flush() {
    const result = await editor?.flush?.();
    if (result === false) return false;
    if (recoveredDraft) return saveUnknown(recoveredDraft.content);
    return result;
  }
  export function startEditing() {
    editor?.startEditing?.();
  }

  async function saveUnknown(nextContent: unknown) {
    const key = freezeTarget ? instanceDraftKey : draftKey;
    const draft = { content: nextContent };
    if (key) pendingMemoDrafts.set(key, draft);
    try {
      const result = await (freezeTarget ? instanceSave : saveMemo)(nextContent);
      if (result === false) throw new Error("Save rejected");
      if (key && pendingMemoDrafts.get(key) === draft) pendingMemoDrafts.delete(key);
      recoveredDraft = undefined;
      recoveryError = false;
      return result;
    } catch {
      recoveryError = true;
      return false;
    }
  }

  let MarkdownMemo: typeof import("@features/memos/components/MarkdownMemo.svelte").default | null =
    null;
  let QuillMemo: typeof import("@features/memos/components/QuillMemo.svelte").default | null = null;
  let markdownMemoLoading: Promise<void> | null = null;
  let quillMemoLoading: Promise<void> | null = null;

  function loadMarkdownMemo() {
    if (MarkdownMemo || markdownMemoLoading) return;
    markdownMemoLoading = import("@features/memos/components/MarkdownMemo.svelte").then(
      (module) => {
        MarkdownMemo = module.default;
      }
    );
  }

  function loadQuillMemo() {
    if (QuillMemo || quillMemoLoading) return;
    quillMemoLoading = import("@features/memos/components/QuillMemo.svelte").then((module) => {
      QuillMemo = module.default;
    });
  }

  $: memoFormat = normalizeMemoFormat(format, isWorkspaceProject ? "markdown" : "quill");
  $: if (memoFormat === "markdown") {
    loadMarkdownMemo();
  } else {
    loadQuillMemo();
  }
</script>

<svelte:window on:beforeunload={beforeUnload} />

<div class="memo-host">
  {#if recoveryError}<div role="alert">
      未保存の本文があります。<button class="ui-action" on:click={flush}>再試行</button>
    </div>{/if}
  {#if memoFormat === "markdown"}
    {#if MarkdownMemo}
      <svelte:component
        this={MarkdownMemo}
        bind:this={editor}
        saveMemo={saveUnknown}
        content={editorContent}
        {readOnly}
        {memoTitles}
        {currentMemoTitle}
        {openMemoLink}
        {workspaceProjectDir}
        {taskId}
        {saveImage}
        {resolveAsset}
      />
    {/if}
  {:else if QuillMemo}
    <svelte:component
      this={QuillMemo}
      bind:this={editor}
      saveMemo={saveUnknown}
      content={editorContent}
      {readOnly}
    />
  {/if}
</div>

<style>
  .memo-host {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .memo-host :global(.wrapper) {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
</style>
