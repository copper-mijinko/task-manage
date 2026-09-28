<script>
  import { rankCandidates } from "@features/tasks/utils/node_search";

  /**
   * ダイアログの中でノードを 1 つ選ぶ欄（移動先・コピー先）。
   *
   * 以前は全ノードを並べた <select> で、ノードが増えると目当てを探せなかった。
   * 親の追加（ParentField）と同じ絞り込みで、打つと候補が縮む。
   *
   * @typedef {Object} Props
   * @property {any} [candidates] - `{ id, name, path }` の配列。
   * @property {string} [value] - 選んでいるノードの id。
   * @property {string} [label] - 入力欄と候補一覧の名前。
   * @property {boolean} [disabled]
   * @property {number} [maxSuggestions]
   * @property {(detail: { id: string }) => void} [onchange]
   */

  /** @type {Props} */
  let {
    candidates = [],
    value = "",
    label = "ノードを検索",
    disabled = false,
    maxSuggestions = 50,
    onchange,
  } = $props();

  let input = $state("");
  let activeIndex = $state(0);
  let query = $derived(input.trim().toLowerCase());
  let visible = $derived(rankCandidates(candidates, query).slice(0, maxSuggestions));
  let selected = $derived(candidates.find((candidate) => candidate.id === value));
  $effect.pre(() => {
    if (visible.length <= activeIndex) activeIndex = 0;
  });

  function pick(id) {
    if (disabled) return;
    onchange?.({ id });
  }

  function handleKeydown(event) {
    if (event.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, visible.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter" && visible[activeIndex]) {
      event.preventDefault();
      pick(visible[activeIndex].id);
    }
  }
</script>

<div class="NodePicker">
  <input
    class="Input"
    type="text"
    bind:value={input}
    {disabled}
    autocomplete="off"
    spellcheck="false"
    placeholder="名前や経路で絞り込み…"
    aria-label={label}
    onkeydown={handleKeydown}
  />
  <ul class="Options" role="listbox" aria-label={`${label}の候補`}>
    {#each visible as candidate, index (candidate.id)}
      <li>
        <button
          type="button"
          class="Option"
          class:Active={index === activeIndex}
          class:Selected={candidate.id === value}
          role="option"
          aria-selected={candidate.id === value}
          {disabled}
          onmouseenter={() => (activeIndex = index)}
          onclick={() => pick(candidate.id)}
        >
          <span class="Name">{candidate.name || "（名前なし）"}</span>
          {#if candidate.path}<span class="Path">{candidate.path}</span>{/if}
        </button>
      </li>
    {:else}
      <li class="Empty">一致するノードがありません</li>
    {/each}
  </ul>
  <p class="Current" aria-live="polite">
    選択中: {selected ? selected.name || "（名前なし）" : "なし"}
  </p>
</div>

<style>
  .NodePicker {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
    min-width: 0;
  }
  .Input {
    height: var(--tap-min);
    padding: 0 var(--sp2);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-xs);
    background: transparent;
    color: var(--theme-color-Sub-main);
    font: inherit;
  }
  .Input:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -1px;
  }
  .Options {
    margin: 0;
    padding: var(--sp1) 0;
    list-style: none;
    max-height: 13.5rem;
    overflow-y: auto;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    border-radius: var(--shape-xs);
  }
  .Option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: var(--sp1) var(--sp2);
    border: 0;
    background: transparent;
    color: var(--theme-color-Sub-main);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .Option.Active {
    background: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
  }
  .Option.Selected {
    background: color-mix(in srgb, var(--theme-color-Primary-main) 24%, transparent);
  }
  .Name,
  .Path {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .Path {
    font-size: var(--font-label-sm);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
  }
  .Empty {
    padding: var(--sp1) var(--sp2);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 65%, transparent);
  }
  .Current {
    margin: 0;
    font-size: var(--font-label-sm);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 75%, transparent);
  }
</style>
