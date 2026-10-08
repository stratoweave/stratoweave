<script lang="ts">
  // A local date and time as `datetime-local` text (2026-10-05T14:30), or
  // '' for none.

  interface Props {
    label?: string;
    value?: string;
    /** Earliest pickable value, same format. */
    min?: string;
    error?: string;
    help?: string;
    disabled?: boolean;
    onchange?: (next: string) => void;
  }

  let { label = '', value = '', min, error = '', help = '', disabled = false, onchange }: Props = $props();

  let metaText = $derived(error || help || '\u00A0');
</script>

<label class="field">
  <span class="field__label">{label}</span>
  <input
    type="datetime-local"
    class:empty={!value}
    class:has-error={!!error}
    aria-invalid={error ? 'true' : undefined}
    {value}
    {min}
    {disabled}
    oninput={(event) => onchange?.(event.currentTarget.value)}
  />
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

  input {
    width: 100%;
    padding: 9px 12px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    color: var(--sw-text-primary);
    font-family: var(--sw-font-mono);
    font-size: 12px;
    line-height: 1.5;
    outline: none;
    transition: border-color var(--sw-dur-fast), box-shadow var(--sw-dur-fast);
  }

  input:hover:not(:disabled) {
    border-color: var(--sw-text-muted);
  }

  input:focus {
    border-color: var(--sw-accent);
    box-shadow: 0 0 0 3px var(--sw-accent-glow);
  }

  input.has-error {
    border-color: var(--sw-danger);
    box-shadow: 0 0 0 3px var(--sw-danger-dim);
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* The empty mask (dd/mm/yyyy, --:--) reads as a placeholder. */
  input.empty::-webkit-datetime-edit {
    color: var(--sw-text-muted);
  }

  input::-webkit-datetime-edit-text {
    color: var(--sw-text-muted);
    padding: 0 2px;
  }

  input::-webkit-datetime-edit-day-field:focus,
  input::-webkit-datetime-edit-month-field:focus,
  input::-webkit-datetime-edit-year-field:focus,
  input::-webkit-datetime-edit-hour-field:focus,
  input::-webkit-datetime-edit-minute-field:focus,
  input::-webkit-datetime-edit-ampm-field:focus {
    background: var(--sw-accent-glow-strong);
    color: var(--sw-text-primary);
    border-radius: 3px;
  }

  input::-webkit-calendar-picker-indicator {
    width: 14px;
    height: 14px;
    margin-left: 6px;
    padding: 2px;
    border-radius: 4px;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16' fill='none' stroke='%237d8cac' stroke-width='1.5' stroke-linecap='round'%3E%3Crect x='2' y='3' width='12' height='11' rx='2'/%3E%3Cpath d='M2 6.5h12M5.5 1.5v3M10.5 1.5v3'/%3E%3C/svg%3E") center / 14px 14px no-repeat;
    opacity: 1;
    cursor: pointer;
  }

  input::-webkit-calendar-picker-indicator:hover {
    background-color: var(--sw-bg-hover);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16' fill='none' stroke='%2322d3ee' stroke-width='1.5' stroke-linecap='round'%3E%3Crect x='2' y='3' width='12' height='11' rx='2'/%3E%3Cpath d='M2 6.5h12M5.5 1.5v3M10.5 1.5v3'/%3E%3C/svg%3E");
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
