<script>
  import { notice, dismissNotice } from "@stores/notice";

  /**
   * 操作の結果を知らせる 1 行の通知（アーカイブ・元に戻す・コピーなど）。
   * 本体と詳細ウィンドウの両方に置く。確認ダイアログをやめた操作は、ここの
   * 「元に戻す」が取り消しの手段なので、どのウィンドウでも出す必要がある。
   */
</script>

{#if $notice}
  <div class="notice-banner" role="status">
    <span>{$notice.message}</span>
    {#if $notice.action}
      <button
        class="notice-action"
        onclick={() => {
          const current = $notice;
          dismissNotice(current?.id);
          current?.action?.();
        }}>{$notice.actionLabel ?? "元に戻す"}</button
      >
    {/if}
    <button aria-label="通知を閉じる" onclick={() => dismissNotice()}>×</button>
  </div>
{/if}

<style>
  .notice-banner {
    pointer-events: auto;
    border-radius: var(--shape-sm);
    box-shadow: var(--elevation-3);
    overflow-wrap: anywhere;
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2) var(--sp3);
    background: var(--theme-color-Sub-main);
    color: var(--theme-color-Main-main);
    font-size: var(--font-body-sm);
  }
  .notice-banner > span {
    flex: 1;
    min-width: 0;
  }
  .notice-banner button {
    min-height: var(--tap-min);
    padding: 0 var(--sp2);
    border: 0;
    border-radius: var(--shape-xs);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .notice-banner .notice-action {
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
