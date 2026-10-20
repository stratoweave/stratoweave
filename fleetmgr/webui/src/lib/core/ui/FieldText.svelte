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
    /** Values the field suggests as it is typed in; any other is allowed. */
    suggestions?: string[];
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
    suggestions = [],
    onchange,
    ontouch
  }: Props = $props();

  const uid = $props.id();
  let metaText = $derived(error || help || ' ');
</script>

<label class="field">
  <span class="field__label" title={yangType ? `YANG type: ${yangType}` : undefined}>
    {label}
    {#if required}
      <span class="field__required" aria-hidden="true">*</span>
    {/if}
  </span>
  <input
    type={password ? 'password' : 'text'}
    class="input"
    class:mono
    class:has-error={!!error}
    aria-invalid={error ? 'true' : undefined}
    aria-required={required ? 'true' : undefined}
    aria-describedby={error || help ? `${uid}-meta` : undefined}
    list={suggestions.length > 0 ? `${uid}-list` : undefined}
    {value}
    {placeholder}
    {disabled}
    oninput={(event) => onchange?.((event.currentTarget as HTMLInputElement).value)}
    onblur={() => ontouch?.()}
  />
  {#if suggestions.length > 0}
    <datalist id={`${uid}-list`}>
      {#each suggestions as s (s)}<option value={s}></option>{/each}
    </datalist>
  {/if}
  <small id={`${uid}-meta`} class:field__meta--error={!!error} class="field__meta">{metaText}</small>
</label>
