<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, invalidate } from '$app/navigation';

  import { errorText } from '$lib/core/errors';
  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import Pager, { paginate } from '$lib/core/ui/Pager.svelte';
  import AdminStatePill from '$lib/software/AdminStatePill.svelte';
  import CampaignProgress from '$lib/software/CampaignProgress.svelte';
  import DeviceStatusTable from '$lib/software/DeviceStatusTable.svelte';
  import PlanningFields from '$lib/software/PlanningFields.svelte';
  import PlanTimeline from '$lib/software/PlanTimeline.svelte';
  import { getListEntryPath, restconfDelete, restconfPatchJson } from '$lib/core/restconf/client';
  import { createPoller } from '$lib/core/polling/poller';
  import { FAST_ENTRY_LIMIT, fetchCampaign } from '$lib/software/counters';
  import {
    planningChanges,
    planningDraft,
    planningFromDraft,
    planInstallSeconds,
    planningOf,
    saveCampaignPlanning,
    validatePlanningDraft,
    type PlanningDraft
  } from '$lib/software/planning-form';
  import { RateTracker, formatEta } from '$lib/software/rate';
  import { nameMatcher } from '$lib/software/selection';
  import {
    CAMPAIGN_LIST_ROOT,
    DATA_ROOT,
    KNOWN_STATUSES,
    adminStatePatch,
    maskUrlCredentials,
    unplacedText,
    type Campaign,
    type Schedule,
    type KnownStatus
  } from '$lib/software/model';

  const PAGE_SIZE = 100;
  const FAILED_LIMIT = 200;

  let {
    data
  }: {
    data: { name: string; campaign: Campaign | null; schedules: Schedule[]; loadError: string };
  } = $props();

  let busy = $state(false);
  let actionError = $state('');
  let confirmAction = $state<'run' | 'plan' | 'delete' | null>(null);

  let devicesOpen = $state(false);
  let unplacedOpen = $state(false);
  let filterStatus = $state<KnownStatus | ''>('');
  let searchText = $state('');
  let page = $state(1);
  // Two tiers: a fresh entry every 1.5 s for campaigns up to
  // FAST_ENTRY_LIMIT members, so cells and counters move with the
  // controller; the loader snapshot refreshes on open, every 12 s, and
  // immediately when failed moves.
  let live = $state<Campaign | null>(null);
  let lastFailed = -1;

  /** Unix seconds, ticking, for the timeline's marker. */
  let now = $state(Date.now() / 1000);

  const tracker = new RateTracker();
  let rate = $state<number | null>(null);
  let eta = $state<number | null>(null);

  onMount(() => {
    const fast = createPoller(async () => {
      if ((data.campaign?.devices.length ?? 0) > FAST_ENTRY_LIMIT) {
        return;
      }
      try {
        const fresh = await fetchCampaign(data.name);
        live = fresh;
        const c = fresh?.counters ?? null;
        if (c !== null) {
          if (fresh?.adminState === 'run') {
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
        // keep the last entry; the slow tick recovers
      }
    }, 1500);
    const slow = createPoller(() => invalidate('data:campaign'), 12000);
    const clock = setInterval(() => (now = Date.now() / 1000), 1000);
    fast.start();
    slow.start();
    return () => {
      fast.stop();
      slow.stop();
      clearInterval(clock);
    };
  });

  /** The fresh entry when there is one for this campaign, else the snapshot. */
  let campaign = $derived(live !== null && live.name === data.name ? live : data.campaign);
  let counters = $derived(campaign?.counters ?? null);
  let statuses = $derived(
    new Map<string, KnownStatus>((campaign?.deviceStatus ?? []).map((r) => [r.device, r.status]))
  );

  // Schedule and pace: the fields follow the campaign until edited.
  let planningEdit = $state<PlanningDraft | null>(null);
  let planningSaving = $state(false);
  let planningMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let savedPlanning = $derived(campaign ? planningOf(campaign) : null);
  let savedDraft = $derived(savedPlanning ? planningDraft(savedPlanning) : null);
  let planningForm = $derived(planningEdit ?? savedDraft);
  let planningErrors = $derived(
    planningForm && savedDraft ? validatePlanningDraft(planningForm, Date.now() / 1000, savedDraft) : {}
  );
  // Compared with what is stored, not with the form as loaded: a campaign
  // with both a deadline and a target rate opens paced by the deadline and
  // can be saved as is, which sets its target rate to 0.
  let planningDirty = $derived.by(() => {
    if (!planningForm || !savedPlanning || Object.keys(planningErrors).length > 0) return false;
    const { set, remove } = planningChanges(savedPlanning, planningFromDraft(planningForm));
    return Object.keys(set).length > 0 || remove.length > 0;
  });
  let alsoTargetRate = $derived(
    planningForm?.paceBy === 'deadline' && savedPlanning?.deadline != null && savedPlanning.targetRate !== 0
      ? savedPlanning.targetRate
      : null
  );

  async function savePlanning(): Promise<void> {
    if (!planningForm || !savedPlanning) return;
    try {
      planningSaving = true;
      planningMessage = null;
      await saveCampaignPlanning(data.name, savedPlanning, planningFromDraft(planningForm));
      live = null;
      await invalidate('data:campaign');
      planningEdit = null;
      planningMessage = { type: 'success', text: 'Saved.' };
    } catch (saveError) {
      planningMessage = {
        type: 'error',
        text: errorText(saveError, 'Failed to save.')
      };
    } finally {
      planningSaving = false;
    }
  }

  let failedRows = $derived(
    (campaign?.deviceStatus ?? []).filter(
      (r) => r.status === 'failed' || r.status === 'rolled-back'
    )
  );

  let statusCounts = $derived.by(() => {
    const counts = new Map<KnownStatus, number>();
    for (const row of campaign?.deviceStatus ?? []) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return counts;
  });

  let filteredRows = $derived.by(() => {
    const matchName = nameMatcher(searchText.trim());
    return (campaign?.deviceStatus ?? []).filter(
      (r) => (!filterStatus || r.status === filterStatus) && matchName(r.device)
    );
  });
  let paged = $derived(paginate(filteredRows, page, PAGE_SIZE));

  // No "done" claim anywhere: status is not latched, it tracks live device
  // state and regresses when the campaign goes back to plan.
  let summary = $derived.by(() => {
    const c = campaign;
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
    const c = campaign;
    if (!c || !confirmAction) return '';
    if (confirmAction === 'run') {
      const unplaced = c.plan?.unplaced.length ?? 0;
      const placed = c.devices.length - unplaced;
      return (
        `Start upgrading ${placed} device(s) to ${c.targetRelease}? Devices are released a few at a time as their windows open and completions come in. Real installs reload devices and take several minutes.` +
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
      actionError = '';
      if (action === 'delete') {
        await restconfDelete(getListEntryPath(CAMPAIGN_LIST_ROOT, data.name));
        // Not a preload made before the delete.
        await goto('/campaigns', { invalidateAll: true });
        return;
      }
      await restconfPatchJson(DATA_ROOT, adminStatePatch(data.name, action));
      // The fresh entry predates the change; the snapshot leads until the
      // next fast tick.
      live = null;
      await invalidate('data:campaign');
    } catch (error) {
      actionError = errorText(error, 'The action failed.');
    } finally {
      busy = false;
    }
  }
</script>

{#if actionError || data.loadError}
  <div class="error-state status">{actionError || data.loadError}</div>
{/if}

{#if campaign === null}
  <section class="card">
    <div class="empty-state">No campaign named {data.name}.</div>
  </section>
{:else}
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
        <AdminStatePill state={campaign.adminState} />
      </div>
      <div class="fact">
        <span class="fact-label">Image URL</span>
        <span class="mono">{campaign.imageUrl ? maskUrlCredentials(campaign.imageUrl) : '—'}</span>
      </div>
    </div>
  </section>

  {#if planningForm}
    <section class="card">
      <h3 class="panel-title">Schedule and pace</h3>
      <PlanningFields
        schedules={data.schedules}
        draft={planningForm}
        errors={planningErrors}
        disabled={planningSaving}
        installSeconds={planInstallSeconds(campaign.plan)}
        onchange={(next) => {
          planningEdit = next;
          planningMessage = null;
        }}
      />
      <div class="planning-actions">
        {#if planningMessage}
          <span class={planningMessage.type === 'error' ? 'save-error' : 'save-ok'}>{planningMessage.text}</span>
        {:else if alsoTargetRate !== null}
          <span class="save-ok">Target rate {alsoTargetRate}/h also applies; saving sets it to 0.</span>
        {/if}
        <button
          class="btn btn-secondary"
          type="button"
          disabled={planningSaving || planningEdit === null}
          onclick={() => {
            planningEdit = null;
            planningMessage = null;
          }}
        >
          Reset
        </button>
        <button
          class="btn btn-primary"
          type="button"
          disabled={planningSaving || !planningDirty}
          onclick={savePlanning}
        >
          {planningSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  {/if}

  {#if campaign.plan !== null && (campaign.plan.windows.length > 0 || campaign.plan.alarms.length > 0 || campaign.plan.unplaced.length > 0)}
    {@const plan = campaign.plan}
    <section class="card">
      <div class="grids-head">
        <h3 class="panel-title">Plan</h3>
        <span class="hint">estimates in your local time</span>
      </div>
      {#if plan.alarms.length > 0 || plan.unplaced.length > 0}
        <ul class="alarms">
          {#each plan.alarms as alarm, i (i)}
            <li>{alarm}</li>
          {/each}
          {#if plan.unplaced.length > 0}
            <li class="unplaced-item">
              <button
                class="fold unplaced-fold"
                type="button"
                aria-expanded={unplacedOpen}
                onclick={() => (unplacedOpen = !unplacedOpen)}
              >
                {unplacedOpen ? '▾' : '▸'} {unplacedText(plan.unplaced.length)}
              </button>
              {#if unplacedOpen}
                <ul class="unplaced">
                  {#each plan.unplaced as name (name)}
                    <li><a class="mono" href={`/devices/${encodeURIComponent(name)}`}>{name}</a></li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/if}
        </ul>
      {/if}
      {#if plan.windows.length > 0}
        <PlanTimeline
          {plan}
          {statuses}
          {now}
          ondevice={(name) => goto(`/devices/${encodeURIComponent(name)}`)}
        />
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

  {#if failedRows.length > 0}
    <section class="card">
      <h3 class="panel-title">Failed ({failedRows.length})</h3>
      <DeviceStatusTable rows={failedRows.slice(0, FAILED_LIMIT)} />
      {#if failedRows.length > FAILED_LIMIT}
        <p class="rate">showing {FAILED_LIMIT} of {failedRows.length}</p>
      {/if}
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
        <DeviceStatusTable rows={paged.rows} />
        <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (page = p)} />
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

  .fact :global(.pill) {
    justify-self: start;
  }

  .planning-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .save-ok {
    font-size: 12px;
    color: var(--sw-text-secondary);
  }

  .save-error {
    font-size: 12px;
    color: var(--sw-danger);
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

  .alarms {
    margin: 0 0 12px;
    padding: 10px 14px 10px 30px;
    border-radius: var(--sw-radius-md);
    border: 1px solid rgb(var(--sw-warning-rgb) / 0.3);
    background: var(--sw-warning-dim);
    color: var(--sw-warning);
    font-size: 13px;
  }

  /* The fold arrow stands in for the bullet. */
  .unplaced-item {
    list-style: none;
  }

  .unplaced-fold {
    margin-left: -15px;
    color: inherit;
    font-size: inherit;
    font-weight: inherit;
    text-align: left;
  }

  .unplaced-fold:hover {
    text-decoration: underline;
  }

  .unplaced {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    max-height: 240px;
    overflow-y: auto;
    margin: 8px 0 2px;
    padding: 0;
    list-style: none;
  }

  .unplaced a {
    color: var(--sw-text-secondary);
    font-size: 12px;
    text-decoration: none;
  }

  .unplaced a:hover {
    color: var(--sw-accent-bright);
    text-decoration: underline;
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

  .btn-danger-ghost {
    color: var(--sw-danger);
  }
</style>
