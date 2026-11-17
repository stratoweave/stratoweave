<script lang="ts">
  // A field that picks one small text file, such as a private key, and
  // hands over its name and text. The text is never shown.
  interface TextFile {
    name: string;
    text: string;
  }

  interface Props {
    label?: string;
    /** null for none. */
    value?: TextFile | null;
    error?: string;
    help?: string;
    disabled?: boolean;
    /** A bigger file comes with no text. */
    maxBytes?: number;
    onchange?: (next: TextFile | null) => void;
  }

  let { label = '', value = null, error = '', help = '', disabled = false, maxBytes = 65536, onchange }: Props = $props();

  const uid = $props.id();
  let input: HTMLInputElement | null = $state(null);
  let metaText = $derived(error || help || '\u00a0');

  async function chosen(): Promise<void> {
    const file = input?.files?.[0];
    // Cleared so that choosing the same file again fires change again.
    if (input) input.value = '';
    if (!file) return;
    onchange?.({ name: file.name, text: file.size > maxBytes ? '' : await file.text() });
  }
</script>

<div class="field">
  <span class="field__label" id={`${uid}-label`}>{label}</span>
  <!-- A box like the text inputs beside it, with the file name for its
       value. A click opens the file chooser. -->
  <div class="file">
    <button
      class="input file-box"
      class:empty={!value}
      class:clearable={!!value}
      class:has-error={!!error}
      type="button"
      id={`${uid}-choose`}
      aria-labelledby={`${uid}-label ${uid}-choose`}
      aria-describedby={error || help ? `${uid}-meta` : undefined}
      title={value?.name}
      {disabled}
      onclick={() => input?.click()}
    >
      {value ? value.name : 'Choose file…'}
    </button>
    {#if value}
      <button class="clear" type="button" aria-label={`Clear ${label}`} {disabled} onclick={() => onchange?.(null)}>
        ×
      </button>
    {/if}
  </div>
  <input bind:this={input} class="file-input" type="file" tabindex="-1" aria-hidden="true" onchange={chosen} />
  <small id={`${uid}-meta`} class:field__meta--error={!!error} class="field__meta">{metaText}</small>
</div>

<style>
  .file {
    position: relative;
    min-width: 0;
  }

  .file-box {
    display: block;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  /* Firefox puts an inner border in a button, which makes it taller. */
  .file-box::-moz-focus-inner {
    border: 0;
    padding: 0;
  }

  .file-box.empty {
    color: var(--sw-text-muted);
  }

  /* Room for the clear button. */
  .file-box.clearable {
    padding-right: 36px;
  }

  .clear {
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
    padding: 3px 7px;
    background: none;
    border: none;
    border-radius: var(--sw-radius-sm);
    color: var(--sw-text-secondary);
    font: inherit;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }

  .clear:hover:not(:disabled) {
    background: var(--sw-bg-hover);
    color: var(--sw-text-primary);
  }

  .file-input {
    display: none;
  }
</style>
