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
  {#if text}
    <!-- The words say it, so a screen reader skips the dot. -->
    <span class="dot" aria-hidden="true"></span>
    <span class="text">{CONNECTION_TEXT[state]}</span>
  {:else}
    <span class="dot" role="img" aria-label={CONNECTION_TEXT[state]}></span>
  {/if}
</span>

<style>
  /* The words set the baseline, so they sit on the line of the text around
     them; the dot centres on them. */
  .connection {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }

  .dot {
    flex: none;
    align-self: center;
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
