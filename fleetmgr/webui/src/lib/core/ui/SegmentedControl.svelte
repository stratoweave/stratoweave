<script lang="ts" generics="T extends string | number">
  let {
    options,
    value,
    label,
    ariaLabel,
    onchange
  }: {
    options: { value: T; label: string; disabled?: boolean }[];
    value: T;
    label?: string;
    ariaLabel?: string;
    onchange: (value: T) => void;
  } = $props();
</script>

{#snippet buttons()}
  <div class="segmented" role="group" aria-label={ariaLabel ?? label}>
    {#each options as option}
      <button
        class:active={value === option.value}
        aria-pressed={value === option.value}
        type="button"
        disabled={option.disabled}
        onclick={() => onchange(option.value)}
      >{option.label}</button>
    {/each}
  </div>
{/snippet}

{#if label}
  <div class="segmented-group">
    <span class="segmented-group__label">{label}</span>
    {@render buttons()}
  </div>
{:else}
  {@render buttons()}
{/if}

<style>
  .segmented-group {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .segmented-group__label {
    color: var(--sw-text-muted);
    font-size: 12px;
    font-weight: 600;
  }

  .segmented {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-deep);
  }

  .segmented button {
    padding: 7px 14px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sw-text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .segmented button:hover:not(:disabled) {
    color: var(--sw-text-primary);
  }

  .segmented button.active {
    background: var(--sw-bg-elevated);
    color: var(--sw-accent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  .segmented button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
