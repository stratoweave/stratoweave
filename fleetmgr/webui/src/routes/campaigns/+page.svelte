<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';

  import AdminStatePill from '$lib/software/AdminStatePill.svelte';
  import CampaignProgress from '$lib/software/CampaignProgress.svelte';
  import { createPoller } from '$lib/core/polling/poller';
  import { FAST_ENTRY_LIMIT, fetchCounters } from '$lib/software/counters';
  import { planAlarmLines, type Campaign, type CampaignCounters } from '$lib/software/model';

  let {
    data
  }: { data: { campaigns: Campaign[]; loadError: string } } = $props();

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
        .filter((c) => c.adminState === 'run' && c.devices.length <= FAST_ENTRY_LIMIT)
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
    <h2>Upgrade campaigns</h2>
    <p>
      A campaign owns each of its devices exclusively, which is what stops
      two campaigns scheduling the same device. The planner fits the members
      into their schedules' windows; run releases devices through the
      controller as their windows open - a few at a time, growing as
      completions come in.
    </p>
  </div>
  <a class="btn btn-primary" href="/campaigns/new">New campaign</a>
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
    <div class="kpi-n tn" style:color="var(--sw-accent)">{kpis.inFlight.toLocaleString()}</div>
  </div>
  <div class="kpi" class:alert={kpis.failed > 0}>
    <div class="kick" class:alert-text={kpis.failed > 0}>Failed, needs an operator</div>
    <div class="kpi-n tn" class:alert-text={kpis.failed > 0}>{kpis.failed.toLocaleString()}</div>
  </div>
  <div class="kpi">
    <div class="kick">Devices in campaigns</div>
    <div class="kpi-n tn">{kpis.total.toLocaleString()}</div>
  </div>
</div>

<section class="card">
  {#if campaigns.length === 0}
    <div class="empty-state">No campaigns yet.</div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Target release</th>
            <th>admin-state</th>
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
              <td>
                <a class="campaign-name mono" href={`/campaigns/${encodeURIComponent(campaign.name)}`}>
                  {campaign.name}
                </a>
              </td>
              <td class="mono tn">{campaign.targetRelease}</td>
              <td>
                <AdminStatePill state={campaign.adminState} />
              </td>
              <td class="tn right">{campaign.devices.length.toLocaleString()}</td>
              <td class="plan-cell">
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
              <td class="state-col">
                {#if campaign.counters !== null}
                  <CampaignProgress counters={campaign.counters} compact={true} />
                {:else}
                  <span class="dim">—</span>
                {/if}
              </td>
              <td class="tn right">{campaign.counters?.succeeded.toLocaleString() ?? '—'}</td>
              <td class="tn right failed-cell">{campaign.counters?.failed.toLocaleString() ?? '—'}</td>
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
    border-radius: 8px;
    padding: 13px 16px;
    background: var(--sw-bg-elevated);
  }

  .kpi.alert {
    border-color: rgb(var(--sw-danger-rgb) / 0.3);
    background: rgb(var(--sw-danger-rgb) / 0.08);
  }

  .alert-text {
    color: var(--sw-danger);
  }

  .kpi-n {
    font-size: 30px;
    font-weight: 600;
    line-height: 1.15;
  }

  .card {
    margin-bottom: 16px;
  }

  .state-col {
    width: 290px;
  }

  .campaign-name {
    font-weight: 500;
    font-size: 12.5px;
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .campaign-name:hover {
    color: var(--sw-accent);
  }

  .dim {
    color: var(--sw-text-muted);
    font-size: 11.5px;
  }

  .plan-cell {
    white-space: nowrap;
  }

  .plan-cell .pill {
    margin-left: 8px;
  }

  .failed-cell {
    color: var(--sw-danger);
  }
</style>
