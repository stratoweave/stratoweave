<script lang="ts">
  import { CONNECTION_TEXT, CONNECTION_TONE, connectionState } from '#lib/software/device-state.ts';
  import type { Connection } from '#lib/software/model.ts';

  interface Props {
    connection: Connection | null;
    /** Say it in words next to the dot, not only in its tooltip. */
    text?: boolean;
  }

  let { connection, text = false }: Props = $props();
  let state = $derived(connectionState(connection));
</script>

<span class="connection {CONNECTION_TONE[state]}" title={CONNECTION_TEXT[state]}>
  <span class="dot" role="img" aria-label={text ? undefined : CONNECTION_TEXT[state]}></span>
  {#if text}<span class="text">{CONNECTION_TEXT[state]}</span>{/if}
</span>

<style>
  .connection {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  /* Never connected: a ring, so it does not read as a state of its own. */
  .muted .dot {
    background: none;
    border: 1.5px solid currentColor;
  }

  .success {
    color: var(--sw-success);
  }

  .danger {
    color: var(--sw-danger-text);
  }

  .warning {
    color: var(--sw-warning);
  }

  .muted {
    color: var(--sw-text-muted);
  }

  .text {
    color: inherit;
  }
</style>
