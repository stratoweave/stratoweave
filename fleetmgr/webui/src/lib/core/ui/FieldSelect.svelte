<script lang="ts" module>
  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  interface Props {
    label?: string;
    value?: string;
    options: SelectOption[];
    error?: string;
    help?: string;
    disabled?: boolean;
    onchange?: (next: string) => void;
  }

  let { label = '', value = '', options, error = '', help = '', disabled = false, onchange }: Props = $props();

  let metaText = $derived(error || help || '\u00A0');
</script>

<label class="field">
  <span class="field__label">{label}</span>
  <select
    class="select"
    class:has-error={!!error}
    aria-invalid={error ? 'true' : undefined}
    {value}
    {disabled}
    onchange={(event) => onchange?.(event.currentTarget.value)}
  >
    {#each options as option (option.value)}
      <option value={option.value} disabled={option.disabled}>{option.label}</option>
    {/each}
  </select>
  <small class:field__meta--error={!!error} class="field__meta">{metaText}</small>
</label>

<style>
  .field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .field__label {
    font-size: 12px;
    font-weight: 500;
    color: var(--sw-text-label);
  }

  .select {
    width: 100%;
  }

  .field__meta {
    min-height: 1rem;
    font-size: 11px;
    color: var(--sw-text-muted);
  }

  .field__meta--error {
    color: var(--sw-danger);
  }
</style>
