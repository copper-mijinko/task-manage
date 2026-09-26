<script>
  import Modal from "@lib/primitives/Modal.svelte";
  import Button from "@lib/primitives/Button.svelte";

  /**
   * @typedef {Object} Props
   * @property {boolean} [show]
   * @property {any} toggle
   * @property {any} header
   * @property {any} content
   * @property {any} [callback]
   * @property {string} [ok] - 確定ボタンのラベル。既定は英語の "ok" だったが、UI 全体が日本語なので
言語が混ざるうえ、"ok" は「何が起きるか」を述べない。呼び出し側は
「アーカイブする」「完全に削除」のように動作を名指しするのが望ましい。
   * @property {string} [cancel]
   * @property {boolean} [danger] - 取り消せない操作（完全削除など）の確認かどうか。true のとき確定ボタンを
エラー色にして、通常の確認と見分けられるようにする。既定のプライマリ青の
ままだと、削除の確認と保存の確認が同じ見た目になる。
   * @property {string} [width]
   * @property {string} [height]
   */

  /** @type {Props} */
  let {
    show = false,
    toggle,
    header,
    content,
    callback = undefined,
    ok = "実行",
    cancel = "キャンセル",
    danger = false,
    width = "21rem",
    height = "auto",
  } = $props();

  const dialogHeaderId = `dialog-header-${Math.random().toString(36).slice(2)}`;
</script>

<Modal {show} {toggle} {width} {height} labelledBy={dialogHeaderId}>
  <div class="container">
    <div class="header" id={dialogHeaderId}>{header}</div>
    <div class="content">{content}</div>
    {#if ok || cancel}
      <div class="control">
        {#if cancel}
          <Button use_ripple={false} variant="text" content={cancel} onclick={toggle} />
        {/if}
        {#if ok}
          <Button
            use_ripple={false}
            variant="filled"
            content={ok}
            normalColor={danger ? "var(--theme-color-Error-main)" : "var(--theme-color-Info-main)"}
            activeColor={danger ? "var(--theme-color-Error-dark)" : "var(--theme-color-Info-dark)"}
            onclick={() => {
              callback();
              toggle();
            }}
          />
        {/if}
      </div>
    {/if}
  </div>
</Modal>

<style>
  .container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    background-color: var(--theme-color-Main-light);
    border-radius: var(--shape-md);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    width: 100%;
    padding: var(--sp4);
    margin: 0;
    box-sizing: border-box;
    font-weight: 600;
    font-size: var(--font-title-md);
    color: var(--theme-color-Sub-main);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    background-color: var(--theme-color-Main-main);
  }
  .content {
    display: flex;
    width: 100%;
    padding: var(--sp4);
    margin: 0;
    box-sizing: border-box;
    font-size: var(--font-body-md);
    line-height: 1.5;
    color: var(--theme-color-Sub-main);
    overflow-y: auto;
    flex: 1;
    white-space: pre-wrap;
  }
  .control {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp2);
    width: 100%;
    padding: var(--sp2) var(--sp4);
    margin: 0;
    box-sizing: border-box;
    border-top: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
</style>
