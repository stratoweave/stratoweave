<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';

  import LoadError from '#lib/core/ui/LoadError.svelte';
  import AdminStatePill from '#lib/software/AdminStatePill.svelte';
  import CampaignProgress from '#lib/software/CampaignProgress.svelte';
  import { createPoller, nextSeq } from '#lib/core/polling/poller.ts';
  import { withSignal } from '#lib/core/restconf/client.ts';
  import { formatClock } from '#lib/core/time.ts';
  import { fetchCounters } from '#lib/software/counters.ts';
  import type { Campaign, CampaignCounters } from '#lib/software/model.ts';
  import { progressOf } from '#lib/software/progress.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Discovery (config plus counters and alarms) reloads every 30 s; up to
  // six running campaigns, busy ones first, get fresh counters every tick. A live value shows only while it is newer than
  // the last load, so one that stopped being polled gives way to the reload.
  let live = $state.raw<Record<string, { seq: number; counters: CampaignCounters }>>({});

  let campaigns = $derived(
    data.campaigns.map((c) => {
      const l = live[c.name];
      return l !== undefined && l.seq > data.seq ? { ...c, counters: l.counters } : c;
    })
  );

  /** Devices in flight or still to go. */
  function busy(c: Campaign): boolean {
    return c.counters !== null && (c.counters.inProgress > 0 || c.counters.remainder > 0);
  }

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
    const aborter = new AbortController();
    const fast = createPoller(async () => {
      const running = campaigns
        .filter((c) => c.adminState === 'run' && c.counters !== null)
        .sort((a, b) => Number(busy(b)) - Number(busy(a)))
        .slice(0, 6)
        .map((c) => c.name);
      for (const name of running) {
        const seq = nextSeq();
        try {
          const counters = await fetchCounters(name, withSignal(aborter.signal));
          if (counters && !aborter.signal.aborted) live = { ...live, [name]: { seq, counters } };
        } catch {
          // the next tick or the reload catches up
        }
      }
    }, 2000);
    const slow = createPoller(() => invalidate('data:software'), 30000);
    fast.start();
    slow.start();
    return () => {
      fast.stop();
      slow.stop();
      aborter.abort();
    };
  });
</script>

<div class="page-header">
  <div>
    <h1>Upgrade campaigns</h1>
    {#if campaigns.length > 0}
      <p class="totals tn">
        {kpis.running} running · {kpis.inFlight.toLocaleString()} devices in flight ·
        <span class:alert-text={kpis.failed > 0}>{kpis.failed.toLocaleString()} failed</span> ·
        {kpis.total.toLocaleString()} devices in campaigns
      </p>
    {/if}
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href="/campaigns/new">New campaign</a>
  </div>
</div>

{#if data.loadError}
  <LoadError message={data.loadError} />
{:else}
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
              <th>Mode</th>
              <th>Devices</th>
              <th>Plan</th>
              <th class="state-col">State</th>
              <th>Upgraded</th>
              <th>Failed</th>
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
                <td data-label="Mode">
                  <AdminStatePill state={campaign.adminState} runSince={campaign.runSince} />
                </td>
                <td class="tn" data-label="Devices">{campaign.devices.length.toLocaleString()}</td>
                <td class="plan-cell" data-label="Plan">
                  {#if campaign.counters !== null}
                    {@const alarms = data.alarms[campaign.name] ?? []}
                    {@const completed = campaign.counters.completed}
                    {#if completed !== null}
                      <span
                        class="pill success"
                        title="Every device is done, and the campaign has freed them for other campaigns."
                      >
                        complete {formatClock(completed)}
                      </span>
                    {/if}
                    {#if alarms.length > 0}
                      {@const text = `${alarms.length} alarm${alarms.length === 1 ? '' : 's'}`}
                      <!-- The campaign's page lists the alarms. -->
                      <a
                        class="pill warning alarms"
                        href={`/campaigns/${encodeURIComponent(campaign.name)}`}
                        aria-label={`${text} in ${campaign.name}`}
                        title={alarms.join('\n')}
                      >
                        <span class="dot"></span>
                        {text}
                      </a>
                    {:else if completed === null}
                      <span class="dim">no alarms</span>
                    {/if}
                  {:else}
                    <span class="dim">—</span>
                  {/if}
                </td>
                <td class="state-col" data-label="State">
                  {#if campaign.counters !== null}
                    <CampaignProgress counters={campaign.counters} compact={true} />
                  {:else}
                    <span class="dim">—</span>
                  {/if}
                </td>
                <!-- Not the members up to date before the campaign: they count
                     as succeeded, but were never upgraded. -->
                <td class="tn" data-label="Upgraded">
                  {campaign.counters ? progressOf(campaign.counters, 0).upgraded.toLocaleString() : '—'}
                </td>
                <td class="tn" class:failed-cell={(campaign.counters?.failed ?? 0) > 0} data-label="Failed">
                  {campaign.counters?.failed.toLocaleString() ?? '—'}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

<style>
  .alert-text {
    color: var(--sw-danger-text);
    font-weight: 500;
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

  .alarms {
    text-decoration: none;
  }

  .alarms:hover {
    border-color: var(--sw-warning);
  }

  .failed-cell {
    color: var(--sw-danger-text);
    font-weight: 600;
  }

  .empty-state a {
    color: var(--sw-accent-bright);
  }

  @media (max-width: 720px) {
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
      font-size: var(--sw-text-xs);
      font-weight: 500;
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
