<script lang="ts">
  import MarkdownMemo from "@features/memos/components/MarkdownMemo.svelte";
  import QuillMemo from "@features/memos/components/QuillMemo.svelte";

  export let saveMemo: (content: unknown) => void;
  export let content: unknown = "";
  export let readOnly = false;
  export let memoTitles: string[] = [];
  export let openMemoLink: ((title: string) => void) | undefined = undefined;
  export let workspaceProjectDir: string | null = null;
  export let taskId: string | null = null;
  export let isWorkspaceProject = false;

  function saveUnknown(nextContent: unknown) {
    saveMemo(nextContent);
  }
</script>

{#if isWorkspaceProject}
  <MarkdownMemo
    saveMemo={(nextContent) => saveMemo(nextContent)}
    {content}
    {readOnly}
    {memoTitles}
    {openMemoLink}
    {workspaceProjectDir}
    {taskId}
  />
{:else}
  <QuillMemo saveMemo={saveUnknown} {content} {readOnly} />
{/if}
