<script>
  /**
   * 多親ノードをアーカイブするときの範囲選択。
   *
   * 行は「ノードの辺」なので、同じノードが複数の場所に出る。片付けたいのが
   * その場所だけなのか、ノードごとなのかは操作した人にしか分からないので、
   * 出現が 2 つ以上あるときだけここで聞く（1 つしかなければ差が無いので出さない）。
   */
  import { createEventDispatcher } from "svelte";
  import Modal from "@lib/primitives/Modal.svelte";
  import Button from "@lib/primitives/Button.svelte";

  /** 対象。`null` の間は閉じている。`{ name, places }` を持つ。 */
  export let target = null;

  const dispatch = createEventDispatcher();

  // 文章はテンプレートで組み立てる（マークアップに混ぜると、整形のたびに
  // 「2 か所」のような余計な空白が入る）。
  $: message = `「${target?.name ?? ""}」は${
    target?.places ? `${target.places}か所` : "複数の場所"
  }に置かれています。この行だけ片付けますか、ノードごとまとめて片付けますか？`;
</script>

<Modal
  show={Boolean(target)}
  toggle={() => dispatch("cancel")}
  width="25.5rem"
  height="auto"
  label="アーカイブの範囲を選択"
>
  <div class="ArchiveScope">
    <h2>アーカイブの範囲</h2>
    <p>{message}</p>
    <div class="ArchiveScopeActions">
      <Button content="キャンセル" variant="text" on:click={() => dispatch("cancel")} />
      <Button content="この場所だけ" variant="outlined" on:click={() => dispatch("edge")} />
      <Button content="ノード全体" on:click={() => dispatch("node")} />
    </div>
  </div>
</Modal>

<style>
  .ArchiveScope {
    padding: var(--sp4);
    color: var(--fg-default);
    background: var(--canvas-default);
  }
  .ArchiveScope h2 {
    margin: 0 0 var(--sp2);
    font-size: var(--font-title-md);
  }
  .ArchiveScope p {
    margin: 0 0 var(--sp3);
    font-size: var(--font-body-sm);
    line-height: 1.6;
  }
  .ArchiveScopeActions {
    display: flex;
    flex-wrap: nowrap;
    gap: var(--sp2);
    justify-content: flex-end;
  }
</style>
