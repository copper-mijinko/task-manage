<script>
  import { setContext, untrack } from "svelte";
  import { writable } from "svelte/store";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  import TaskName from "@features/tasks/components/TaskName.svelte";

  /**
   * @typedef {Object} Props
   * @property {string} [initialText]
   * @property {boolean} [reject] 受け付けられなかった操作のように、名前を変えない
   */

  /** @type {Props} */
  let { initialText = "Task 1", reject = false } = $props();
  // TaskName が読むのはクリップボードだけ。
  setContext(TREEGRID_APPLICATION, { copied: writable([]) });
  let currentText = $state(untrack(() => initialText));
  let committedCount = $state(0);
  let lastCommitted = $state("");

  function handleCommit(event) {
    if (!reject) currentText = event.value;
    lastCommitted = event.value;
    committedCount += 1;
  }
</script>

<TaskName text={currentText} oncommit={handleCommit} />

<p data-testid="current-text">{currentText}</p>
<p data-testid="committed-count">{committedCount}</p>
<p data-testid="last-committed">{lastCommitted}</p>
