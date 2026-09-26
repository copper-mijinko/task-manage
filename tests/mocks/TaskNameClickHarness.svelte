<script>
  import { setContext } from "svelte";
  import { writable } from "svelte/store";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  import TaskName from "@features/tasks/components/TaskName.svelte";

  // TaskName が読むのはクリップボードだけ。
  setContext(TREEGRID_APPLICATION, { copied: writable([]) });
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
