<script lang="ts">
  // The log of a fleet device, and in its header the level the device
  // records at. The device's settings set that level; it applies to what the
  // device logs from then on.
  import { fetchDeviceLog, type LogPage, type LogQuery } from '#lib/core/log.ts';
  import LogView from '#lib/core/ui/LogView.svelte';

  let { name }: { name: string } = $props();

  const uid = $props.id();
  /** The level the device records at, as the last page told. */
  let recording = $state('');

  function load(query: LogQuery): Promise<LogPage> {
    return fetchDeviceLog(name, query);
  }
</script>

<section class="card" aria-labelledby={`${uid}-title`}>
  <div class="head">
    <h2 id={`${uid}-title`} class="panel-title" title="Read from the device's log file on its flotilla">Log</h2>
    {#if recording}
      <span class="rec" class:off={recording === 'off'} title="Device log level, set in the device's settings">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <circle class="rec-ring" cx="7" cy="7" r="6" />
          <circle class="rec-dot" cx="7" cy="7" r="3.25" />
        </svg>
        <span class="sr-only">Device log level:</span>
        {recording[0].toUpperCase() + recording.slice(1)}
      </span>
    {/if}
  </div>

  <LogView {load} onpage={(page) => (recording = page.level)} logsAt={recording || undefined} />
</section>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sw-space-4);
    margin-bottom: var(--sw-space-3);
  }

  .head .panel-title {
    margin: 0;
  }

  .rec {
    display: inline-flex;
    align-items: center;
    gap: var(--sw-space-2);
    color: var(--sw-text-secondary);
    font-size: var(--sw-text-sm);
  }

  .rec-ring {
    fill: none;
    stroke: var(--sw-text-muted);
    stroke-width: 1.5;
  }

  .rec-dot {
    fill: var(--sw-danger);
  }

  .rec.off .rec-dot {
    opacity: 0;
  }
</style>
