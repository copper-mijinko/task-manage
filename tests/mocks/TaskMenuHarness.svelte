<script>
  import TaskMenu from "@features/tasks/components/TaskMenu.svelte";

  let show = false;
  const menuItems = [{ title: "名前を変更", action: "rename" }];
</script>

<button type="button" on:click={() => (show = true)}>タスクメニューを開く</button>
<TaskMenu {show} {menuItems} on:close={() => (show = false)} />
