<script>
  // テスト用: ツリーグリッドのアプリケーションをコンテキストに置き、
  // グラフを読み込んでから中身を描く。
  import { setContext, onDestroy, untrack } from "svelte";
  import {
    createTreeGridApplication,
    TREEGRID_APPLICATION,
  } from "@features/workspace/application/treegrid";
  import { workspace_graph_store } from "@features/workspace/stores/graph";
  import { selected_id, selected_type } from "@stores/ui";

  let { component, props = {}, workspacePath, scopeId, onready = () => {} } = $props();

  // アプリケーションは作成時の workspacePath で 1 回だけ作る。
  const path = untrack(() => workspacePath);
  const application = createTreeGridApplication(path);
  setContext(TREEGRID_APPLICATION, application);
  let ready = $state(false);

  workspace_graph_store.load(path).then((graph) => {
    const scope = scopeId ?? graph.rootId;
    application.scope.set(scope);
    selected_type.set("WorkspaceProject");
    selected_id.set(scope);
    ready = true;
    onready(application);
  });

  onDestroy(application.dispose);

  const Component = $derived(component);
</script>

{#if ready}
  <Component {...props} />
{/if}
