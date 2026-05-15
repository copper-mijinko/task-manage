<script>
  import TaskName from "@features/tasks/components/TaskName.svelte";

  let clickCount = 0;
</script>

<div
  data-testid="row"
  role="button"
  tabindex="0"
  on:click={() => (clickCount += 1)}
  on:keydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      clickCount += 1;
    }
  }}
>
  <TaskName text="Task 1" />
</div>

<p data-testid="count">{clickCount}</p>
