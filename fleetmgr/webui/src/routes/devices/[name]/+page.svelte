<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { invalidate } from '$app/navigation';

  import StatusPill from '$lib/software/StatusPill.svelte';
  import VerdictPill from '$lib/software/VerdictPill.svelte';
  import { createPoller } from '$lib/core/polling/poller';
  import { setDeviceSchedule } from '$lib/maintenance/binding';
  import { scheduleRulesText } from '$lib/maintenance/schedule-form';
  import type { Campaign, Device, Schedule } from '$lib/software/model';
  import { formatClock } from '$lib/software/time';

  let {
    data
  }: {
    data: {
      name: string;
      device: Device | null;
      campaigns: Campaign[];
      schedules: Schedule[];
      loadError: string;
    };
  } = $props();

  let statusMessage = $state<string>(untrack(() => data.loadError));

  // null follows the device as polled; a pick holds until it is saved.
  let picked = $state<string | null>(null);
  let savingSchedule = $state(false);
  let scheduleMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let bound = $derived(data.device?.schedule ?? '');
  let choice = $derived(picked ?? bound);
  let scheduleOptions = $derived.by(() => {
    const options = data.schedules.map((s) => ({ name: s.name, label: `${s.name} — ${scheduleRulesText(s)}` }));
    if (bound && !data.schedules.some((s) => s.name === bound)) {
      options.push({ name: bound, label: `${bound} (missing: placed in no window)` });
    }
    return options;
  });

  async function saveSchedule(): Promise<void> {
    if (!data.device || choice === bound) return;
    const schedule = choice;
    try {
      savingSchedule = true;
      scheduleMessage = null;
      await setDeviceSchedule(data.device.name, schedule);
      await invalidate('data:device');
      picked = null;
      scheduleMessage = { type: 'success', text: schedule ? `Bound to ${schedule}.` : 'Unbound.' };
    } catch (saveError) {
      scheduleMessage = {
        type: 'error',
        text: saveError instanceof Error ? saveError.message : 'Failed to save the schedule.'
      };
    } finally {
      savingSchedule = false;
    }
  }

  onMount(() => {
    const poller = createPoller(() => invalidate('data:device'), 5000);
    poller.start();
    return () => poller.stop();
  });

  function statusRow(campaign: Campaign) {
    return campaign.deviceStatus.find((r) => r.device === data.name) ?? null;
  }

  function campaignHref(campaign: Campaign): string {
    return `/campaigns/${encodeURIComponent(campaign.name)}`;
  }

  /** The planner's estimate for this device, or "not placed" when the plan
   * has the campaign but no window for it. */
  function plannedStart(campaign: Campaign): string {
    if (campaign.plan === null) return '—';
    for (const w of campaign.plan.windows) {
      const d = w.devices.find((x) => x.name === data.name);
      if (d) return formatClock(d.estimatedStart);
    }
    return campaign.plan.unplaced.includes(data.name) ? 'not placed' : '—';
  }
</script>

{#if statusMessage}
  <div class="error-state status">{statusMessage}</div>
{/if}

{#if data.device === null}
  <section class="card">
    <div class="empty-state">No device named {data.name}.</div>
  </section>
{:else}
  {@const device = data.device}
  <div class="page-header">
    <div>
      <div class="kick mono">/fleet/device={device.name}</div>
      <h2>{device.name}</h2>
      <p class="meta">
        type <span class="mono">{device.type}</span>
        {#if device.address}
          · OOB <span class="mono">{device.address}</span>
        {/if}
        {#if device.description}
          · {device.description}
        {/if}
        {#if device.schedule}
          · schedule <span class="mono">{device.schedule}</span>
        {/if}
      </p>
    </div>
  </div>

  <section class="card">
    <h3 class="panel-title">Maintenance schedule</h3>
    <div class="binding">
      <select
        class="select binding-select"
        aria-label="Maintenance schedule"
        value={choice}
        disabled={savingSchedule}
        onchange={(e) => (picked = e.currentTarget.value)}
      >
        <option value="">none — each campaign's default schedule</option>
        {#each scheduleOptions as option (option.name)}
          <option value={option.name}>{option.label}</option>
        {/each}
      </select>
      <button
        class="btn btn-primary"
        type="button"
        disabled={savingSchedule || choice === bound}
        onclick={saveSchedule}
      >
        {savingSchedule ? 'Saving…' : 'Save'}
      </button>
      {#if scheduleMessage}
        <span class={scheduleMessage.type === 'error' ? 'save-error' : 'save-ok'}>{scheduleMessage.text}</span>
      {/if}
    </div>
    <p class="hint">
      A bound device is placed only in its schedule's windows; without a binding each campaign's
      default schedule applies. Campaigns with this device re-plan on save. Windows are defined on
      the <a href="/schedules">schedules</a>.
    </p>
  </section>

  <section class="card">
    <h3 class="panel-title">Campaign membership</h3>
    {#if data.campaigns.length === 0}
      <div class="empty-state">Not a member of any campaign.</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Target release</th>
              <th>admin-state</th>
              <th>Planned start</th>
              <th>Status</th>
              <th>Pre-check</th>
              <th>Post-check</th>
              <th>Running release</th>
            </tr>
          </thead>
          <tbody>
            {#each data.campaigns as campaign (campaign.name)}
              {@const row = statusRow(campaign)}
              <tr>
                <td>
                  <a class="campaign-name mono" href={campaignHref(campaign)}>{campaign.name}</a>
                </td>
                <td class="mono tn">{campaign.targetRelease}</td>
                <td>
                  <span class="pill" class:pill-run={campaign.adminState === 'run'} class:muted={campaign.adminState === 'plan'}>
                    <span class="dot"></span>
                    {campaign.adminState}
                  </span>
                </td>
                <td class="mono tn">{plannedStart(campaign)}</td>
                <td>
                  {#if row}
                    <StatusPill status={row.status} raw={row.raw} />
                  {:else}
                    —
                  {/if}
                </td>
                <td>
                  {#if row}
                    <VerdictPill check={row.precheck} />
                  {:else}
                    —
                  {/if}
                </td>
                <td>
                  {#if row}
                    <VerdictPill check={row.postcheck} />
                  {:else}
                    —
                  {/if}
                </td>
                <td class="mono tn">{row?.runningRelease || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

<style>
  .status {
    margin-bottom: 12px;
  }

  .card {
    padding: 20px;
    margin-bottom: 16px;
  }

  .meta {
    margin: 4px 0 0;
    color: var(--sw-text-secondary);
    font-size: 13px;
  }

  .panel-title {
    margin: 0 0 12px;
    font-size: 14px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    text-align: left;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--sw-text-muted);
    padding: 9px 10px;
    border-bottom: 1px solid var(--sw-border-subtle);
    white-space: nowrap;
  }

  td {
    padding: 11px 10px;
    border-bottom: 1px solid var(--sw-border-subtle);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .campaign-name {
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .campaign-name:hover {
    color: var(--sw-accent);
  }

  .hint {
    margin: 14px 0 0;
    font-size: 12px;
    color: var(--sw-text-muted);
  }

  .hint a {
    color: var(--sw-accent-bright);
  }

  .binding {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .binding-select {
    width: min(100%, 420px);
  }

  .save-ok {
    font-size: 12px;
    color: var(--sw-text-secondary);
  }

  .save-error {
    font-size: 12px;
    color: var(--sw-danger);
  }

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
  }

  .tn {
    font-variant-numeric: tabular-nums;
  }
</style>
