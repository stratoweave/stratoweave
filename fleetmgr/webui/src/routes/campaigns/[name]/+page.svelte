<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto, invalidate } from '$app/navigation';

  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import CampaignProgress from '$lib/software/CampaignProgress.svelte';
  import CellGrid from '$lib/software/CellGrid.svelte';
  import StatusPill from '$lib/software/StatusPill.svelte';
  import { getListEntryPath, restconfDelete, restconfPatchJson } from '$lib/core/restconf/client';
  import { createPoller } from '$lib/core/polling/poller';
  import { FAST_ENTRY_LIMIT, fetchCounters } from '$lib/software/counters';
  import { RateTracker, formatEta } from '$lib/software/rate';
  import { formatClock, formatDuration } from '$lib/software/time';
  import { nameMatches } from '$lib/software/selection';
  import {
    CAMPAIGN_LIST_ROOT,
    DATA_ROOT,
    KNOWN_STATUSES,
    adminStatePatch,
    maskUrlCredentials,
    type Campaign,
    type CampaignCounters,
    type KnownStatus
  } from '$lib/software/model';

  const PAGE_SIZE = 100;
  const FAILED_LIMIT = 200;
  const PLAN_DEVICE_LIMIT = 200;

  let {
    data
  }: { data: { name: string; campaign: Campaign | null; loadError: string } } = $props();

  let busy = $state(false);
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(
    untrack(() => (data.loadError ? { type: 'error', text: data.loadError } : null))
  );
  let confirmAction = $state<'run' | 'plan' | 'delete' | null>(null);

  let devicesOpen = $state(false);
  let filterStatus = $state<KnownStatus | ''>('');
  let searchText = $state('');
  let page = $state(1);
  /** Plan window (by start) whose device list is unfolded. */
  let openWindow = $state<number | null>(null);

  // Two tiers: fresh counters every 1.5 s for campaigns up to
  // FAST_ENTRY_LIMIT members; the loader snapshot refreshes on open, every
  // 12 s, and immediately when failed moves.
  let liveCounters = $state<CampaignCounters | null>(null);
  let lastFailed = -1;

  const tracker = new RateTracker();
  let rate = $state<number | null>(null);
  let eta = $state<number | null>(null);

  onMount(() => {
    const fast = createPoller(async () => {
      if ((data.campaign?.devices.length ?? 0) > FAST_ENTRY_LIMIT) {
        return;
      }
      try {
        const c = await fetchCounters(data.name);
        liveCounters = c;
        if (c !== null) {
          if (data.campaign?.adminState === 'run') {
            tracker.push(c.succeeded + c.failed);
            rate = tracker.ratePerMin();
            const remaining = c.total - c.succeeded - c.failed;
            eta = remaining > 0 ? tracker.etaMs(remaining) : null;
          }
          if (lastFailed !== -1 && c.failed !== lastFailed) {
            void invalidate('data:campaign');
          }
          lastFailed = c.failed;
        }
      } catch {
        // keep the last counters; the slow tick recovers
      }
    }, 1500);
    const slow = createPoller(() => invalidate('data:campaign'), 12000);
    fast.start();
    slow.start();
    return () => {
      fast.stop();
      slow.stop();
    };
  });

  let counters = $derived(liveCounters ?? data.campaign?.counters ?? null);

  let windowsText = $derived.by(() => {
    const c = data.campaign;
    if (!c || c.windows.length === 0) return 'none — one window sized for the pace';
    return c.windows
      .map((w) => `${w.start === 0 ? 'at launch' : `+${formatDuration(w.start)}`} for ${formatDuration(w.duration)}`)
      .join(' · ');
  });

  let paceText = $derived.by(() => {
    const c = data.campaign;
    if (!c) return '';
    const target = c.targetRate === 0 ? 'no preference' : `${c.targetRate}/h`;
    const cap = c.maxRate === 0 ? 'no cap' : `${c.maxRate}/h`;
    return `target ${target} · max ${cap}`;
  });

  let failedRows = $derived(
    (data.campaign?.deviceStatus ?? []).filter(
      (r) => r.status === 'failed' || r.status === 'rolled-back'
    )
  );

  let statusCounts = $derived.by(() => {
    const counts = new Map<KnownStatus, number>();
    for (const row of data.campaign?.deviceStatus ?? []) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return counts;
  });

  let filteredRows = $derived(
    (data.campaign?.deviceStatus ?? []).filter(
      (r) =>
        (!filterStatus || r.status === filterStatus) &&
        nameMatches(r.device, searchText.trim())
    )
  );
  let pageCount = $derived(Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)));
  let currentPage = $derived(Math.min(page, pageCount));
  let visibleRows = $derived(
    filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  );

  // No "done" claim anywhere: status is not latched, it tracks live device
  // state and regresses when the campaign goes back to plan.
  let summary = $derived.by(() => {
    const c = data.campaign;
    if (!c) return '';
    if (c.adminState === 'plan') {
      const plan = c.plan;
      if (plan !== null && (plan.windows.length > 0 || plan.unplaced.length > 0)) {
        const placed = c.devices.length - plan.unplaced.length;
        const windows = `${plan.windows.length} window${plan.windows.length === 1 ? '' : 's'}`;
        const missing = plan.unplaced.length > 0 ? `, ${plan.unplaced.length} not placed` : '';
        return `Planned — inert until run. ${placed} of ${c.devices.length} placed in ${windows}${missing}.`;
      }
      return 'Planned — inert until run.';
    }
    if (counters === null) return 'Running — no state reported yet.';
    if (counters.inProgress > 0)
      return `Running — ${counters.inProgress} of ${counters.total} installing.`;
    if (counters.total > 0 && counters.remainder === 0)
      return `No work outstanding — ${counters.succeeded} succeeded, ${counters.failed} failed.`;
    return 'Running.';
  });

  const CONFIRMS = {
    run: {
      title: 'Run campaign',
      confirmLabel: 'Run',
      confirmClass: 'btn-primary'
    },
    plan: {
      title: 'Revert to plan',
      confirmLabel: 'Revert',
      confirmClass: 'btn-primary'
    },
    delete: {
      title: 'Delete campaign',
      confirmLabel: 'Delete',
      confirmClass: 'btn-danger'
    }
  } as const;

  let confirmMessage = $derived.by(() => {
    const c = data.campaign;
    if (!c || !confirmAction) return '';
    if (confirmAction === 'run') {
      const unplaced = c.plan?.unplaced.length ?? 0;
      const placed = c.devices.length - unplaced;
      return (
        `Start upgrading ${placed} device(s) to ${c.targetRelease}? Every placed device is actuated at once; real installs reload devices and take several minutes.` +
        (unplaced > 0 ? ` ${unplaced} device(s) do not fit the windows and are left alone.` : '')
      );
    }
    if (confirmAction === 'plan')
      return 'Withdraw the software targets? Device statuses revert to live state.';
    return `Delete campaign ${c.name}? Its targets are withdrawn from the devices.`;
  });

  async function handleConfirm(): Promise<void> {
    const action = confirmAction;
    confirmAction = null;
    if (!action) return;
    try {
      busy = true;
      statusMessage = null;
      if (action === 'delete') {
        await restconfDelete(getListEntryPath(CAMPAIGN_LIST_ROOT, data.name));
        await goto('/campaigns');
        return;
      }
      await restconfPatchJson(DATA_ROOT, adminStatePatch(data.name, action));
      await invalidate('data:campaign');
    } catch (actionError) {
      statusMessage = {
        type: 'error',
        text: actionError instanceof Error ? actionError.message : 'The action failed.'
      };
    } finally {
      busy = false;
    }
  }
