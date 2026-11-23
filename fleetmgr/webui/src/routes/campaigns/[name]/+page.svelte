<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { onLoaded } from '#lib/core/loading.svelte.ts';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import NavIcon, { type NavIconName } from '#lib/core/ui/NavIcon.svelte';
  import Pager, { paginate } from '#lib/core/ui/Pager.svelte';
  import AdminStatePill from '#lib/software/AdminStatePill.svelte';
  import CampaignGroups from '#lib/software/CampaignGroups.svelte';
  import CampaignProgress from '#lib/software/CampaignProgress.svelte';
  import DeviceStatusTable from '#lib/software/DeviceStatusTable.svelte';
  import PlanningFields from '#lib/software/PlanningFields.svelte';
  import PlanTimeline from '#lib/software/PlanTimeline.svelte';
  import PrepareBar from '#lib/software/PrepareBar.svelte';
  import { getListEntryPath, restconfDelete, restconfPatchJson } from '#lib/core/restconf/client.ts';
  import { createPoller } from '#lib/core/polling/poller.ts';
  import { Announcer, CampaignLive, FAST_MS, type LiveFacts, type LiveView } from '#lib/software/campaign-live.ts';
  import {
    paceText,
    planningChanges,
    planningDraft,
    planningFromDraft,
    planInstallSeconds,
    planningOf,
    saveCampaignPlanning,
    validatePlanningDraft,
    type PlanningDraft
  } from '#lib/software/planning-form.ts';
  import {
    isPrepareAlarm,
    prepareTally,
    prepareViews,
    type PrepareView
  } from '#lib/software/prepare.ts';
  import { formatClock, formatDayClock } from '#lib/core/time.ts';
  import { upgradeCounts } from '#lib/software/campaign-images.ts';
  import type { CatalogImage } from '#lib/software/images.ts';
  import { HELD_KINDS, HELD_KIND_LABEL, heldCounts, heldKind, type HeldKind } from '#lib/software/device-state.ts';
  import { campaignDeviceHref } from '#lib/software/links.ts';
  import { nameMatcher } from '#lib/software/selection.ts';
  import { alreadyOnTarget } from '#lib/software/stages.ts';
  import {
    CAMPAIGN_LIST_ROOT,
    DATA_ROOT,
    KNOWN_STATUSES,
    STATUS_LABEL,
    adminStatePatch,
    isFinalStatus,
    joinState,
    modeLabel,
    type CampaignPlan,
    type DeviceStatusRow,
    type KnownStatus,
    type PlanWindow,
    type Schedule
  } from '#lib/software/model.ts';
  import type { PageProps } from './$types';

  const PAGE_SIZE = 100;
  const FAILED_LIMIT = 200;
  /** Next windows the run dialog names one by one. */
  const NEXT_LISTED = 3;

  let { data }: PageProps = $props();

  let busy = $state(false);
  let actionError = $state('');
  let confirmAction = $state<'run' | 'plan' | 'delete' | null>(null);

  // Polled changes for a screen reader: emptied first, so that the same
  // words said again are read again.
  let announcement = $state('');
  const announcer = new Announcer((text) => {
    announcement = '';
    void tick().then(() => (announcement = text));
  });

  // Each load starts with the failed devices open and the pace and the
  // devices folded.
  let failedOpen = $state(true);
  let devicesOpen = $state(false);
  let paceOpen = $state(false);
  let onTargetOpen = $state(false);
  /** The devices table's filter: '' for all, one status or held kind, the
   * members in no window, or the members whose prepare ahead failed. */
  type RowFilter = '' | `status:${KnownStatus}` | `held:${HeldKind}` | 'unplaced' | 'prepare-failed';
  let filter = $state<RowFilter>('');
  let searchText = $state('');
  let page = $state(1);

  // Schedule and pace: the fields follow the campaign until edited.
  let planningEdit = $state<PlanningDraft | null>(null);
  let planningSaving = $state(false);
  let planningMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let planningFields: ReturnType<typeof PlanningFields> | undefined = $state();

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
  let schedulesError = $state('');
  onLoaded(
    () => data.schedules,
    (value) => {
      schedules = value.schedules;
      schedulesError = value.error;
    }
  );
  let catalog = $state.raw<CatalogImage[]>([]);
  onLoaded(
    () => data.catalog,
    (value) => (catalog = value)
  );

  // Another campaign starts over, its form and filters too.
  let shownName: string | null = null;
  $effect.pre(() => {
    if (data.name !== shownName) {
      shownName = data.name;
      announcer.reset();
      announcement = '';
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
      announcer.dispose();
    };
  });

  let shown = $derived(view !== null && view.name === data.name ? view : null);
  /** undefined while unknown (the load failed), null when there is no such campaign. */
  let config = $derived(shown?.config);
  let parts = $derived(shown?.state ?? null);
  let campaign = $derived(config ? { ...config, ...joinState(parts, config.devices) } : null);
  let counters = $derived(shown?.counters ?? null);
  // A failed load stops showing once a later read got through.
  let loadError = $derived((shown?.seq ?? 0) > applied.seq ? '' : applied.loadError);
  let rowsByName = $derived(
    new Map<string, DeviceStatusRow>((campaign?.deviceStatus ?? []).map((r) => [r.device, r]))
  );
  let held = $derived(heldCounts(campaign?.deviceStatus ?? []));
  // The image pills: the members by hardware model and the release they
  // upgrade to; each pill's tip names the image.
  let upgrades = $derived(
    campaign ? upgradeCounts(campaign.devices, campaign.images, (n) => rowsByName.get(n)?.model ?? '', catalog) : []
  );

  // Members that ran the target already take no cell in the timeline: they
  // have nothing to install, and are listed under the plan instead.
  let onTarget = $derived(
    (campaign?.deviceStatus ?? [])
      .filter(alreadyOnTarget)
      .map((r) => r.device)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  );
  // Their notice can be dismissed; this browser keeps it away per campaign
  // until their count changes. The summary still counts them.
  const ON_TARGET_STORE = 'fleetmgr.plan.on-target-dismissed.';
  let onTargetDismissed = $derived(storedOnTargetDismissed(data.name));

  function storedOnTargetDismissed(name: string): number | null {
    try {
      const n = localStorage.getItem(ON_TARGET_STORE + name);
      return n === null ? null : Number(n);
    } catch {
      return null;
    }
  }

  function dismissOnTarget(): void {
    onTargetDismissed = onTarget.length;
    try {
      localStorage.setItem(ON_TARGET_STORE + data.name, String(onTarget.length));
    } catch {
      // Without storage it stays dismissed while the page is open.
    }
  }

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
  let noticeText = $derived.by(() => {
    if (!campaign || noticeFrom === null) return 'no notice';
    const n = campaign.notificationPeriod;
    const days = n === 1 ? "1 day's" : `${n.toLocaleString()} days'`;
    const from = campaign.runSince === null ? ' from now' : '';
    return `${days} notice${from}: windows from ${formatClock(noticeFrom)} on`;
  });
  // The members that prepare ahead, and where their prepares are.
  let prepare = $derived(prepareViews(campaign?.plan ?? null, campaign?.deviceStatus ?? []));
  let prepared = $derived(prepareTally(prepare));

  // The Prepare chip over the plan: off, the plan shows nothing of preparing
  // ahead, neither the bar nor the cells nor its alarms. Kept per browser.
  const PREPARE_STORE = 'fleetmgr.plan.prepare';
  const NO_PREPARE = new Map<string, PrepareView>();
  let showPrepare = $state(storedShowPrepare());

  function storedShowPrepare(): boolean {
    try {
      return localStorage.getItem(PREPARE_STORE) !== 'hidden';
    } catch {
      return true;
    }
  }

  function setShowPrepare(shown: boolean): void {
    showPrepare = shown;
    try {
      if (shown) localStorage.removeItem(PREPARE_STORE);
      else localStorage.setItem(PREPARE_STORE, 'hidden');
    } catch {
      // Without storage the choice lasts while the page is open.
    }
  }

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

  /** The stored pace and limits, and when the campaign first ran, as the
   * header's icons say them; each tip has the whole of it. */
  let limits = $derived.by((): { icon: NavIconName; text: string; tip: string }[] => {
    if (!campaign || !savedPlanning) return [];
    const p = savedPlanning;
    const out: { icon: NavIconName; text: string; tip: string }[] = [];
    const pace =
      p.deadline !== null
        ? `Deadline ${formatClock(p.deadline)}`
        : p.maxConcurrency > p.targetConcurrency
          ? `${p.targetConcurrency.toLocaleString()} to ${p.maxConcurrency.toLocaleString()} at once`
          : `${p.targetConcurrency.toLocaleString()} at once`;
    out.push({ icon: 'pace', text: pace, tip: capitalized(paceText(p)) });
    if (p.failureBudget === null) {
      out.push({ icon: 'shield', text: 'No failure budget', tip: 'Failures do not hold the campaign' });
    } else {
      const may = budget === null ? '' : `: ${budget.allowed.toLocaleString()} devices may fail`;
      out.push({ icon: 'shield', text: `Failure budget ${p.failureBudget}%`, tip: `Failure budget ${p.failureBudget}%${may}` });
    }
    if (campaign.notificationPeriod > 0) {
      const n = campaign.notificationPeriod;
      out.push({ icon: 'bell', text: `${n.toLocaleString()} day${n === 1 ? '' : 's'} notice`, tip: capitalized(noticeText) });
    }
    if (campaign.runSince !== null) {
      out.push({
        icon: 'play',
        text: `Since ${formatClock(campaign.runSince, now)}`,
        tip: `First ran ${formatClock(campaign.runSince, 0)}`
      });
    }
    return out;
  });

  /** When the next window opens: the day and clock within a week, else the
   * date. */
  function opensText(t: number): string {
    return t - now < 6 * 86400 ? formatDayClock(t, now) : formatClock(t, now);
  }

  function capitalized(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function devicesText(n: number): string {
    return n === 1 ? '1 device' : `${n.toLocaleString()} devices`;
  }

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
    if (f === 'prepare-failed') return prepare.get(r.device)?.state === 'failed';
    if (f.startsWith('status:')) return `status:${r.status}` === f;
    return r.held !== null && `held:${heldKind(r.held)}` === f;
  }

  let filteredRows = $derived.by(() => {
    const matchName = nameMatcher(searchText.trim());
    return (campaign?.deviceStatus ?? []).filter((r) => passes(r, filter) && matchName(r.device));
  });
  let paged = $derived(paginate(filteredRows, page, PAGE_SIZE));

  // No "done" claim anywhere: status is not latched, it tracks live device
  // state. The pill by the name says whether it runs, is planned or is
  // paused; this line says what goes on.
  let summary = $derived.by(() => {
    const c = campaign;
    if (!c) return '';
    if (c.adminState === 'plan') {
      const plan = c.plan;
      if (plan !== null && (plan.windows.length > 0 || plan.unplaced.length > 0 || plan.done.length > 0)) {
        const placed = c.devices.length - plan.unplaced.length - plan.done.length;
        const windows = `${plan.windows.length} window${plan.windows.length === 1 ? '' : 's'}`;
        const missing = plan.unplaced.length > 0 ? `, ${plan.unplaced.length.toLocaleString()} in no window yet` : '';
        const done = plan.done.length > 0 ? `, ${plan.done.length.toLocaleString()} already done` : '';
        return `${placed.toLocaleString()} of ${c.devices.length.toLocaleString()} placed in ${windows}${missing}${done}.`;
      }
      return '';
    }
    if (counters === null) return 'No state reported yet.';
    // The progress bar counts the members that install.
    if (counters.inProgress > 0) return '';
    if (counters.total > 0 && counters.remainder === 0) {
      const upgraded = counters.succeeded - counters.upToDate;
      const already = counters.upToDate > 0 ? `, ${counters.upToDate.toLocaleString()} already up to date` : '';
      return `No work outstanding: ${upgraded.toLocaleString()} upgraded${already}, ${counters.failed.toLocaleString()} failed.`;
    }
    const windows = c.plan?.windows ?? [];
    if (windows.some((w) => now >= w.start && (w.end === null || now < w.end))) return '';
    const next = windows.find((w) => w.start > now);
    return next ? `Next window opens ${opensText(next.start)}.` : '';
  });

  const CONFIRMS = {
    run: {
      title: 'Run campaign',
      confirmLabel: 'Run',
      confirmClass: 'btn-primary'
    },
    plan: {
      title: 'Pause campaign',
      confirmLabel: 'Pause',
      confirmClass: 'btn-primary'
    },
    delete: {
      title: 'Delete campaign',
      confirmLabel: 'Delete',
      confirmClass: 'btn-danger'
    }
  } as const;

  /** What Run starts, for its dialog: the windows open now and the ones
   * after, each with the members it has left to upgrade. */
  let preflight = $derived.by(() => {
    if (confirmAction !== 'run' || !savedPlanning) return null;
    const left = (name: string) => !isFinalStatus(rowsByName.get(name)?.status ?? 'unknown');
    const windows = (timelinePlan?.windows ?? [])
      .filter((w) => w.end === null || w.end > now)
      .map((w) => ({ w, n: w.devices.filter((d) => left(d.name)).length }))
      .filter(({ n }) => n > 0);
    const open = windows.filter(({ w }) => w.start <= now);
    const openDevices = open.reduce((sum, { n }) => sum + n, 0);
    const p = savedPlanning;
    const atOnce =
      p.deadline !== null
        ? "at the deadline's pace"
        : openDevices <= p.targetConcurrency
          ? 'all at once'
          : `${p.targetConcurrency.toLocaleString()} at once`;
    const next = windows.filter(({ w }) => w.start > now);
    const later = next.slice(NEXT_LISTED);
    return {
      total: windows.reduce((sum, { n }) => sum + n, 0),
      open: open.length === 0 ? '' : `${open.map(({ w, n }) => `${openText(w)}, ${devicesText(n)}`).join(' · ')}, ${atOnce}`,
      next: next.slice(0, NEXT_LISTED).map(({ w, n }) => `${nextText(w)}: ${devicesText(n)}`),
      later:
        later.length === 0
          ? ''
          : `${later.length.toLocaleString()} more ${later.length === 1 ? 'window' : 'windows'}: ${devicesText(later.reduce((sum, { n }) => sum + n, 0))}`
    };
  });

  // Without a schedule a campaign runs through one window of its own,
  // open from launch, or from the end of its notice, to its deadline.

  /** An open window: its schedule and when it closes. */
  function openText(w: PlanWindow): string {
    const until = w.end === null ? '' : ` until ${formatClock(w.end)}`;
    return `${w.schedule || 'No schedule'}${until}`;
  }

  /** A window still to open: its schedule and when it opens. */
  function nextText(w: PlanWindow): string {
    return w.schedule ? `${w.schedule} opens ${formatClock(w.start)}` : `From ${formatClock(w.start)}`;
  }

  let confirmMessage = $derived.by(() => {
    const c = campaign;
    if (!c || !confirmAction) return '';
    if (confirmAction === 'run') {
      if (!preflight || preflight.total === 0) return 'Run the campaign? No device in a window needs an upgrade.';
      return `Start upgrading ${devicesText(preflight.total)}?`;
    }
    if (confirmAction === 'plan')
      return 'Pause the campaign? Devices upgrading now stop before their install and go on when it runs again. Devices past their install finish.';
    return `Delete campaign ${c.name}? Its targets are withdrawn from the devices.`;
  });

  /** From the run dialog: the failure budget field, in the fold opened. */
  async function setBudget(): Promise<void> {
    confirmAction = null;
    paceOpen = true;
    // The dialog has closed and given focus back to Run by then.
    await tick();
    planningFields?.focusBudget();
  }

  // What the announcer compares between polls.
  let facts = $derived.by((): LiveFacts | null => {
    if (!campaign || counters === null) return null;
    return {
      mode: modeLabel(campaign.adminState, campaign.runSince),
      failed: counters.failed,
      overBudget: budget?.over ?? false,
      idle: campaign.adminState === 'run' && counters.total > 0 && counters.inProgress === 0 && counters.remainder === 0,
      idleText: summary
    };
  });
  $effect(() => {
    if (facts !== null) announcer.update(facts);
  });

  /** Whether the image pills scroll, and whether more lie past the right
   * edge. */
  let pills = $state({ scroll: false, more: false });

  function watchPills(scroller: HTMLElement): () => void {
    const measure = () => {
      const scroll = scroller.scrollWidth > scroller.clientWidth + 1;
      const more = scroll && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
      if (scroll !== pills.scroll || more !== pills.more) pills = { scroll, more };
    };
    // The track is as wide as the pills, so it resizes when they change.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', measure);
    };
  }

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

