<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';

  import { createPoller } from '$lib/core/polling/poller';
  import WeekCalendar from '$lib/maintenance/WeekCalendar.svelte';
  import { SCHEDULE_COLOR_OTHER, scheduleColors } from '$lib/maintenance/palette';
  import { scheduleRulesText, scheduleUsage } from '$lib/maintenance/schedule-form';
  import type { Campaign, Device, Schedule } from '$lib/software/model';
  import { formatUtcOffset } from '$lib/core/time';

  let {
    data
  }: { data: { schedules: Schedule[]; devices: Device[]; campaigns: Campaign[]; loadError: string } } = $props();

  let now = $state(Date.now() / 1000);

  onMount(() => {
    // Schedules change rarely; the clock only has to move the marker.
    const slow = createPoller(() => invalidate('data:schedules'), 30000);
    const clock = setInterval(() => (now = Date.now() / 1000), 30000);
    slow.start();
    return () => {
      slow.stop();
      clearInterval(clock);
    };
  });

  let colors = $derived(scheduleColors(data.schedules.map((s) => s.name)));
  let rows = $derived(
    data.schedules.map((s) => ({
      schedule: s,
      color: colors.get(s.name) ?? SCHEDULE_COLOR_OTHER,
      usage: scheduleUsage(s.name, data.devices, data.campaigns)
    }))
  );

  function href(name: string): string {
    return `/schedules/${encodeURIComponent(name)}`;
  }
</script>

<div class="page-header">
  <div>
    <h2>Maintenance schedules</h2>
  </div>
  <a class="btn btn-primary" href="/schedules/new">New schedule</a>
</div>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

<section class="card">
  <div class="grids-head">
    <h3 class="panel-title">Next seven days</h3>
    <span class="hint">every schedule's windows in your local time · click one to edit its schedule</span>
  </div>
  {#if data.schedules.length === 0}
    <div class="empty-state">No schedules yet. Campaigns without one run through a single always-open window.</div>
  {:else}
    <WeekCalendar schedules={data.schedules} {now} {colors} hrefFor={href} />
  {/if}
</section>

{#if data.schedules.length > 0}
  <section class="card">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Schedule</th>
            <th>Local time zone</th>
            <th>Windows</th>
            <th class="right">Bound devices</th>
            <th>Default of</th>
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
              <td class="tn right">
                {#if row.usage.boundDevices === 0}
                  <span class="dim">0</span>
                {:else}
                  <a class="count-link" href={`/devices?schedule=${encodeURIComponent(row.schedule.name)}`}>
                    {row.usage.boundDevices.toLocaleString()}
                  </a>
                {/if}
              </td>
              <td>
                {#if row.usage.defaultOf.length === 0}
                  <span class="dim">—</span>
                {:else}
                  {#each row.usage.defaultOf as campaign, i (campaign)}
                    {#if i > 0}<span class="dim">, </span>{/if}
                    <a class="campaign-name mono" href={`/campaigns/${encodeURIComponent(campaign)}`}>{campaign}</a>
                  {/each}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

<style>
  .card {
    margin-bottom: 16px;
  }

  .grids-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .panel-title {
    margin: 0;
    font-size: 14px;
  }

  .hint {
    font-size: 12px;
    color: var(--sw-text-muted);
  }

  .schedule-name,
  .campaign-name {
    color: var(--sw-accent-bright);
    text-decoration: none;
    font-weight: 500;
    font-size: 12.5px;
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
    border-radius: 2px;
    margin-right: 8px;
    vertical-align: middle;
  }

  .rules {
    color: var(--sw-text-secondary);
    font-size: 12px;
  }

  .dim {
    color: var(--sw-text-muted);
  }
</style>
