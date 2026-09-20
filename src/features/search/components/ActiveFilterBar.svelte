<script lang="ts">
  import { filter } from "@features/search/stores/search";
  import { active_tag } from "@features/memos/stores/tags";
  import { tokenizeFullTextQuery } from "@features/tasks/utils/tree_control";
  const labels: Record<string, string> = {
    full_text: "検索",
    name: "ノード名",
    status: "ステータス",
    tags: "タグ",
    "start date": "開始日",
    "due date": "期限日",
    attachments: "添付数",
  };
  $: chips = Object.entries($filter).flatMap(([key, values]) => {
    if (!labels[key] || !values?.length) return [];
    if (["start date", "due date", "attachments"].includes(key)) {
      if (!values.some(Boolean)) return [];
      return [
        {
          key,
          index: -1,
          label: labels[key],
          value: (values[0] || "指定なし") + " 〜 " + (values[1] || "指定なし"),
        },
      ];
    }
    return values.map((value, index) => ({
      key,
      index,
      label: key === "full_text" && $filter.search_memo?.length ? "検索(メモ含む)" : labels[key],
      value:
        key === "full_text" ? tokenizeFullTextQuery(value.trim()).join(" ") : value || "未設定",
    }));
  });
  function removeChip(key: string, index: number) {
    const values = $filter[key] ?? [];
    if (key === "tags" && $active_tag) active_tag.set(null);
    filter.update((f) => ({
      ...f,
      [key]: index === -1 ? [] : values.filter((_, i) => i !== index),
    }));
  }
  function clearAll() {
    active_tag.set(null);
    filter.set({ search_memo: $filter.search_memo });
  }
</script>

{#if chips.length}
  <div class="ActiveFilterBar" role="status" aria-live="polite">
    <span class="Label">絞り込み中</span>
    {#each chips as chip (chip.key + ":" + chip.index)}
      <span class="Chip">
        <span class="ChipKind">{chip.label}</span><span class="ChipValue">{chip.value}</span>
        <button
          type="button"
          class="ChipClear"
          aria-label={chip.key === "full_text"
            ? "全文フィルタ「" + chip.value + "」を削除"
            : chip.label + "フィルタ「" + chip.value + "」を削除"}
          on:click={() => removeChip(chip.key, chip.index)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path
              d="M7 7L17 17M17 7L7 17"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
            /></svg
          >
        </button>
      </span>
    {/each}
    <button type="button" class="ClearAll" on:click={clearAll}>すべてクリア</button>
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

  .Chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    max-width: min(15rem, 100%);
    padding: 0.075rem var(--sp1) 0.075rem var(--sp2);
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
    width: 0.825rem;
    height: 0.825rem;
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
    width: 0.5625rem;
    height: 0.5625rem;
  }
  .ClearAll {
    margin-left: auto;
    padding: 0.1125rem var(--sp2);
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