<!-- In place before any message, so that a screen reader reads each one. -->
<div role="alert">
  {#if actionError}
    <div class="error-state status">{actionError}</div>
  {/if}
</div>
<div class="sr-only" role="status">{announcement}</div>

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
  {:else}
    <div class="page-header">
      <div>
        <h1>{data.name}</h1>
      </div>
    </div>
    <LoadError message={loadError || 'Failed to load the campaign.'} />
  {/if}
{:else}
  <!-- A refresh that failed: what shows is from the read before. -->
  {#if loadError}
    <LoadError message={loadError} />
  {/if}
  <div class="page-header">
    <div>
      <div class="title">
        <h1>{campaign.name}</h1>
        <AdminStatePill state={campaign.adminState} runSince={campaign.runSince} />
      </div>
      {#if summary}
        <p class="summary">{summary}</p>
      {/if}
      {#if limits.length > 0}
        <ul class="limits">
          {#each limits as l (l.icon)}
            <li title={l.tip}><NavIcon name={l.icon} size={14} />{l.text}</li>
          {/each}
        </ul>
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
          Pause
        </button>
      {/if}
    </div>
  </div>

  {#if campaign.images.length > 0}
    <!-- The full width under the header, so a few images fit one line;
         more scroll sideways, so the strip takes focus then. -->
    <div class="image-pills" class:more={pills.more}>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="pills-scroll"
        role="region"
        aria-label="Images"
        tabindex={pills.scroll ? 0 : undefined}
        {@attach watchPills}
      >
        <div class="pills-track">
          {#each upgrades as u (`${u.model}\0${u.version || u.images[0]}`)}
            <span class="pill image-pill" title={u.images.map((i) => i || 'no image').join(', ')}>
              <span class="mono">{u.model || 'unknown model'} → {u.version || u.images[0] || 'no image'}</span>
              <span class="n tn">{u.count.toLocaleString()}</span>
            </span>
          {/each}
        </div>
      </div>
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

  {#if campaign.plan !== null && (campaign.plan.windows.length > 0 || campaign.plan.alarms.length > 0 || campaign.plan.unplaced.length > 0 || campaign.plan.done.length > 0)}
    {@const plan = campaign.plan}
    {@const alarms = showPrepare ? plan.alarms : plan.alarms.filter((a) => !isPrepareAlarm(a))}
    <section class="card">
      <div class="grids-head">
        <h2 class="panel-title">Plan</h2>
        <span class="hint">Local time</span>
      </div>
      {#if alarms.length > 0}
        <ul class="alarms">
          {#each alarms as alarm, i (i)}
            <li>{alarm}</li>
          {/each}
        </ul>
      {/if}
      {#if onTarget.length > 0 && onTarget.length !== onTargetDismissed}
        <div class="on-target">
          <div class="on-target-head">
            <button
              class="fold names-fold"
              type="button"
              aria-expanded={onTargetOpen}
              onclick={() => (onTargetOpen = !onTargetOpen)}
            >
              {onTarget.length === 1 ? '1 device already runs' : `${onTarget.length.toLocaleString()} devices already run`}
              the target: no upgrade
            </button>
            <button class="dismiss" type="button" aria-label="Dismiss" title="Dismiss" onclick={dismissOnTarget}>×</button>
          </div>
          {#if onTargetOpen}
            <ul class="names">
              {#each onTarget as name (name)}
                <li><a class="mono" href={campaignDeviceHref(data.name, name)}>{name}</a></li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      {#if timelinePlan !== null && timelinePlan.windows.length > 0}
        <PrepareBar {prepare} {now} shown={showPrepare} onchange={setShowPrepare} />
        <PlanTimeline
          plan={timelinePlan}
          rows={rowsByName}
          prepare={showPrepare ? prepare : NO_PREPARE}
          {now}
          fitPlan={campaign.adminState === 'plan'}
          zoomKey={campaign.name}
          ondevice={(name) => goto(campaignDeviceHref(data.name, name))}
        />
      {/if}
    </section>
  {/if}

  {#if campaign.plan === null && campaign.devices.length > 0}
    <section class="card" aria-busy="true">
      <div class="grids-head">
        <h2 class="panel-title">Plan</h2>
        <span class="hint">Local time</span>
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
        {#if !paceOpen && planningDirty}
          <span class="hint">Unsaved changes</span>
        {/if}
      </h2>
      {#if paceOpen && schedulesError}
        <!-- The schedule field offers the schedules: without them it would
             call the campaign's one missing. -->
        <div class="pace-body">
          <LoadError message={schedulesError} />
        </div>
      {:else if paceOpen}
        <div class="pace-body">
          <PlanningFields
            bind:this={planningFields}
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
            <span role="status">
              {#if planningMessage?.type === 'success'}
                <span class="save-ok">{planningMessage.text}</span>
              {/if}
            </span>
            <span role="alert">
              {#if planningMessage?.type === 'error'}
                <span class="save-error">{planningMessage.text}</span>
              {/if}
            </span>
            {#if !planningMessage && alsoTargetConcurrency !== null}
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
          <DeviceStatusTable campaign={data.name} rows={failedRows.slice(0, FAILED_LIMIT)} />
          {#if failedRows.length > FAILED_LIMIT}
            <p class="rate">showing {FAILED_LIMIT} of {failedRows.length}</p>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#key data.name}
    <CampaignGroups
      campaign={data.name}
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
          {#if prepared.failed > 0}
            <button
              class="chip"
              class:active={filter === 'prepare-failed'}
              type="button"
              aria-pressed={filter === 'prepare-failed'}
              onclick={() => {
                filter = 'prepare-failed';
                page = 1;
              }}
            >
              prepare failed {prepared.failed}
            </button>
          {/if}
          <input
            class="input compact mono search"
            type="text"
            aria-label="Find device"
            placeholder="Find device"
            title="Matches part of a name, or a glob with * and ?"
            bind:value={searchText}
            oninput={() => (page = 1)}
          />
        </div>
        <DeviceStatusTable campaign={data.name} rows={paged.rows} prepare={prepare.size > 0 ? prepare : null} {now} />
        <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (page = p)} />
      {/if}
    {/if}
  </section>

{/if}

{#snippet runDetails()}
  {#if preflight && campaign && savedPlanning}
    <dl class="preflight">
      <dt>Open now</dt>
      <dd>{preflight.open || 'No window'}</dd>
      {#if preflight.next.length > 0}
        <dt>Next</dt>
        <dd>
          {#each preflight.next as line, i (i)}
            <span class="line">{line}</span>
          {/each}
          {#if preflight.later}
            <span class="line">{preflight.later}</span>
          {/if}
        </dd>
      {/if}
      <dt>Pace</dt>
      <dd>{capitalized(paceText(savedPlanning))}</dd>
      <dt>Failure budget</dt>
      <dd>
        {#if campaign.failureBudget === null}
          None · <button class="link" type="button" onclick={setBudget}>Set one</button>
        {:else}
          {campaign.failureBudget}%{budget !== null ? `, ${devicesText(budget.allowed)}` : ''}
        {/if}
      </dd>
      {#if onTarget.length > 0}
        <dt>On target</dt>
        <dd>{devicesText(onTarget.length)}, nothing to install</dd>
      {/if}
      {#if (campaign.plan?.unplaced.length ?? 0) > 0}
        <dt>In no window</dt>
        <dd>{devicesText(campaign.plan?.unplaced.length ?? 0)}, they do not start</dd>
      {/if}
    </dl>
  {/if}
{/snippet}

<ConfirmDialog
  open={confirmAction !== null}
  title={confirmAction ? CONFIRMS[confirmAction].title : ''}
  message={confirmMessage}
  details={confirmAction === 'run' ? runDetails : undefined}
  confirmLabel={confirmAction ? CONFIRMS[confirmAction].confirmLabel : ''}
  confirmClass={confirmAction ? CONFIRMS[confirmAction].confirmClass : 'btn-primary'}
  oncancel={() => (confirmAction = null)}
  onconfirm={handleConfirm}
/>

<style>
  .title {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 12px;
  }

  .summary {
    margin: 4px 0 0;
    color: var(--sw-text-secondary);
    font-size: var(--sw-text-md);
  }

  .limits {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
  }

  .limits li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .limits :global(svg) {
    color: var(--sw-text-muted);
  }

  /* One line; more images than fit scroll sideways, and fade out at the
     edge while more lie past it. */
  .image-pills {
    position: relative;
    margin: -12px 0 20px;
  }

  .image-pills.more::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 48px;
    background: linear-gradient(to right, transparent, var(--sw-bg-deep));
    pointer-events: none;
  }

  .pills-scroll {
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .pills-track {
    display: flex;
    gap: 8px;
    width: max-content;
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

  .pace-body > :global(.load-error) {
    margin-bottom: 0;
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

  .on-target-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .dismiss {
    flex: none;
    padding: 2px 7px;
    background: none;
    border: none;
    border-radius: var(--sw-radius-sm);
    color: inherit;
    font: inherit;
    font-size: var(--sw-text-lg);
    line-height: 1;
    cursor: pointer;
  }

  .dismiss:hover {
    background: rgb(var(--sw-success-rgb) / 0.15);
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
    gap: 8px 14px;
    max-height: 240px;
    overflow-y: auto;
    margin: 8px 0 2px;
    padding: 0;
    list-style: none;
  }

  /* Targets 24 px tall at least, 8 px apart, so a name is easy to hit. */
  .names a {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
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

  /* The run dialog's checks: a label column and what it says. */
  .preflight {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 16px;
    margin: 0;
    font-size: var(--sw-text-sm);
  }

  .preflight dt {
    color: var(--sw-text-muted);
  }

  .preflight dd {
    margin: 0;
    color: var(--sw-text-primary);
  }

  .preflight .line {
    display: block;
  }

  .preflight .link {
    padding: 2px 4px;
    margin: -2px -4px;
    color: var(--sw-accent-bright);
  }

  @media (max-width: 720px) {
    .search {
      width: 100%;
      margin-left: 0;
    }
  }
</style>
