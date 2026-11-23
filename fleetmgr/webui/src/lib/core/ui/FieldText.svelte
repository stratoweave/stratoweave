<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

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
    autocomplete?: HTMLInputAttributes['autocomplete'];
    /** Values the field suggests as it is typed in; any other is allowed. */
    suggestions?: string[];
    /** What the field does: a tooltip on its name and input, and its
     * description for a screen reader. */
    tooltip?: string;
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
    autocomplete,
    suggestions = [],
    tooltip = '',
    onchange,
    ontouch
  }: Props = $props();

  const uid = $props.id();
  let metaText = $derived(error || help || ' ');
  let describedBy = $derived(
    [error || help ? `${uid}-meta` : '', tooltip ? `${uid}-tip` : ''].filter(Boolean).join(' ') || undefined
  );
</script>

<!-- The label holds only the field's name; the help or error under the
     input describes it, so a screen reader reads it after the name. -->
<div class="field">
  <label class="field__label" for={`${uid}-input`} title={tooltip || (yangType ? `YANG type: ${yangType}` : undefined)}>
    {label}
    {#if required}
      <span class="field__required" aria-hidden="true">*</span>
    {/if}
  </label>
  <input
    id={`${uid}-input`}
    type={password ? 'password' : 'text'}
    class="input"
    class:mono
    class:has-error={!!error}
    aria-invalid={error ? 'true' : undefined}
    aria-required={required ? 'true' : undefined}
    aria-describedby={describedBy}
    title={tooltip || undefined}
    list={suggestions.length > 0 ? `${uid}-list` : undefined}
    {value}
    {placeholder}
    {disabled}
    {autocomplete}
    oninput={(event) => onchange?.((event.currentTarget as HTMLInputElement).value)}
    onblur={() => ontouch?.()}
  />
  {#if suggestions.length > 0}
    <datalist id={`${uid}-list`}>
      {#each suggestions as s (s)}<option value={s}></option>{/each}
    </datalist>
  {/if}
  <small id={`${uid}-meta`} class:field__meta--error={!!error} class="field__meta">{metaText}</small>
  {#if tooltip}<span id={`${uid}-tip`} class="sr-only">{tooltip}</span>{/if}
</div>
