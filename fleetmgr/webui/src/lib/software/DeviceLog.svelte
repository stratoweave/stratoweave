<script lang="ts">
  // The log of a fleet device, and in its header the level the device
  // records at: its debug/log-level leaf, or without it the log.device.level
  // setting of its flotilla. A new level applies to what the device logs
  // from then on.
  import { onMount } from 'svelte';

  import { errorText } from '#lib/core/errors.ts';
  import { fetchDeviceLog, type LogPage, type LogQuery } from '#lib/core/log.ts';
  import {
    getListEntryPath,
    restconfGetOrNull,
    restconfPatchJson,
    rewriteListEntry
  } from '#lib/core/restconf/client.ts';
  import LogView from '#lib/core/ui/LogView.svelte';
  import { DATA_ROOT, FLEET_DEVICE_LIST_ROOT } from '#lib/software/model.ts';

  let { name }: { name: string } = $props();

  /** The values of the log-level leaf. */
  const LEAF_LEVELS = ['error', 'warning', 'info', 'debug', 'trace', 'off'];

  /** The leaf as configured, '' without it; null until read. */
  let configured = $state<string | null>(null);
  /** The level the device records at, as the last page told or a save set. */
  let recording = $state('');
  /** The level without the leaf, once a page showed it. */
  let fallback = $state('');
  let saving = $state(false);
  let failure = $state('');
  let picker = $state<HTMLSelectElement | null>(null);

  onMount(() => {
    void readLevel();
  });

  async function readLevel(): Promise<void> {
    try {
      const json = await restconfGetOrNull<Record<string, { 'log-level'?: string }>>(
        `${getListEntryPath(FLEET_DEVICE_LIST_ROOT, name)}/debug`
      );
      const value = Object.values(json ?? {})[0]?.['log-level'] ?? '';
      configured = LEAF_LEVELS.includes(value) ? value : '';
    } catch {
      configured = '';
    }
  }

  function load(query: LogQuery): Promise<LogPage> {
    return fetchDeviceLog(name, query);
  }

  function onPage(page: LogPage): void {
    // A save shows at once; the device applies it a moment later.
    if (!saving) recording = page.level;
    if (configured === '') fallback = page.level;
  }

  async function save(value: string): Promise<void> {
    saving = true;
    failure = '';
    try {
      if (value) {
        await restconfPatchJson(DATA_ROOT, {
          'fleetmgr:fleet': { device: [{ name, debug: { 'log-level': value } }] }
        });
      } else {
        await rewriteListEntry(FLEET_DEVICE_LIST_ROOT, name, (entry) => {
          const debug = entry.debug as Record<string, unknown> | undefined;
          if (debug?.['log-level'] === undefined) return null;
          const rest = { ...debug };
          delete rest['log-level'];
          return { ...entry, debug: rest };
        });
      }
      configured = value;
      recording = value || fallback || recording;
    } catch (saveError) {
      failure = errorText(saveError, 'The log level could not be set.');
      // The picker shows what the device has, not the pick that failed.
      if (picker) picker.value = configured ?? '';
    } finally {
      saving = false;
    }
  }
</script>

<section class="card">
  <div class="head">
    <h2 class="panel-title" title="Read from the device's log file on its flotilla">Log</h2>
    <span class="rec" class:off={recording === 'off'} class:saving>
      <svg class="rec-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <circle class="rec-ring" cx="7" cy="7" r="6" />
        <circle class="rec-dot" cx="7" cy="7" r="3.25" />
      </svg>
      <select
        bind:this={picker}
        class="select compact"
        class:has-error={failure !== ''}
        aria-label="Device log level"
        title={failure || 'Device log level'}
        value={configured ?? ''}
        disabled={configured === null || saving}
        onchange={(e) => save(e.currentTarget.value)}
      >
        <option value="">{fallback ? `${fallback} (default)` : 'default'}</option>
        {#each LEAF_LEVELS as level (level)}
          <option value={level}>{level}</option>
        {/each}
      </select>
    </span>
    <span class="sr-only" role="status">{failure}</span>
  </div>

  <LogView {load} onpage={onPage} logsAt={recording || undefined} />
</section>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }

  .head .panel-title {
    margin: 0;
  }

  .rec {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .rec-icon {
    position: absolute;
    left: 10px;
    pointer-events: none;
  }

  .rec-ring {
    fill: none;
    stroke: var(--sw-text-muted);
    stroke-width: 1.5;
  }

  .rec-dot {
    fill: var(--sw-danger);
    transition: opacity var(--sw-dur-base) var(--sw-ease);
  }

  .rec.off .rec-dot {
    opacity: 0;
  }

  .rec.saving .rec-dot {
    animation: rec-busy 0.9s var(--sw-ease) infinite alternate;
  }

  @keyframes rec-busy {
    to {
      opacity: 0.25;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rec.saving .rec-dot {
      animation: none;
      opacity: 0.5;
    }
  }

  .rec .select {
    width: 11rem;
    padding-left: 32px;
  }

  /* Busy, not unavailable: the control stays readable while it saves. */
  .rec.saving .select:disabled {
    opacity: 1;
    cursor: progress;
  }
</style>
