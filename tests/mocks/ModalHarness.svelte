<script>
  import Modal from "@lib/primitives/Modal.svelte";

  let show = false;
</script>

<button type="button" on:click={() => (show = true)}>設定を開く</button>
<Modal {show} toggle={() => (show = !show)} label="テスト設定">
  <button type="button">設定内の操作</button>
</Modal>