</script>

{#if statusMessage}
  <div class={statusMessage.type === 'error' ? 'error-state status' : 'success-banner status'}>
    {statusMessage.text}
  </div>
{/if}

{#if data.campaign === null}
  <section class="card">
    <div class="empty-state">No campaign named {data.name}.</div>
  </section>
{:else}
  {@const campaign = data.campaign}
  <div class="page-header">
    <div>
      <h2>{campaign.name}</h2>
      <p class="summary">{summary}</p>
    </div>
    <div class="actions">
      {#if campaign.adminState === 'plan'}
        <button
          class="btn btn-primary"
          type="button"
          disabled={busy}
          onclick={() => (confirmAction = 'run')}
        >
          Run
        </button>
      {:else}
        <button
          class="btn btn-secondary"
          type="button"
          disabled={busy}
          onclick={() => (confirmAction = 'plan')}
        >
          Revert to plan
        </button>
      {/if}
      <button
        class="btn btn-secondary btn-danger-ghost"
        type="button"
        disabled={busy}
        onclick={() => (confirmAction = 'delete')}
      >
        Delete
      </button>
    </div>
  </div>

  <section class="card">
    <div class="facts">
      <div class="fact">
        <span class="fact-label">Target release</span>
        <span class="mono">{campaign.targetRelease}</span>
      </div>
      <div class="fact">
        <span class="fact-label">Admin state</span>
        <span class="pill" class:muted={campaign.adminState === 'plan'}>
          <span class="dot"></span>
          {campaign.adminState}
        </span>
      </div>
      <div class="fact">
        <span class="fact-label">Image URL</span>
        <span class="mono">{campaign.imageUrl ? maskUrlCredentials(campaign.imageUrl) : '—'}</span>
      </div>
      <div class="fact">
        <span class="fact-label">Windows</span>
        <span class="mono">{windowsText}</span>
      </div>
      <div class="fact">
        <span class="fact-label">Deadline</span>
        <span class="mono">
          {campaign.deadline === null ? '—' : `${formatDuration(campaign.deadline)} after launch`}
        </span>
      </div>
      <div class="fact">
        <span class="fact-label">Pace</span>
        <span class="mono">{paceText}</span>
      </div>
    </div>
  </section>

  {#if campaign.plan !== null && (campaign.plan.windows.length > 0 || campaign.plan.alarms.length > 0)}
    {@const plan = campaign.plan}
    <section class="card">
      <div class="grids-head">
        <h3 class="panel-title">Plan</h3>
        <span class="hint">
          estimates, re-anchored when the campaign starts running · run actuates every placed
          device at once
        </span>
      </div>
      {#if plan.alarms.length > 0}
        <ul class="alarms">
          {#each plan.alarms as alarm, i (i)}
            <li>{alarm}</li>
          {/each}
        </ul>
      {/if}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Window</th>
              <th>Opens</th>
              <th>Closes</th>
              <th class="right">Devices</th>
              <th>Estimated starts</th>
            </tr>
          </thead>
          <tbody>
            {#each plan.windows as w (w.start)}
              {@const first = w.devices[0]}
              {@const last = w.devices[w.devices.length - 1]}
              <tr>
                <td>
                  <button
                    class="fold small"
                    type="button"
                    onclick={() => (openWindow = openWindow === w.start ? null : w.start)}
                  >
                    {openWindow === w.start ? '▾' : '▸'} {w.schedule || 'window'}
                  </button>
                </td>
                <td class="mono tn">{formatClock(w.start)}</td>
                <td class="mono tn">{formatClock(w.end)}</td>
                <td class="tn right">{w.devices.length.toLocaleString()}</td>
                <td class="mono tn">
                  {#if first && last}
                    {formatClock(first.estimatedStart)}{w.devices.length > 1
                      ? ` … ${formatClock(last.estimatedStart)}`
                      : ''}
                  {:else}
                    —
                  {/if}
                </td>
              </tr>
              {#if openWindow === w.start}
                <tr>
                  <td colspan="5">
                    <div class="plan-devices">
                      {#each w.devices.slice(0, PLAN_DEVICE_LIMIT) as d (d.name)}
                        <span class="plan-device">
                          <span class="device-name">{d.name}</span>
                          <span class="mono tn dim">{formatClock(d.estimatedStart)}</span>
                        </span>
                      {/each}
                      {#if w.devices.length > PLAN_DEVICE_LIMIT}
                        <span class="dim">showing {PLAN_DEVICE_LIMIT} of {w.devices.length}</span>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      {#if plan.unplaced.length > 0}
        <p class="rate">
          not placed ({plan.unplaced.length}): {plan.unplaced.slice(0, 20).join(', ')}
          {plan.unplaced.length > 20 ? '…' : ''}
        </p>
      {/if}
    </section>
  {/if}

  {#if counters !== null}
    <section class="card">
      <CampaignProgress {counters} />
      {#if campaign.adminState === 'run'}
        <p class="rate">
          {#if rate !== null}
            ~{rate.toFixed(1)} settles/min{eta !== null ? ` · ETA ${formatEta(eta)}` : ''} —
            measured since page open
          {:else}
            rate appears once counters move
          {/if}
        </p>
      {/if}
    </section>
  {/if}

  {#if campaign.deviceStatus.length > 0}
    <section class="card">
      <div class="grids-head">
        <span class="kick">Every device — one cell per device</span>
        <span class="hint tn">{campaign.deviceStatus.length.toLocaleString()} cells · member order</span>
      </div>
      <CellGrid rows={campaign.deviceStatus} ondevice={(name) => goto(`/devices/${encodeURIComponent(name)}`)} />
    </section>
  {/if}

  {#if failedRows.length > 0}
    <section class="card">
      <h3 class="panel-title">Failed ({failedRows.length})</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>Running release</th>
            </tr>
          </thead>
          <tbody>
            {#each failedRows.slice(0, FAILED_LIMIT) as row (row.device)}
              <tr>
                <td><span class="device-name">{row.device}</span></td>
                <td><StatusPill status={row.status} raw={row.raw} /></td>
                <td class="mono">{row.runningRelease || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if failedRows.length > FAILED_LIMIT}
          <p class="rate">showing {FAILED_LIMIT} of {failedRows.length}</p>
        {/if}
      </div>
    </section>
  {/if}

  <section class="card">
    <button class="fold" type="button" onclick={() => (devicesOpen = !devicesOpen)}>
      {devicesOpen ? '▾' : '▸'} Devices ({campaign.deviceStatus.length})
    </button>
    {#if devicesOpen}
      {#if campaign.deviceStatus.length === 0}
        <div class="empty-state">The campaign has no member devices.</div>
      {:else}
        <div class="filter-row">
          <button
            class="chip"
            class:active={filterStatus === ''}
            type="button"
            onclick={() => {
              filterStatus = '';
              page = 1;
            }}
          >
            all {campaign.deviceStatus.length}
          </button>
          {#each KNOWN_STATUSES as status (status)}
            {#if statusCounts.get(status)}
              <button
                class="chip"
                class:active={filterStatus === status}
                type="button"
                onclick={() => {
                  filterStatus = status;
                  page = 1;
                }}
              >
                {status} {statusCounts.get(status)}
              </button>
            {/if}
          {/each}
          <input
            class="search mono"
            type="text"
            placeholder="find device (glob with * and ?)"
            bind:value={searchText}
            oninput={() => (page = 1)}
          />
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Status</th>
                <th>Running release</th>
              </tr>
            </thead>
            <tbody>
              {#each visibleRows as row (row.device)}
                <tr>
                  <td><span class="device-name">{row.device}</span></td>
                  <td><StatusPill status={row.status} raw={row.raw} /></td>
                  <td class="mono">{row.runningRelease || '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if pageCount > 1}
          <div class="pager">
            <button
              class="btn btn-secondary btn-small"
              type="button"
              disabled={currentPage <= 1}
              onclick={() => (page = currentPage - 1)}
            >
              ‹
            </button>
            <span>page {currentPage} / {pageCount}</span>
            <button
              class="btn btn-secondary btn-small"
              type="button"
              disabled={currentPage >= pageCount}
              onclick={() => (page = currentPage + 1)}
            >
              ›
            </button>
          </div>
        {/if}
      {/if}
    {/if}
  </section>
{/if}

<ConfirmDialog
  open={confirmAction !== null}
  title={confirmAction ? CONFIRMS[confirmAction].title : ''}
  message={confirmMessage}
  confirmLabel={confirmAction ? CONFIRMS[confirmAction].confirmLabel : ''}
  confirmClass={confirmAction ? CONFIRMS[confirmAction].confirmClass : 'btn-primary'}
  oncancel={() => (confirmAction = null)}
  onconfirm={handleConfirm}
/>

<style>
  .status {
    margin-bottom: 12px;
  }

  .success-banner {
    padding: 10px 14px;
    border-radius: var(--sw-radius-md);
    border: 1px solid rgb(var(--sw-accent-rgb) / 0.35);
    background: var(--sw-accent-glow);
    color: var(--sw-text-primary);
    font-size: 13px;
  }

  .summary {
    margin: 4px 0 0;
    color: var(--sw-text-secondary);
    font-size: 13px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .card {
    padding: 20px;
    margin-bottom: 16px;
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }

  .fact {
    display: grid;
    gap: 4px;
  }

  .fact-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sw-text-muted);
  }

  .rate {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--sw-text-muted);
  }

  .grids-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .hint {
    font-size: 12px;
    color: var(--sw-text-muted);
  }

  .panel-title {
    margin: 0 0 12px;
    font-size: 14px;
  }

  .fold {
    background: none;
    border: none;
    color: var(--sw-text-primary);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }

  .fold.small {
    font-size: 13px;
    font-weight: 500;
  }

  .alarms {
    margin: 0 0 12px;
    padding: 10px 14px 10px 30px;
    border-radius: var(--sw-radius-md);
    border: 1px solid rgb(var(--sw-warning-rgb) / 0.3);
    background: var(--sw-warning-dim);
    color: var(--sw-warning);
    font-size: 13px;
  }

  .plan-devices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    padding: 4px 0 4px 18px;
    font-size: 12px;
  }

  .plan-device {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
  }

  .dim {
    color: var(--sw-text-muted);
  }

  .filter-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }

  .chip {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--sw-border-default);
    color: var(--sw-text-secondary);
    background: var(--sw-bg-elevated);
    cursor: pointer;
  }

  .chip.active {
    color: var(--sw-accent);
    border-color: var(--sw-accent-glow-strong);
    background: var(--sw-accent-glow);
  }

  .search {
    margin-left: auto;
    padding: 5px 10px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    color: var(--sw-text-primary);
    font-size: 12px;
    outline: none;
  }

  .search:focus {
    border-color: var(--sw-accent);
  }

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    word-break: break-all;
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
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sw-text-muted);
    padding: 6px 10px;
    border-bottom: 1px solid var(--sw-border-default);
    white-space: nowrap;
  }

  td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--sw-border-default);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .device-name {
    font-weight: 600;
  }

  .pager {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 10px;
    font-size: 12px;
    color: var(--sw-text-secondary);
  }

  .btn-small {
    padding: 4px 10px;
    font-size: 12px;
  }

  .btn-danger-ghost {
    color: var(--sw-danger);
  }
</style>
