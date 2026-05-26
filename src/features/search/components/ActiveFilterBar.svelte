<script lang="ts">
  import { filter } from "@features/search/stores/search";
  import { active_tag } from "@features/memos/stores/tags";
  import { tokenizeFullTextQuery } from "@features/tasks/utils/tree_control";

  $: rawFullText = (
    ($filter as Record<string, string[] | null | undefined>)?.full_text?.[0] ?? ""
  ).trim();
  $: fullTextTokens = rawFullText ? tokenizeFullTextQuery(rawFullText) : [];
  $: searchMemoOn =
    ((($filter as Record<string, string[] | null | undefined>)?.search_memo ?? []).length ?? 0) > 0;
  $: activeTag = $active_tag ?? "";
  $: hasFilters = fullTextTokens.length > 0 || Boolean(activeTag);
  $: showClearAll = fullTextTokens.length + (activeTag ? 1 : 0) > 1;

  function serializeTokens(tokens: string[]): string {
    return tokens.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" ");
  }

  function clearFullText() {
    filter.update((f) => {
      const next = { ...(f as Record<string, unknown>) };
      delete next.full_text;
      return next as typeof f;
    });
  }

  function removeToken(index: number) {
    const remaining = fullTextTokens.filter((_, i) => i !== index);
    if (remaining.length === 0) {
      clearFullText();
      return;
    }
    const serialized = serializeTokens(remaining);
    filter.update(
      (f) =>
        ({
          ...(f as Record<string, unknown>),
          full_text: [serialized],
        }) as typeof f
    );
  }

  function clearTag() {
    // active_tag drives filter.tags via the subscriber in src/stores/index.ts
    active_tag.set(null);
  }

  function clearAll() {
    if (activeTag) active_tag.set(null);
    if (fullTextTokens.length > 0) clearFullText();
  }
</script>

{#if hasFilters}
  <div class="ActiveFilterBar" role="status" aria-live="polite">
    <span class="Label" aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 7C3 6.44772 3.44772 6 4 6H20C20.5523 6 21 6.44772 21 7C21 7.55228 20.5523 8 20 8H4C3.44772 8 3 7.55228 3 7ZM6 12C6 11.4477 6.44772 11 7 11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H7C6.44772 13 6 12.5523 6 12ZM9 17C9 16.4477 9.44772 16 10 16H14C14.5523 16 15 16.4477 15 17C15 17.5523 14.5523 18 14 18H10C9.44772 18 9 17.5523 9 17Z"
          fill="currentColor"
        />
      </svg>
      <span class="LabelText">絞り込み中</span>
    </span>

    {#each fullTextTokens as token, i (i + ":" + token)}
      <span class="Chip" title={searchMemoOn ? "全文検索（メモ本文を含む）" : "全文検索"}>
        <span class="ChipKind">{searchMemoOn ? "検索(メモ含む)" : "検索"}</span>
        <span class="ChipValue">{token}</span>
        <button
          type="button"
          class="ChipClear"
          aria-label={`全文フィルタ「${token}」を削除`}
          title={`「${token}」を削除`}
          on:click={() => removeToken(i)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7 7L17 17M17 7L7 17"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              fill="none"
            />
          </svg>
        </button>
      </span>
    {/each}

    {#if activeTag}
      <span class="Chip" title="タグフィルタ">
        <span class="ChipKind">タグ</span>
        <span class="ChipValue">#{activeTag}</span>
        <button
          type="button"
          class="ChipClear"
          aria-label="タグフィルタをクリア"
          title="タグフィルタをクリア"
          on:click={clearTag}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7 7L17 17M17 7L7 17"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              fill="none"
            />
          </svg>
        </button>
      </span>
    {/if}

    {#if showClearAll}
      <button type="button" class="ClearAll" on:click={clearAll}>すべてクリア</button>
    {/if}
  </div>
{/if}

<style>
  .ActiveFilterBar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp1) var(--sp3);
    box-sizing: border-box;
    width: 100%;
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 8%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 24%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    flex-shrink: 0;
  }
  .Label {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    color: var(--theme-color-Primary-main);
    font-weight: 600;
  }
  .Label svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .LabelText {
    white-space: nowrap;
  }
  .Chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    max-width: min(20rem, 100%);
    padding: 0.1rem var(--sp1) 0.1rem var(--sp2);
    border-radius: var(--shape-pill);
    border: 1px solid var(--theme-color-Primary-main);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    white-space: nowrap;
    min-width: 0;
  }
  .ChipKind {
    color: var(--theme-color-Primary-main);
    font-weight: 700;
    flex-shrink: 0;
  }
  .ChipValue {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  .ChipClear {
    width: 1.1rem;
    height: 1.1rem;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 50%;
    background-color: transparent;
    color: var(--theme-color-Sub-main);
    cursor: pointer;
  }
  .ChipClear:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 30%, transparent);
    color: var(--theme-color-Primary-main);
  }
  .ChipClear:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 1px;
  }
  .ChipClear svg {
    width: 0.75rem;
    height: 0.75rem;
  }
  .ClearAll {
    margin-left: auto;
    padding: 0.15rem var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-xs);
    background-color: transparent;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-sm);
    cursor: pointer;
  }
  .ClearAll:hover {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  .ClearAll:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 1px;
  }
</style>
