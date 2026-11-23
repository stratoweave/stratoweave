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

  const uid = $props.id();
  let metaText = $derived(error || help || '\u00A0');
</script>

<!-- The label holds only the field's name; the help or error under the
     select describes it. -->
<div class="field">
  <label class="field__label" for={`${uid}-select`}>{label}</label>
  <select
    id={`${uid}-select`}
    class="select"
    class:has-error={!!error}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error || help ? `${uid}-meta` : undefined}
    {value}
    {disabled}
    onchange={(event) => onchange?.(event.currentTarget.value)}
  >
    {#each options as option (option.value)}
      <option value={option.value} disabled={option.disabled}>{option.label}</option>
    {/each}
  </select>
  <small id={`${uid}-meta`} class:field__meta--error={!!error} class="field__meta">{metaText}</small>
</div>

<style>
  .select {
    width: 100%;
  }
</style>
