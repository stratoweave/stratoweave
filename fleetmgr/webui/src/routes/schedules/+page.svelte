<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';

  import { onLoaded } from '#lib/core/loading.svelte.ts';
  import { takeNotice } from '#lib/core/notice.ts';
  import { createPoller } from '#lib/core/polling/poller.ts';
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import WeekCalendar from '#lib/maintenance/WeekCalendar.svelte';
  import { SCHEDULE_COLOR_OTHER, scheduleColors } from '#lib/maintenance/palette.ts';
  import { scheduleRulesText, scheduleUsage } from '#lib/maintenance/schedule-form.ts';
  import { formatUtcOffset } from '#lib/core/time.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  // null until their reads are in.
  let list = $state.raw<Awaited<typeof data.schedules> | null>(null);
  let usage = $state.raw<Awaited<typeof data.usage> | null>(null);
  onLoaded(() => data.schedules, (value) => (list = value));
  onLoaded(() => data.usage, (value) => (usage = value));
  let schedules = $derived(list?.schedules ?? []);
  // A failed read of the usage leaves its columns out rather than show
  // every schedule unused.
  let usageShown = $derived(!usage?.loadError);

  let now = $state(Date.now() / 1000);
  // What the editor that sent us here did. Shown once the status region is
  // in place, so that a screen reader reads it.
  const notice = takeNotice();
  let statusMessage = $state('');

  onMount(() => {
    if (notice) statusMessage = notice;
    // Schedules change rarely; the clock only has to move the marker.
    // Waits for the reads: loads return before them.
    const slow = createPoller(async () => {
      await invalidate('data:schedules');
      await Promise.all([data.schedules, data.usage]);
    }, 30000);
    const clock = setInterval(() => (now = Date.now() / 1000), 30000);
    slow.start();
    return () => {
      slow.stop();
      clearInterval(clock);
    };
  });

  let colors = $derived(scheduleColors(schedules.map((s) => s.name)));
  let rows = $derived(
    schedules.map((s) => ({
      schedule: s,
      color: colors.get(s.name) ?? SCHEDULE_COLOR_OTHER,
      usage: usage ? scheduleUsage(s.name, usage.devices, usage.campaigns) : null
    }))
  );

  function href(name: string): string {
    return `/schedules/${encodeURIComponent(name)}`;
  }
</script>

<div class="page-header">
  <div>
    <h1>Maintenance schedules</h1>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href="/schedules/new">New schedule</a>
  </div>
</div>

<!-- In place before any message, so that a screen reader reads each one. -->
<div role="status">
  {#if statusMessage}
    <div class="success-banner status">{statusMessage}</div>
  {/if}
</div>

{#if list?.loadError}
  <LoadError message={list.loadError} />
{:else}
  <section class="card">
    <div class="grids-head">
      <h2 class="panel-title">Next seven days</h2>
    </div>
    {#if list === null}
      <div class="empty-state" aria-busy="true">Loading schedules…</div>
    {:else if schedules.length === 0}
      <div class="empty-state">No schedules yet. Campaigns without one run through a single always-open window.</div>
    {:else}
      <WeekCalendar {schedules} {now} {colors} hrefFor={href} />
    {/if}
  </section>

  {#if schedules.length > 0}
    <section class="card">
      {#if usage?.loadError}
        <LoadError message={usage.loadError} />
      {/if}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Schedule</th>
              <th>UTC offset</th>
              <th>Windows</th>
              {#if usageShown}
                <th class="right">Bound devices</th>
                <th>Default for</th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.schedule.name)}
              <tr>
                <td>
                  <a class="schedule-name mono" href={href(row.schedule.name)}>
                    <span class="swatch" style:background={row.color}></span>
                    {row.schedule.name}
                  </a>
                </td>
                <td class="mono">UTC{formatUtcOffset(row.schedule.utcOffset)}</td>
                <td class="mono rules">{scheduleRulesText(row.schedule)}</td>
                {#if usageShown}
                  <td class="tn right">
                    {#if row.usage === null}
                      <span class="dim" aria-busy="true">…</span>
                    {:else if row.usage.boundDevices === 0}
                      <span class="dim">0</span>
                    {:else}
                      <a class="count-link" href={`/devices?schedule=${encodeURIComponent(row.schedule.name)}`}>
                        {row.usage.boundDevices.toLocaleString()}
                      </a>
                    {/if}
                  </td>
                  <td>
                    {#if row.usage === null}
                      <span class="dim" aria-busy="true">…</span>
                    {:else if row.usage.defaultOf.length === 0}
                      <span class="dim">—</span>
                    {:else}
                      {#each row.usage.defaultOf as campaign, i (campaign)}
                        {#if i > 0}<span class="dim">, </span>{/if}
                        <a class="campaign-name mono" href={`/campaigns/${encodeURIComponent(campaign)}`}>{campaign}</a>
                      {/each}
                    {/if}
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
{/if}

<style>
  .grids-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .panel-title {
    margin: 0;
    font-size: var(--sw-text-md);
  }

  .schedule-name,
  .campaign-name {
    color: var(--sw-accent-bright);
    text-decoration: none;
    font-weight: 500;
    font-size: var(--sw-text-sm);
  }

  .schedule-name:hover,
  .campaign-name:hover {
    color: var(--sw-accent);
  }

  .count-link {
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .count-link:hover {
    color: var(--sw-accent);
    text-decoration: underline;
  }

  .swatch {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: var(--sw-radius-xs);
    margin-right: 8px;
    vertical-align: middle;
  }

  .rules {
    color: var(--sw-text-secondary);
    font-size: var(--sw-text-xs);
  }

  .dim {
    color: var(--sw-text-muted);
  }
</style>
