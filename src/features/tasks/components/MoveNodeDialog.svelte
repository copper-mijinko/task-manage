<script>
  import { getContext } from "svelte";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  import Modal from "@lib/primitives/Modal.svelte";
  import NodePicker from "./NodePicker.svelte";
  import { descendantIds, nodePathLabels } from "@features/tasks/utils/node_search";

  /**
   * ノードを別の親の下へ移すダイアログ（行メニューの「移動…」と、詳細ペインの
   * 「配置を変更」）。Inbox からプロジェクトへ振り分けるときの近道でもある。
   *
   * 移動先は名前や経路で絞り込める。自分自身・子孫（循環になる）・いまの親は
   * 候補に出さない。複数の親を持つノードでは、表示している配置だけを外す
   * 操作もここで選べる。
   *
   * @typedef {Object} Props
   * @property {string} nodeId
   * @property {string} path - 動かす行の経路（親は末尾の一つ手前）。
   * @property {() => void} [onclose]
   */

  /** @type {Props} */
  let { nodeId, path, onclose } = $props();

  const application = getContext(TREEGRID_APPLICATION);
  const records = application.records;
  const tree = application.tree;
  const error = application.error;

  let target = $state("");
  let busy = $state(false);

  let node = $derived($records?.[nodeId]);
  let currentParentId = $derived((path || "").split("/").at(-2));
  let candidates = $derived.by(() => {
    if (!node) return [];
    const excluded = descendantIds($records, nodeId);
    excluded.add(nodeId);
    if (currentParentId) excluded.add(currentParentId);
    const paths = nodePathLabels($tree?.data);
    return Object.values($records ?? {})
      .filter((record) => !excluded.has(record.id) && !record.archived)
      .map((record) => ({ id: record.id, name: record.name, path: paths[record.id] ?? "" }));
  });
  let canDetach = $derived((node?.parents?.length ?? 0) > 1 && Boolean(currentParentId));

  async function run(operation) {
    busy = true;
    try {
      if (await operation()) onclose?.();
    } finally {
      busy = false;
    }
  }
  const move = () => run(() => application.moveTo(nodeId, path, target));
  const detach = () => run(() => application.detach(nodeId, path));

  error.set("");
</script>

<Modal label="移動先を選ぶ" width="26rem" height="auto" toggle={() => !busy && onclose?.()}>
  <div class="MoveNodeDialog">
    <h2>「{node?.name ?? ""}」を移動</h2>
    <p class="From">いまの親: {$records?.[currentParentId]?.name ?? "なし"}</p>
    {#if $error}<p role="alert">{$error}</p>{/if}
    <NodePicker
      {candidates}
      value={target}
      label="移動先の親"
      disabled={busy}
      onchange={({ id }) => (target = id)}
    />
    <div class="Actions">
      {#if canDetach}
        <button type="button" class="Secondary" disabled={busy} onclick={detach}
          >この配置を外す</button
        >
      {/if}
      <span class="Spacer"></span>
      <button type="button" disabled={busy} onclick={() => onclose?.()}>キャンセル</button>
      <button type="button" class="Primary" disabled={busy || !target} onclick={move}>移動</button>
    </div>
  </div>
</Modal>

<style>
  .MoveNodeDialog {
    display: flex;
    flex-direction: column;
    gap: var(--sp2);
    padding: var(--sp1) 0;
  }
  h2 {
    margin: 0;
    font-size: var(--font-title-md);
    overflow-wrap: anywhere;
  }
  .From {
    margin: 0;
    font-size: var(--font-label-md);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 75%, transparent);
  }
  .Actions {
    display: flex;
    align-items: center;
    gap: var(--sp2);
  }
  .Spacer {
    flex: 1;
  }
  button {
    min-height: var(--tap-min);
    padding: 0 var(--sp3);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-xs);
    background: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-light);
    cursor: pointer;
  }
  button.Primary {
    border-color: var(--theme-color-Primary-main);
    background: var(--theme-color-Primary-main);
    color: var(--theme-color-Main-main);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
