<script lang="ts">
  // Whether a device also connects to its IOS XE CLI over SSH, as the
  // iosxe-cli extra adapter, and on which port.
  interface Props {
    cli: boolean;
    /** As typed; '' for the adapter's own, 22. */
    port: string;
    error?: string;
    help?: string;
    disabled?: boolean;
    onchange: (next: { cli: boolean; port: string }) => void;
  }

  let { cli, port, error = '', help = '', disabled = false, onchange }: Props = $props();

  const uid = $props.id();
  let metaText = $derived(error || help || '\u00a0');
</script>

<div class="field">
  <label class="field__label" for={`${uid}-cli`}>CLI over SSH</label>
  <div class="cli">
    <input
      id={`${uid}-cli`}
      type="checkbox"
      checked={cli}
      aria-describedby={error || help ? `${uid}-meta` : undefined}
      {disabled}
      onchange={(event) => onchange({ cli: event.currentTarget.checked, port })}
    />
    <label class="port-label" for={`${uid}-port`}>port</label>
    <input
      id={`${uid}-port`}
      class="input port"
      class:has-error={!!error}
      aria-label="CLI port"
      aria-invalid={error ? 'true' : undefined}
      placeholder="22"
      value={port}
      disabled={disabled || !cli}
      oninput={(event) => onchange({ cli, port: event.currentTarget.value })}
    />
  </div>
  <small id={`${uid}-meta`} class:field__meta--error={!!error} class="field__meta">{metaText}</small>
</div>

<style>
  .cli {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .port-label {
    font-size: var(--sw-text-sm);
    color: var(--sw-text-secondary);
  }

  /* Out to the edge of the field, as the inputs beside it. */
  .port {
    flex: 1;
    min-width: 0;
  }
</style>
