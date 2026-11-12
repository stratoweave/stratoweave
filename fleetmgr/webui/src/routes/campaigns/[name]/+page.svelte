<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { onLoaded } from '#lib/core/loading.svelte.ts';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import Pager, { paginate } from '#lib/core/ui/Pager.svelte';
  import CampaignGroups from '#lib/software/CampaignGroups.svelte';
  import CampaignProgress from '#lib/software/CampaignProgress.svelte';
  import DeviceStatusTable from '#lib/software/DeviceStatusTable.svelte';
  import PlanningFields from '#lib/software/PlanningFields.svelte';
  import PlanTimeline from '#lib/software/PlanTimeline.svelte';
  import { getListEntryPath, restconfDelete, restconfPatchJson } from '#lib/core/restconf/client.ts';
  import { createPoller } from '#lib/core/polling/poller.ts';
  import { CampaignLive, FAST_MS, type LiveView } from '#lib/software/campaign-live.ts';
  import {
    planningChanges,
    planningDraft,
    planningFromDraft,
    planInstallSeconds,
    planningOf,
    saveCampaignPlanning,
    validatePlanningDraft,
    type PlanningDraft
  } from '#lib/software/planning-form.ts';
  import { formatEta } from '#lib/software/rate.ts';
  import { formatClock } from '#lib/core/time.ts';
  import { imageCounts } from '#lib/software/campaign-images.ts';
  import { HELD_KINDS, HELD_KIND_LABEL, heldCounts, heldKind, type HeldKind } from '#lib/software/device-state.ts';
  import { nameMatcher } from '#lib/software/selection.ts';
  import { alreadyOnTarget } from '#lib/software/stages.ts';
  import {
    CAMPAIGN_LIST_ROOT,
    DATA_ROOT,
    KNOWN_STATUSES,
    STATUS_LABEL,
    adminStatePatch,
    joinState,
    type CampaignPlan,
    type DeviceStatusRow,
    type KnownStatus,
    type Schedule
  } from '#lib/software/model.ts';
  import type { PageProps } from './$types';

  const PAGE_SIZE = 100;
  const FAILED_LIMIT = 200;

  let { data }: PageProps = $props();

  let busy = $state(false);
  let actionError = $state('');
  let confirmAction = $state<'run' | 'plan' | 'delete' | null>(null);

  // Each load starts with the failed devices open and the pace and the
  // devices folded.
  let failedOpen = $state(true);
  let devicesOpen = $state(false);
  let paceOpen = $state(false);
  let onTargetOpen = $state(false);
  /** The devices table's filter: '' for all, one status or held kind, or
   * the members in no window. */
  type RowFilter = '' | `status:${KnownStatus}` | `held:${HeldKind}` | 'unplaced';
  let filter = $state<RowFilter>('');
  let searchText = $state('');
  let page = $state(1);

  // Schedule and pace: the fields follow the campaign until edited.
  let planningEdit = $state<PlanningDraft | null>(null);
  let planningSaving = $state(false);
  let planningMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

  /** Unix seconds, ticking, for the timeline's marker. */
  let now = $state(Date.now() / 1000);

  // The loader's snapshot kept fresh by polling; campaign-live.ts decides
  // what to read and which answers still count.
  let view = $state.raw<LiveView | null>(null);
  const live = new CampaignLive((v) => (view = v));

  // Every load goes through it when its entry is in: open, navigation and
  // Refresh. The error is the one of the load last applied.
  let applied = $state.raw({ seq: 0, loadError: '' });
  onLoaded(
    () => {
      const { name, seq, entry } = data;
      return entry.then((e) => ({ name, seq, ...e }));
    },
    (e) => {
      applied = { seq: e.seq, loadError: e.loadError };
      live.load(e.name, e.seq, e.config, e.state);
    }
  );
  let schedules = $state.raw<Schedule[]>([]);
  onLoaded(() => data.schedules, (value) => (schedules = value));

  // Another campaign starts over, its form and filters too.
  let shownName: string | null = null;
  $effect.pre(() => {
    if (data.name !== shownName) {
      shownName = data.name;
      actionError = '';
      confirmAction = null;
      failedOpen = true;
      devicesOpen = false;
      paceOpen = false;
      onTargetOpen = false;
      filter = '';
      searchText = '';
      page = 1;
      planningEdit = null;
      planningMessage = null;
    }
  });

  onMount(() => {
    const poller = createPoller(() => live.tick(), FAST_MS);
    const clock = setInterval(() => (now = Date.now() / 1000), 1000);
    poller.start();
    return () => {
      poller.stop();
      clearInterval(clock);
      live.dispose();
    };
  });

  let shown = $derived(view !== null && view.name === data.name ? view : null);
  /** undefined while unknown (the load failed), null when there is no such campaign. */
  let config = $derived(shown?.config);
  let parts = $derived(shown?.state ?? null);
  let campaign = $derived(config ? { ...config, ...joinState(parts, config.devices) } : null);
  let counters = $derived(shown?.counters ?? null);
  let rate = $derived(shown?.rate ?? null);
  let eta = $derived(shown?.eta ?? null);
  // A failed load stops showing once a later read got through.
  let loadError = $derived((shown?.seq ?? 0) > applied.seq ? '' : applied.loadError);
  let rowsByName = $derived(
    new Map<string, DeviceStatusRow>((campaign?.deviceStatus ?? []).map((r) => [r.device, r]))
  );
  let held = $derived(heldCounts(campaign?.deviceStatus ?? []));

  // Members that ran the target already take no cell in the timeline: they
  // have nothing to install, and are listed under the plan instead.
  let onTarget = $derived(
    (campaign?.deviceStatus ?? [])
      .filter(alreadyOnTarget)
      .map((r) => r.device)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  );
  let timelinePlan = $derived.by((): CampaignPlan | null => {
    const plan = campaign?.plan ?? null;
    if (plan === null || onTarget.length === 0) return plan;
    const skip = new Set(onTarget);
    const windows = plan.windows
      .map((w) => ({ ...w, devices: w.devices.filter((d) => !skip.has(d.name)) }))
      .filter((w) => w.devices.length > 0);
    return { ...plan, windows };
  });

  // The failure budget in whole devices, rounded down as the campaign
  // rounds it: 0.5 percent of 1000 members is 5.
  let budget = $derived.by(() => {
    const percent = campaign?.failureBudget ?? null;
    if (percent === null || counters === null) return null;
    const allowed = Math.floor((counters.total * Math.round(percent * 100)) / 10000);
    return { percent, allowed, failed: counters.failed, over: counters.failed > allowed };
  });

  /** When the first window the campaign may use opens at the earliest:
   * its notification period after it first ran, or after now before. */
  let noticeFrom = $derived(
    campaign && campaign.notificationPeriod > 0
      ? (campaign.runSince ?? now) + campaign.notificationPeriod * 86400
      : null
  );

  let savedPlanning = $derived(campaign ? planningOf(campaign) : null);
  let savedDraft = $derived(savedPlanning ? planningDraft(savedPlanning) : null);
  let planningForm = $derived(planningEdit ?? savedDraft);
  let planningErrors = $derived(
    planningForm && savedDraft ? validatePlanningDraft(planningForm, Date.now() / 1000, savedDraft) : {}
  );
  // Compared with what is stored, not with the form as loaded: a campaign
  // with a deadline and a target-concurrency other than 1 opens paced by
  // the deadline and can be saved as is, which sets it to 1.
  let planningDirty = $derived.by(() => {
    if (!planningForm || !savedPlanning || Object.keys(planningErrors).length > 0) return false;
    const { set, remove } = planningChanges(savedPlanning, planningFromDraft(planningForm));
    return Object.keys(set).length > 0 || remove.length > 0;
  });
  let alsoTargetConcurrency = $derived(
    planningForm?.paceBy === 'deadline' && savedPlanning?.deadline != null && savedPlanning.targetConcurrency !== 1
      ? savedPlanning.targetConcurrency
      : null
  );

  async function savePlanning(): Promise<void> {
    if (!planningForm || !savedPlanning) return;
    try {
      planningSaving = true;
      planningMessage = null;
      await saveCampaignPlanning(data.name, savedPlanning, planningFromDraft(planningForm));
      live.wrote();
      await live.reload();
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

  /** The groups card took a member out of a group: the campaign plans again. */
  function groupsWrote(): void {
    live.wrote();
    void live.reload();
  }

  let failedRows = $derived(
    (campaign?.deviceStatus ?? []).filter(
      (r) => r.status === 'failed' || r.status === 'rolled-back' || r.status === 'not-started'
    )
  );

  let statusCounts = $derived.by(() => {
    const counts = new Map<KnownStatus, number>();
    for (const row of campaign?.deviceStatus ?? []) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return counts;
  });

  let unplacedSet = $derived(new Set(campaign?.plan?.unplaced ?? []));

  function passes(r: DeviceStatusRow, f: RowFilter): boolean {
    if (f === '') return true;
    if (f === 'unplaced') return unplacedSet.has(r.device);
    if (f.startsWith('status:')) return `status:${r.status}` === f;
    return r.held !== null && `held:${heldKind(r.held)}` === f;
  }

  let filteredRows = $derived.by(() => {
    const matchName = nameMatcher(searchText.trim());
    return (campaign?.deviceStatus ?? []).filter((r) => passes(r, filter) && matchName(r.device));
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
        const missing = plan.unplaced.length > 0 ? `, ${plan.unplaced.length} in no window yet` : '';
        return `Planned — ${placed} of ${c.devices.length} placed in ${windows}${missing}.`;
      }
      return 'Planned.';
    }
    if (counters === null) return 'Running — no state reported yet.';
    if (counters.inProgress > 0)
      return `Running — ${counters.inProgress} of ${counters.total} installing.`;
    if (counters.total > 0 && counters.remainder === 0) {
      const upgraded = counters.succeeded - counters.upToDate;
      const already = counters.upToDate > 0 ? `, ${counters.upToDate} already up to date` : '';
      return `No work outstanding — ${upgraded} upgraded${already}, ${counters.failed} failed.`;
    }
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
      confirmClass: 'btn-danger'
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
      const skip = new Set([...(c.plan?.unplaced ?? []), ...onTarget]);
      const placed = c.devices.filter((d) => !skip.has(d)).length;
      const first = c.plan?.windows.find((w) => w.end === null || w.end > Date.now() / 1000);
      const opens =
        first && first.start > Date.now() / 1000
          ? ` The first window${first.schedule ? `, ${first.schedule},` : ''} opens at ${formatClock(first.start)}.`
          : '';
      return (
        `Start upgrading ${placed} device(s) to their images? Devices are released a few at a time as their windows open and completions come in. Real installs reload devices and take several minutes.` +
        opens +
        (onTarget.length > 0 ? ` ${onTarget.length} device(s) already run their target and need nothing.` : '') +
        (unplaced > 0 ? ` ${unplaced} device(s) are in no window yet and do not start.` : '')
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
        live.dispose();
        // Not a preload made before the delete.
        await goto('/campaigns', { refreshAll: true });
        return;
      }
      await restconfPatchJson(DATA_ROOT, adminStatePatch(data.name, action));
      // Reads still in flight may predate the change; the reload shows it.
      live.wrote();
      await live.reload();
    } catch (error) {
      actionError = errorText(error, 'The action failed.');
    } finally {
      busy = false;
    }
  }
