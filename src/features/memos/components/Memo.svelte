<script lang="ts">
  import { normalizeMemoFormat, type MemoFormat } from "@features/memos/utils/memo_utils";
  import { pendingMemoDrafts } from "@features/memos/stores/pending_drafts";
  import { windowClose } from "@lib/ipc/platform";
  import { untrack } from "svelte";

  interface Props {
    saveMemo: (content: unknown) => unknown;
    content?: unknown;
    draftKey?: string;
    freezeTarget?: boolean;
    readOnly?: boolean;
    memoTitles?: string[];
    currentMemoTitle?: string;
    openMemoLink?: ((title: string) => void) | undefined;
    format?: MemoFormat | undefined;
    saveImage?: ((file: File) => Promise<string | null>) | undefined;
    resolveAsset?: ((relativePath: string) => Promise<string | null>) | undefined;
  }

  let {
    saveMemo,
    content = "",
    draftKey = "",
    freezeTarget = false,
    readOnly = false,
    memoTitles = [],
    currentMemoTitle = "",
    openMemoLink = undefined,
    format = undefined,
    saveImage = undefined,
    resolveAsset = undefined,
  }: Props = $props();

  // 保存先と下書きのキーは作成時のものに固定する（途中で別ノードに
  // 切り替わっても、書きかけは元のノードへ保存する）。
  const instanceSave = untrack(() => saveMemo);
  const instanceDraftKey = untrack(() => draftKey);
  const initialDraft = pendingMemoDrafts.get(instanceDraftKey);
  let recoveredDraft = $state(initialDraft);
  let recoveryError = $state(Boolean(initialDraft));

  let editor:
    | (import("svelte").SvelteComponent & {
        flush?: () => unknown | Promise<unknown>;
        hasPendingSave?: () => boolean;
        startEditing?: () => void;
      })
    | undefined = $state();
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
    $state(null);
  let QuillMemo: typeof import("@features/memos/components/QuillMemo.svelte").default | null =
    $state(null);
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

  let editorContent = $derived(recoveredDraft ? recoveredDraft.content : content);
  let memoFormat = $derived(normalizeMemoFormat(format, "markdown"));
  $effect.pre(() => {
    if (memoFormat === "markdown") {
      loadMarkdownMemo();
    } else {
      loadQuillMemo();
    }
  });
</script>

<svelte:window onbeforeunload={beforeUnload} />

<div class="memo-host">
  {#if recoveryError}<div role="alert">
      未保存の本文があります。<button class="ui-action" onclick={flush}>再試行</button>
    </div>{/if}
  {#if memoFormat === "markdown"}
    {#if MarkdownMemo}
      <MarkdownMemo
        bind:this={editor}
        saveMemo={saveUnknown}
        content={editorContent}
        {readOnly}
        {memoTitles}
        {currentMemoTitle}
        {openMemoLink}
        {saveImage}
        {resolveAsset}
      />
    {/if}
  {:else if QuillMemo}
    <QuillMemo bind:this={editor} saveMemo={saveUnknown} content={editorContent} {readOnly} />
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
