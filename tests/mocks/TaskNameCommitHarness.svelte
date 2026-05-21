<script>
  import TaskName from "@features/tasks/components/TaskName.svelte";

  export let initialText = "Task 1";
  export let canOpenTaskFolder = false;
  let currentText = initialText;
  let committedCount = 0;
  let lastCommitted = "";
  let openFolderCount = 0;

  function handleCommit(event) {
    currentText = event.detail.value;
    lastCommitted = event.detail.value;
    committedCount += 1;
  }
</script>

<TaskName
  text={currentText}
  {canOpenTaskFolder}
  on:commit={handleCommit}
  on:openTaskFolder={() => (openFolderCount += 1)}
/>

<p data-testid="current-text">{currentText}</p>
<p data-testid="committed-count">{committedCount}</p>
<p data-testid="last-committed">{lastCommitted}</p>
<p data-testid="open-folder-count">{openFolderCount}</p>
