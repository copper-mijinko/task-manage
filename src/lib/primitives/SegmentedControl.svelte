<script lang="ts">
  import { createEventDispatcher } from "svelte";

  type SegmentOption = {
    value: string;
    label: string;
    ariaLabel?: string;
    disabled?: boolean;
    className?: string;
  };

  export let options: SegmentOption[] = [];
  export let value = "";
  export let disabled = false;
  export let ariaLabel = "Segmented control";
  export let size: "sm" | "md" = "sm";

  const dispatch = createEventDispatcher<{ change: { value: string } }>();

  function choose(option: SegmentOption) {
    if (disabled || option.disabled || option.value === value) {
      return;
    }
    dispatch("change", { value: option.value });
  }
</script>

<div
  class="SegmentedControl"
  class:sm={size === "sm"}
  class:md={size === "md"}
  role="group"
  aria-label={ariaLabel}
>
  {#each options as option (option.value)}
    <button
      type="button"
      class={`SegmentOption ${option.className ?? ""}`}
      class:active={option.value === value}
      aria-pressed={option.value === value}
      aria-label={option.ariaLabel ?? option.label}
      disabled={disabled || option.disabled}
      on:click={() => choose(option)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .SegmentedControl {
    display: inline-flex;
    align-items: stretch;
    flex: 0 0 auto;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 34%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
  }

  .SegmentOption {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--segment-min-width);
    height: var(--segment-height);
    padding: 0 var(--sp2);
    margin: 0;
    border: 0;
    border-radius: 0;
    background-color: transparent;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    line-height: 1;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  .SegmentOption + .SegmentOption {
    border-left: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 48%, transparent);
    box-shadow: inset 1px 0 0 color-mix(in srgb, var(--theme-color-Main-light) 65%, transparent);
  }

  .SegmentOption.active {
    background-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Main-light);
    cursor: default;
  }

  .SegmentOption:not(.active):hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 10%, transparent);
    color: var(--theme-color-Primary-main);
  }

  .SegmentOption:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
  }

  .SegmentOption:disabled {
    opacity: 0.58;
    cursor: not-allowed;
  }

  .SegmentedControl.sm {
    --segment-height: 1.8rem;
    --segment-min-width: 2.85rem;
  }

  .SegmentedControl.md {
    --segment-height: 1.9rem;
    --segment-min-width: 4.8rem;
  }
</style>
