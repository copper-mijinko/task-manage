<script>
  // テスト用: アプリケーションの一部だけを持つスタブをコンテキストに置いて描く。
  import { setContext, untrack } from "svelte";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";

  let { component, props = {}, application } = $props();
  // コンテキストは作成時に 1 回だけ置く。
  setContext(
    TREEGRID_APPLICATION,
    untrack(() => application)
  );
  const Component = $derived(component);
</script>

<Component {...props} />
