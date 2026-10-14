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
  <span class="field__label" title={yangType ? `YANG type: ${yangType}` : undefined}>
    {label}
    {#if required}
      <span class="field__required">*</span>
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
    color: var(--sw-danger-text);
    font-weight: 700;
    font-size: 14px;
    line-height: 1;
  }
</style>
