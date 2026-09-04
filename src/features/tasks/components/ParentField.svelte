<script>
  import { createEventDispatcher } from "svelte";

  /**
   * 親ノードを付け外しするフィールド。タグ欄と同じ操作にしてある
   * （チップが並ぶ / 入力すると候補が出る / × で外す）。
   *
   * 多親は例外ではなく通常なので、2 つ目以降を足すことが第一級の操作になる。
   * ただし最初はチップ 1 個から始まるので、多親を意識せずに使える。
   *
   * 候補から子孫を外すことで、循環は**編集時に**防ぐ。表示側の打ち切りは保険。
   */

  /** 現在の親（ノード id の配列）。 */
  export let parentIds = [];
  /**
   * 候補。`{ id, name, path }` の配列。呼び出し側が自分自身と子孫を
   * 除いたものを渡す（循環防止）。
   */
  export let candidates = [];
  /** id → 表示名。チップのラベルに使う。 */
  export let nameById = {};
  export let disabled = false;
  export let maxSuggestions = 8;

  const dispatch = createEventDispatcher();

  let input = "";
  let inputElement;
  let activeIndex = 0;

  $: current = parentIds ?? [];
  $: query = input.trim().toLowerCase();
  /**
   * VS Code 風に、入力文字が順に含まれていれば拾う（部分一致より緩い）。
   * 連続一致を優先して並べるので、素直に打てば目当てが上に来る。
   */
  $: visibleCandidates = rank(candidates ?? [], query).slice(0, maxSuggestions);
  $: if (visibleCandidates.length <= activeIndex) activeIndex = 0;

  function subsequenceScore(text, needle) {
    if (!needle) return 0;
    const haystack = text.toLowerCase();
    const direct = haystack.indexOf(needle);
    if (direct >= 0) return 1000 - direct;
    let cursor = 0;
    let score = 0;
    let streak = 0;
    for (const ch of needle) {
      const at = haystack.indexOf(ch, cursor);
      if (at < 0) return -1;
      streak = at === cursor ? streak + 1 : 0;
      score += streak;
      cursor = at + 1;
    }
    return score;
  }

  function rank(list, needle) {
    const available = list.filter((item) => !current.includes(item.id));
    if (!needle) return available;
    return available
      .map((item) => ({
        item,
        score: Math.max(subsequenceScore(item.name, needle), subsequenceScore(item.path, needle)),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }

  function addParent(id) {
    if (disabled || !id || current.includes(id)) return;
    input = "";
    activeIndex = 0;
    dispatch("change", { parentIds: [...current, id] });
  }

  function removeParent(id) {
    // 最後の親は外させない。孤児を作らないため（外したい場合は先に別の親を足す）。
    if (disabled || current.length <= 1) return;
    dispatch("change", { parentIds: current.filter((parentId) => parentId !== id) });
  }

  function handleKeydown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, visibleCandidates.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      const picked = visibleCandidates[activeIndex];
      if (picked) {
        event.preventDefault();
        addParent(picked.id);
      }
    } else if (event.key === "Escape" && input) {
      event.preventDefault();
      input = "";
    } else if (event.key === "Backspace" && input === "" && current.length > 1) {
      removeParent(current[current.length - 1]);
    }
  }
</script>

<div class="ParentField">
  <div class="Chips" class:Disabled={disabled}>
    {#each current as id (id)}
      <span class="Chip">
        <span class="ChipLabel">{nameById[id] ?? id}</span>
        <button
          type="button"
          class="ChipRemove"
          disabled={disabled || current.length <= 1}
          aria-label={current.length <= 1
            ? `${nameById[id] ?? id} は唯一の親なので外せません`
            : `親 ${nameById[id] ?? id} を外す`}
          title={current.length <= 1
            ? "唯一の親は外せません（先に別の親を足してください）"
            : "この親を外す"}
          on:click={() => removeParent(id)}>×</button
        >
      </span>
    {/each}
    <input
      class="Input"
      bind:this={inputElement}
      bind:value={input}
      {disabled}
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder={current.length === 0 ? "親を選択…" : "親を追加…"}
      aria-label="親ノードを追加"
      on:keydown={handleKeydown}
    />
  </div>

  {#if input && visibleCandidates.length > 0}
    <ul class="Suggestions" role="listbox" aria-label="親の候補">
      {#each visibleCandidates as candidate, index (candidate.id)}
        <li>
          <button
            type="button"
            class="Suggestion"
            class:Active={index === activeIndex}
            role="option"
            aria-selected={index === activeIndex}
            on:mouseenter={() => (activeIndex = index)}
            on:click={() => addParent(candidate.id)}
          >
            <span class="SuggestionName">{candidate.name}</span>
            {#if candidate.path}
              <span class="SuggestionPath">{candidate.path}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if input && visibleCandidates.length === 0}
    <div class="NoMatch">一致するノードがありません（自分自身と子孫は候補に出ません）</div>
  {/if}
</div>

<style>
  .ParentField {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .Chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp1);
    min-height: 1.6rem;
    padding: 2px var(--sp1);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 28%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
  }
  .Chips.Disabled {
    opacity: 0.6;
  }
  .Chips:focus-within {
    border-color: var(--theme-color-Primary-main);
    outline: 2px solid color-mix(in srgb, var(--theme-color-Primary-main) 30%, transparent);
    outline-offset: -1px;
  }
  .Chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 var(--sp1) 0 var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 45%, transparent);
    border-radius: var(--shape-pill);
    color: var(--theme-color-Primary-text);
    font-size: var(--font-label-sm);
    font-weight: 600;
    max-width: 100%;
  }
  .ChipLabel {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ChipRemove {
    border: none;
    background: transparent;
    color: inherit;
    padding: 0 2px;
    cursor: pointer;
    opacity: 0.65;
    font-size: var(--font-label-md);
    line-height: 1;
  }
  .ChipRemove:hover:not(:disabled) {
    opacity: 1;
  }
  .ChipRemove:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .Input {
    flex: 1 1 4rem;
    min-width: 4rem;
    border: none;
    outline: none;
    background: transparent;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    padding: 2px 0;
  }

  .Suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 40;
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
    max-height: 13rem;
    overflow-y: auto;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 20%, transparent);
    border-radius: var(--shape-sm);
    background-color: var(--theme-color-Main-light);
    box-shadow: var(--elevation-3);
  }
  .Suggestion {
    display: flex;
    align-items: baseline;
    gap: var(--sp2);
    width: 100%;
    padding: var(--sp1) var(--sp2);
    border: none;
    background: transparent;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    text-align: left;
    cursor: pointer;
  }
  .Suggestion.Active {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 16%, transparent);
  }
  .SuggestionName {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .SuggestionPath {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 60%, transparent);
    font-size: var(--font-label-sm);
  }
  .NoMatch {
    padding: var(--sp1) var(--sp2);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 60%, transparent);
    font-size: var(--font-label-sm);
  }
</style>
