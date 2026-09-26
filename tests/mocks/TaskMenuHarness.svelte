<script>
  import TaskMenu from "@features/tasks/components/TaskMenu.svelte";

  let show = $state(false);
  const menuItems = [{ title: "名前を変更", action: "rename" }];
</script>

<button type="button" onclick={() => (show = true)}>ノードメニューを開く</button>
<TaskMenu {show} {menuItems} onclose={() => (show = false)} />
