<script>
  import Modal from "@lib/primitives/Modal.svelte";

  let show = $state(false);
</script>

<button type="button" onclick={() => (show = true)}>設定を開く</button>
<Modal {show} toggle={() => (show = !show)} label="テスト設定">
  <button type="button">設定内の操作</button>
</Modal>
