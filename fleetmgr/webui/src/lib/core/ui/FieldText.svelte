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
    onchange,
    ontouch
  }: Props = $props();

  let metaText = $derived(error || help || '\u00A0');
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
    class="input"
    class:mono
    class:has-error={!!error}
    aria-invalid={error ? 'true' : undefined}
    {value}
    {placeholder}
    {disabled}
    oninput={(event) => onchange?.((event.currentTarget as HTMLInputElement).value)}
    onblur={() => ontouch?.()}
  />
  <small class:field__meta--error={!!error} class="field__meta">{metaText}</small>
</label>

<style>
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
</style>
