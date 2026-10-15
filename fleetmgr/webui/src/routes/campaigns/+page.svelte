<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';

  import AdminStatePill from '$lib/software/AdminStatePill.svelte';
  import CampaignProgress from '$lib/software/CampaignProgress.svelte';
  import { createPoller } from '$lib/core/polling/poller';
  import { fetchCounters } from '$lib/software/counters';
  import { planAlarmLines, type Campaign, type CampaignCounters } from '$lib/software/model';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Discovery (full campaign entries) refreshes slowly; running campaigns
  // get fresh counters from cheap entry GETs.
  let live = $state<Record<string, CampaignCounters>>({});

  let campaigns = $derived(
    data.campaigns.map((c) => (live[c.name] ? { ...c, counters: live[c.name] } : c))
  );

  let kpis = $derived.by(() => {
    let running = 0;
    let inFlight = 0;
    let failed = 0;
    let total = 0;
    for (const c of campaigns) {
      if (c.adminState === 'run') running += 1;
      if (c.counters) {
        inFlight += c.counters.inProgress;
        failed += c.counters.failed;
        total += c.counters.total;
      } else {
        total += c.devices.length;
      }
    }
    return { running, inFlight, failed, total };
  });

  onMount(() => {
    const fast = createPoller(async () => {
      const running = data.campaigns
        .filter((c) => c.adminState === 'run' && c.counters !== null)
        .map((c) => c.name)
        .slice(0, 6);
      for (const name of running) {
        try {
          const counters = await fetchCounters(name);
          if (counters) live = { ...live, [name]: counters };
        } catch {
          // slow tick recovers
        }
      }
    }, 2000);
    const slow = createPoller(() => invalidate('data:software'), 30000);
    fast.start();
    slow.start();
    return () => {
      fast.stop();
      slow.stop();
    };
  });
</script>

<div class="page-header">
  <div>
    <h1>Upgrade campaigns</h1>
    <p>
      Each campaign upgrades its own devices to a target release, a few at a
      time, as their maintenance schedules open.
    </p>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href="/campaigns/new">New campaign</a>
  </div>
</div>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

<div class="kpis">
  <div class="kpi">
    <div class="kick">Running campaigns</div>
    <div class="kpi-n tn">{kpis.running}</div>
  </div>
  <div class="kpi">
    <div class="kick">Devices in flight</div>
    <div class="kpi-n tn" class:progress-text={kpis.inFlight > 0}>{kpis.inFlight.toLocaleString()}</div>
  </div>
  <div class="kpi" class:alert={kpis.failed > 0}>
    <div class="kick">Failed, needs an operator</div>
    <div class="kpi-n tn" class:alert-text={kpis.failed > 0}>{kpis.failed.toLocaleString()}</div>
  </div>
  <div class="kpi">
    <div class="kick">Devices in campaigns</div>
    <div class="kpi-n tn">{kpis.total.toLocaleString()}</div>
  </div>
</div>

<section class="card">
  {#if campaigns.length === 0}
    <div class="empty-state">
      No campaigns yet. <a href="/campaigns/new">Create one</a> to plan an upgrade; nothing
      changes on the devices until you run it.
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Target release</th>
            <th>Mode</th>
            <th class="right">Devices</th>
            <th>Plan</th>
            <th class="state-col">State</th>
            <th class="right">Succeeded</th>
            <th class="right">Failed</th>
          </tr>
        </thead>
        <tbody>
          {#each campaigns as campaign (campaign.name)}
            <tr>
              <td class="name-cell">
                <a class="campaign-name mono" href={`/campaigns/${encodeURIComponent(campaign.name)}`}>
                  {campaign.name}
                </a>
              </td>
              <td class="mono tn" data-label="Target release">{campaign.targetRelease}</td>
              <td data-label="Mode">
                <AdminStatePill state={campaign.adminState} />
              </td>
              <td class="tn right" data-label="Devices">{campaign.devices.length.toLocaleString()}</td>
              <td class="plan-cell" data-label="Plan">
                {#if campaign.plan !== null && campaign.plan.windows.length > 0}
                  <span class="dim">
                    {campaign.plan.windows.length} window{campaign.plan.windows.length === 1 ? '' : 's'}
                  </span>
                {:else}
                  <span class="dim">—</span>
                {/if}
                {#if campaign.plan !== null}
                  {@const alarms = planAlarmLines(campaign.plan)}
                  {#if alarms.length > 0}
                    <span class="pill warning" title={alarms.join('\n')}>
                      <span class="dot"></span>
                      {alarms.length} alarm{alarms.length === 1 ? '' : 's'}
                    </span>
                  {/if}
                {/if}
              </td>
              <td class="state-col" data-label="State">
                {#if campaign.counters !== null}
                  <CampaignProgress counters={campaign.counters} compact={true} />
                {:else}
                  <span class="dim">—</span>
                {/if}
              </td>
              <td class="tn right" data-label="Succeeded">{campaign.counters?.succeeded.toLocaleString() ?? '—'}</td>
              <td class="tn right" class:failed-cell={(campaign.counters?.failed ?? 0) > 0} data-label="Failed">
                {campaign.counters?.failed.toLocaleString() ?? '—'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  .kpi {
    border: 1px solid var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    padding: 12px 16px;
    background: var(--sw-bg-elevated);
  }

  .kpi.alert {
    border-color: rgb(var(--sw-danger-rgb) / 0.4);
    background: rgb(var(--sw-danger-rgb) / 0.1);
  }

  .alert-text {
    color: var(--sw-danger-text);
  }

  .progress-text {
    color: var(--sw-accent);
  }

  .kpi-n {
    font-size: var(--sw-text-3xl);
    font-weight: 600;
    line-height: 1.15;
  }

  .state-col {
    width: 290px;
  }

  .campaign-name {
    font-weight: 500;
    font-size: var(--sw-text-sm);
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .campaign-name:hover {
    color: var(--sw-accent);
  }

  .dim {
    color: var(--sw-text-muted);
    font-size: var(--sw-text-xs);
  }

  .plan-cell {
    white-space: nowrap;
  }

  .plan-cell .pill {
    margin-left: 8px;
  }

  .failed-cell {
    color: var(--sw-danger-text);
    font-weight: 600;
  }

  .empty-state a {
    color: var(--sw-accent-bright);
  }

  @media (max-width: 720px) {
    .kpis {
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .kpi {
      padding: 10px 12px;
    }

    .kpi-n {
      font-size: var(--sw-text-2xl);
    }

    /* Each campaign becomes a block of labelled lines. */
    table,
    tbody,
    tr,
    td {
      display: block;
    }

    thead {
      display: none;
    }

    tr + tr {
      border-top: 1px solid var(--sw-border-subtle);
    }

    td {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      justify-content: flex-end;
      padding: 6px 0;
      border: none;
      text-align: right;
    }

    td[data-label]::before {
      content: attr(data-label);
      margin-right: auto;
      font-size: var(--sw-text-2xs);
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--sw-text-muted);
      text-align: left;
    }

    /* The campaign's name heads its block. */
    .name-cell {
      justify-content: flex-start;
      padding: 4px 0 8px;
      text-align: left;
    }

    .name-cell .campaign-name {
      font-size: var(--sw-text-lg);
      font-weight: 600;
    }

    .state-col {
      width: auto;
    }

    .state-col :global(.progress) {
      flex: 1;
      max-width: 60%;
    }

    tbody tr:hover td {
      background: none;
    }
  }
</style>
