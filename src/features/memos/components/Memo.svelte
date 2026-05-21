<script lang="ts">
  import MarkdownMemo from "@features/memos/components/MarkdownMemo.svelte";
  import QuillMemo from "@features/memos/components/QuillMemo.svelte";
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

  $: memoFormat = normalizeMemoFormat(format, isWorkspaceProject ? "markdown" : "quill");
</script>

<div class="memo-host">
  {#if memoFormat === "markdown"}
    <MarkdownMemo
      saveMemo={(nextContent) => saveMemo(nextContent)}
      {content}
      {readOnly}
      {memoTitles}
      {currentMemoTitle}
      {openMemoLink}
      {workspaceProjectDir}
      {taskId}
    />
  {:else}
    <QuillMemo saveMemo={saveUnknown} {content} {readOnly} />
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
