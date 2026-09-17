<script lang="ts">
  interface Props {
    label?: string;
    value?: string;
    placeholder?: string;
    error?: string;
    help?: string;
    yangType?: string;
    required?: boolean;
    disabled?: boolean;
    mono?: boolean;
    /** Render as a password input: the value round-trips through the draft
     * but is never displayed as text. */
    password?: boolean;
    validationKey?: number;
    onchange?: (next: string) => void;
    ontouch?: () => void;
  }

  let {
    label = '',
    value = '',
    placeholder = '',
    error = '',
    help = '',
    yangType = '',
    required = false,
    disabled = false,
    mono = false,
    password = false,
    validationKey = 0,
    onchange,
    ontouch
  }: Props = $props();

  let touched = $state(false);

  $effect(() => {
    // Reset touched whenever validationKey bumps.
    validationKey;
    touched = false;
  });

  let visibleError = $derived(touched ? error : '');
  let metaText = $derived(visibleError || help || '\u00A0');
</script>

<label class="field">
  <span class="field__label">
    {label}
    {#if required}
      <span class="field__required">*</span>
    {/if}
    {#if yangType}
      <span class="field__yang-type">{yangType}</span>
    {/if}
  </span>
  <input
    type={password ? 'password' : 'text'}
    class:mono
    class:has-error={!!visibleError}
    aria-invalid={visibleError ? 'true' : undefined}
    {value}
    {placeholder}
    {disabled}
    oninput={(event) => onchange?.((event.currentTarget as HTMLInputElement).value)}
    onblur={() => {
      touched = true;
      ontouch?.();
    }}
  />
  <small class:field__meta--error={!!visibleError} class="field__meta">{metaText}</small>
</label>

<style>
  .field {
    display: grid;
    gap: 6px;
  }

  .field__label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--sw-text-label);
  }

  .field__required {
    color: var(--sw-danger);
    font-weight: 700;
    font-size: 14px;
    line-height: 1;
  }

  .field__yang-type {
    margin-left: auto;
    font-family: var(--sw-font-mono);
    font-size: 10px;
    color: var(--sw-text-muted);
    background: var(--sw-bg-deep);
    padding: 1px 6px;
    border-radius: 3px;
  }

  input {
    width: 100%;
    padding: 9px 12px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    color: var(--sw-text-primary);
    font-size: 13px;
    transition: border-color 0.15s, box-shadow 0.15s;
    outline: none;
  }

  input::placeholder {
    color: var(--sw-text-muted);
  }

  input:focus {
    border-color: var(--sw-accent);
    box-shadow: 0 0 0 3px var(--sw-accent-glow);
  }

  input.has-error {
    border-color: var(--sw-danger);
    box-shadow: 0 0 0 3px var(--sw-danger-dim);
  }

  input.mono {
    font-family: var(--sw-font-mono);
    font-size: 12px;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
