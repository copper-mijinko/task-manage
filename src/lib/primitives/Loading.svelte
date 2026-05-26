<script lang="ts">
  export let variant: "h1" | "h2" | "note" = "h1";
  export let text: string = "Loading...";
</script>

{#if variant === "h1"}
  <h1 class="loading loading-h1">{text}</h1>
{:else if variant === "h2"}
  <h2 class="loading loading-h2">{text}</h2>
{:else}
  <p class="loading loading-note">{text}</p>
{/if}

<style>
  .loading {
    animation: loading-pulse 1.4s ease-in-out infinite;
  }
  .loading-h1,
  .loading-h2 {
    color: var(--theme-color-Sub-main);
    display: flex;
    justify-content: center;
  }
  .loading-note {
    color: var(--theme-color-Sub-dark);
    font-size: var(--font-body-sm);
  }
  @keyframes loading-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .loading {
      animation: none;
    }
  }
</style>