</script>

{#if actionError || loadError}
  <div class="error-state status">{actionError || loadError}</div>
{/if}

{#if shown === null}
  <div class="page-header">
    <div>
      <h1>{data.name}</h1>
      <p class="summary">Loading…</p>
    </div>
  </div>
  <section class="card" aria-busy="true">
    <div class="placeholder-plan">Loading the campaign…</div>
  </section>
{:else if campaign === null}
  {#if config === null}
    <section class="card">
      <div class="empty-state">No campaign named {data.name}.</div>
    </section>
  {/if}
{:else}
  <div class="page-header">
    <div>
      <h1>{campaign.name}</h1>
      <p class="summary">{summary}</p>
      {#if campaign.runSince !== null || noticeFrom !== null}
        <p class="since">
          {#if campaign.runSince !== null}
            First ran {formatClock(campaign.runSince)}.
          {/if}
          {#if noticeFrom !== null}
            {campaign.notificationPeriod} day{campaign.notificationPeriod === 1 ? '' : 's'} of notice: it uses
            windows from {formatClock(noticeFrom)}{campaign.runSince === null ? ', counted from now until it runs' : ''}.
          {/if}
        </p>
      {/if}
    </div>
    <div class="page-actions">
      <button
        class="btn btn-secondary btn-danger-ghost"
        type="button"
        disabled={busy}
        onclick={() => (confirmAction = 'delete')}
      >
        Delete
      </button>
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
    </div>
  </div>

  {#if campaign.images.length > 0}
    <!-- The full width under the header, so a few images fit one line. -->
    <div class="image-pills" aria-label="Images">
      {#each imageCounts(campaign.images) as [image, n] (image)}
        <span class="pill image-pill">
          <span class="mono">{image || 'no image'}</span>
          <span class="n tn">{n.toLocaleString()}</span>
        </span>
      {/each}
    </div>
  {/if}

  {#if counters !== null}
    <section class="card status-card" aria-label="Progress">
      <CampaignProgress {counters} notAnswered={held.byKind.get('not-answered') ?? 0} />
      {#if held.byKind.size > 0 || budget !== null}
        <div class="held-foot">
          {#if held.byKind.size > 0}
            <p>
              <span class="foot-label">Held</span>
              {#each HELD_KINDS.filter((k) => held.byKind.has(k)) as kind, i (kind)}
                {#if i > 0}<span class="sep">·</span>{/if}
                <button
                  class="link"
                  type="button"
                  onclick={() => {
                    filter = `held:${kind}`;
                    devicesOpen = true;
                    page = 1;
                  }}
                >
                  {held.byKind.get(kind)?.toLocaleString()} {HELD_KIND_LABEL[kind]}{kind === 'flotilla-down' &&
                  held.flotillas.length > 0
                    ? ` (${held.flotillas.join(', ')})`
                    : ''}
                </button>
              {/each}
            </p>
          {/if}
          {#if budget !== null}
            <p class:over={budget.over}>
              <span class="foot-label">Failure budget</span>
              {#if budget.over}
                {budget.failed} failed, more than the {budget.allowed} allowed ({budget.percent}%): no more devices
                start.
              {:else}
                {budget.failed} of {budget.allowed} allowed failures ({budget.percent}%).
              {/if}
            </p>
          {/if}
        </div>
      {/if}
      {#if campaign.adminState === 'run'}
        <div class="status-foot">
          <p class="rate">
            {#if rate !== null}
              ~{rate.toFixed(1)} devices finished/min{eta !== null ? ` · ETA ${formatEta(eta)}` : ''} ·
              measured since this page opened
            {:else}
              The rate shows once devices finish.
            {/if}
          </p>
        </div>
      {/if}
    </section>
  {/if}

  {#if counters === null && campaign.devices.length > 0}
    <!-- Holds the space until the first state report, so the page does not
         jump when it arrives. -->
    <section class="card status-card" aria-label="Progress" aria-busy="true">
      <div class="placeholder-bar"></div>
      <p class="rate">Waiting for the first status report…</p>
    </section>
  {/if}

  {#if campaign.plan !== null && (campaign.plan.windows.length > 0 || campaign.plan.alarms.length > 0 || campaign.plan.unplaced.length > 0)}
    {@const plan = campaign.plan}
    <section class="card">
      <div class="grids-head">
        <h2 class="panel-title">Plan</h2>
        <span class="hint">estimates in your local time</span>
      </div>
      {#if plan.alarms.length > 0}
        <ul class="alarms">
          {#each plan.alarms as alarm, i (i)}
            <li>{alarm}</li>
          {/each}
        </ul>
      {/if}
      {#if onTarget.length > 0}
        <div class="on-target">
          <button
            class="fold names-fold"
            type="button"
            aria-expanded={onTargetOpen}
            onclick={() => (onTargetOpen = !onTargetOpen)}
          >
            {onTarget.length === 1 ? '1 device already runs' : `${onTarget.length.toLocaleString()} devices already run`} the
            target: no upgrade
          </button>
          {#if onTargetOpen}
            <ul class="names">
              {#each onTarget as name (name)}
                <li><a class="mono" href={`/devices/${encodeURIComponent(name)}`}>{name}</a></li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      {#if timelinePlan !== null && timelinePlan.windows.length > 0}
        <PlanTimeline
          plan={timelinePlan}
          rows={rowsByName}
          {now}
          ondevice={(name) => goto(`/devices/${encodeURIComponent(name)}`)}
        />
      {/if}
    </section>
  {/if}

  {#if campaign.plan === null && campaign.devices.length > 0}
    <section class="card" aria-busy="true">
      <div class="grids-head">
        <h2 class="panel-title">Plan</h2>
        <span class="hint">estimates in your local time</span>
      </div>
      <div class="placeholder-plan">Planning…</div>
    </section>
  {/if}

  {#if planningForm}
    <section class="card">
      <h2 class="fold-heading">
        <button class="fold" type="button" aria-expanded={paceOpen} onclick={() => (paceOpen = !paceOpen)}>
          Schedule, pace and limits
        </button>
        {#if !paceOpen}
          <span class="hint"
            >{planningDirty
              ? 'unsaved changes'
              : 'change the default schedule, a deadline, how many at once, the notice or the failure budget'}</span
          >
        {/if}
      </h2>
      {#if paceOpen}
        <div class="pace-body">
          <PlanningFields
            {schedules}
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
            {:else if alsoTargetConcurrency !== null}
              <span class="save-ok">{alsoTargetConcurrency} at once also applies; saving sets it to 1.</span>
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
        </div>
      {/if}
    </section>
  {/if}

  {#if failedRows.length > 0}
    <section class="card failed-card">
      <h2 class="fold-heading">
        <button class="fold" type="button" aria-expanded={failedOpen} onclick={() => (failedOpen = !failedOpen)}>
          Failed or rolled back ({failedRows.length})
        </button>
      </h2>
      {#if failedOpen}
        <div class="failed-body">
          <DeviceStatusTable rows={failedRows.slice(0, FAILED_LIMIT)} />
          {#if failedRows.length > FAILED_LIMIT}
            <p class="rate">showing {FAILED_LIMIT} of {failedRows.length}</p>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#key data.name}
    <CampaignGroups
      members={campaign.devices}
      rows={campaign.deviceStatus}
      plan={campaign.plan}
      version={data.seq}
      onwrote={groupsWrote}
    />
  {/key}

  <section class="card">
    <h2 class="fold-heading">
      <button class="fold" type="button" aria-expanded={devicesOpen} onclick={() => (devicesOpen = !devicesOpen)}>
        Devices ({campaign.deviceStatus.length.toLocaleString()})
      </button>
    </h2>
    {#if devicesOpen}
      {#if campaign.deviceStatus.length === 0}
        <div class="empty-state">The campaign has no member devices.</div>
      {:else}
        <div class="filter-row">
          <button
            class="chip"
            class:active={filter === ''}
            type="button"
            aria-pressed={filter === ''}
            onclick={() => {
              filter = '';
              page = 1;
            }}
          >
            all {campaign.deviceStatus.length}
          </button>
          {#each KNOWN_STATUSES as status (status)}
            {#if statusCounts.get(status)}
              <button
                class="chip"
                class:active={filter === `status:${status}`}
                type="button"
                aria-pressed={filter === `status:${status}`}
                onclick={() => {
                  filter = `status:${status}`;
                  page = 1;
                }}
              >
                {STATUS_LABEL[status]} {statusCounts.get(status)}
              </button>
            {/if}
          {/each}
          {#if campaign.plan !== null && campaign.plan.unplaced.length > 0}
            <button
              class="chip"
              class:active={filter === 'unplaced'}
              type="button"
              aria-pressed={filter === 'unplaced'}
              onclick={() => {
                filter = 'unplaced';
                page = 1;
              }}
            >
              in no window {campaign.plan.unplaced.length}
            </button>
          {/if}
          {#if held.byKind.size > 0}
            <span class="chip-sep" aria-hidden="true"></span>
            {#each HELD_KINDS as kind (kind)}
              {#if held.byKind.get(kind)}
                <button
                  class="chip held-chip"
                  class:active={filter === `held:${kind}`}
                  type="button"
                  aria-pressed={filter === `held:${kind}`}
                  onclick={() => {
                    filter = `held:${kind}`;
                    page = 1;
                  }}
                >
                  held: {HELD_KIND_LABEL[kind]} {held.byKind.get(kind)}
                </button>
              {/if}
            {/each}
          {/if}
          <input
            class="input compact mono search"
            type="text"
            aria-label="Find device"
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
  .summary {
    margin: 4px 0 0;
    color: var(--sw-text-secondary);
    font-size: var(--sw-text-md);
  }

  /* One line; more images than fit scroll sideways. */
  .image-pills {
    display: flex;
    gap: 8px;
    margin: -12px 0 20px;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .image-pill {
    flex: none;
    padding: 3px 10px;
  }

  .image-pill .n {
    color: var(--sw-text-primary);
    font-weight: 600;
  }

  .status-card {
    padding-bottom: 16px;
  }

  .status-foot {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 16px;
    margin-top: 12px;
  }

  .status-foot .rate {
    margin: 0;
  }

  .since {
    margin: 2px 0 0;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
  }

  .held-foot {
    display: grid;
    gap: 4px;
    margin-top: 12px;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
  }

  .held-foot p {
    margin: 0;
  }

  .held-foot .over {
    color: var(--sw-danger-text);
  }

  .foot-label {
    margin-right: 8px;
    font-weight: 600;
    color: var(--sw-text-muted);
  }

  .sep {
    margin: 0 6px;
    color: var(--sw-text-muted);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--sw-warning);
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  /* Like the alarms, but nothing is wrong. */
  .on-target {
    margin: 0 0 12px;
    padding: 8px 14px;
    border-radius: var(--sw-radius-md);
    border: 1px solid rgb(var(--sw-success-rgb) / 0.25);
    background: var(--sw-success-dim);
    color: var(--sw-success);
    font-size: var(--sw-text-sm);
  }

  .chip-sep {
    width: 1px;
    align-self: stretch;
    background: var(--sw-border-default);
  }

  /* Same height as CampaignProgress's bar. */
  .placeholder-bar {
    height: 30px;
    border-radius: var(--sw-radius-sm);
    background: var(--sw-bg-deep);
  }

  .placeholder-plan {
    display: grid;
    place-items: center;
    min-height: 240px;
    border: 1px dashed var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    font-size: var(--sw-text-sm);
    color: var(--sw-text-muted);
  }

  .failed-card {
    border-color: rgb(var(--sw-danger-rgb) / 0.35);
  }

  .failed-card .fold {
    color: var(--sw-danger-text);
  }

  .failed-card .fold:hover {
    color: var(--sw-accent-bright);
  }

  .failed-body {
    margin-top: 12px;
  }

  .fold-heading {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    font-size: inherit;
  }

  .pace-body {
    margin-top: 16px;
  }

  .planning-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
  }

  .save-ok {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
  }

  .save-error {
    font-size: var(--sw-text-xs);
    color: var(--sw-danger-text);
  }

  .rate {
    margin: 10px 0 0;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
  }

  .grids-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .grids-head .panel-title {
    margin: 0;
  }

  .hint {
    font-size: var(--sw-text-xs);
    font-weight: 400;
    color: var(--sw-text-muted);
  }

  .alarms {
    margin: 0 0 12px;
    padding: 10px 14px 10px 30px;
    border-radius: var(--sw-radius-md);
    border: 1px solid rgb(var(--sw-warning-rgb) / 0.3);
    background: var(--sw-warning-dim);
    color: var(--sw-warning);
    font-size: var(--sw-text-sm);
  }

  .names-fold {
    min-height: 0;
    color: inherit;
    font-size: inherit;
    font-weight: inherit;
    text-align: left;
  }

  .names-fold:hover {
    color: inherit;
    text-decoration: underline;
  }

  .names {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    max-height: 240px;
    overflow-y: auto;
    margin: 8px 0 2px;
    padding: 0;
    list-style: none;
  }

  .names a {
    color: var(--sw-text-secondary);
    font-size: var(--sw-text-xs);
    text-decoration: none;
  }

  .names a:hover {
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

  .search {
    width: auto;
    margin-left: auto;
  }

  @media (max-width: 720px) {
    .search {
      width: 100%;
      margin-left: 0;
    }
  }
</style>
