<script lang="ts">
  import { normalizeMemoFormat, type MemoFormat } from "@features/memos/utils/memo_utils";

  export let saveMemo: (content: unknown) => void;
  export let content: unknown = "";
  export let readOnly = false;
  export let memoTitles: string[] = [];
  export let currentMemoTitle = "";
  export let openMemoLink: ((title: string) => void) | undefined = undefined;
  export let workspaceProjectDir: string | null = null;
  export let taskId: string | null = null;
  export let isWorkspaceProject = false;
  export let format: MemoFormat | undefined = undefined;

  function saveUnknown(nextContent: unknown) {
    saveMemo(nextContent);
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

<div class="memo-host">
  {#if memoFormat === "markdown"}
    {#if MarkdownMemo}
      <svelte:component
        this={MarkdownMemo}
        saveMemo={(nextContent: string) => saveMemo(nextContent)}
        {content}
        {readOnly}
        {memoTitles}
        {currentMemoTitle}
        {openMemoLink}
        {workspaceProjectDir}
        {taskId}
      />
    {/if}
  {:else if QuillMemo}
    <svelte:component this={QuillMemo} saveMemo={saveUnknown} {content} {readOnly} />
  {/if}
</div>

<style>
  .memo-host {
    display: flex;
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
