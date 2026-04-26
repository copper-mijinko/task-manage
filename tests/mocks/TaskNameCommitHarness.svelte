<script>
  import TaskName from "../../src/components/TaskName.svelte";

  export let initialText = "Task 1";
  let currentText = initialText;
  let committedCount = 0;
  let lastCommitted = "";

  function handleCommit(event) {
    currentText = event.detail.value;
    lastCommitted = event.detail.value;
    committedCount += 1;
  }
</script>

<TaskName text={currentText} on:commit={handleCommit} />

<p data-testid="current-text">{currentText}</p>
<p data-testid="committed-count">{committedCount}</p>
<p data-testid="last-committed">{lastCommitted}</p>
