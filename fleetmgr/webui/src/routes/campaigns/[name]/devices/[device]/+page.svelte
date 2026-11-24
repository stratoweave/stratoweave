<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';

  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import ConnectionDot from '#lib/software/ConnectionDot.svelte';
  import DeviceLog from '#lib/software/DeviceLog.svelte';
  import DevicePicture from '#lib/software/DevicePicture.svelte';
  import HeldText from '#lib/software/HeldText.svelte';
  import JobProgress from '#lib/software/JobProgress.svelte';
  import StageChain from '#lib/software/StageChain.svelte';
  import StatusPill from '#lib/software/StatusPill.svelte';
  import { errorText } from '#lib/core/errors.ts';
  import { onLoaded } from '#lib/core/loading.svelte.ts';
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import { createPoller } from '#lib/core/polling/poller.ts';
  import { dropReadCache, restconfPatchJson } from '#lib/core/restconf/client.ts';
  import { formatClock } from '#lib/core/time.ts';
  import { pendingText } from '#lib/software/device-state.ts';
  import { campaignHref, deviceHref } from '#lib/software/links.ts';
  import {
    DATA_ROOT,
    STEP_LABEL,
    isFinalStatus,
    modeLabel,
    prepareAgainPatch,
    type CheckResult,
    type DeviceCampaign,
    type DeviceStatusRow,
    type Step
  } from '#lib/software/model.ts';
  import { jobDetail, jobProgress, stageDetail, stageView } from '#lib/software/stages.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  // null until their reads are in; a poll keeps what is shown until then.
  let deviceLoad = $state.raw<Awaited<typeof data.device> | null>(null);
  let campaignLoad = $state.raw<Awaited<typeof data.campaign> | null>(null);
  onLoaded(() => data.device, (value) => (deviceLoad = value));
  onLoaded(() => data.campaign, (value) => (campaignLoad = value));
  let loadError = $derived(campaignLoad?.loadError || deviceLoad?.loadError || '');

  onMount(() => {
    // Waits for the reads: loads return before them, and a slow top must
    // not be asked again before it answered.
    const poller = createPoller(async () => {
      await invalidate('data:campaign-device');
      await Promise.all([data.device, data.campaign]);
    }, 5000);
    poller.start();
    return () => poller.stop();
  });

  /** Whether an operator may ask the member to prepare again: the campaign
   * prepares ahead, the member waits for its window, and the prepare of its
   * prepare-attempt failed or is retrying. */
  function mayPrepareAgain(campaign: DeviceCampaign): boolean {
    const job = campaign.row.prepare;
    return (
      campaign.allowStaging &&
      campaign.row.status === 'upgrade-needed' &&
      (job.state === 'failed' || job.state === 'retrying') &&
      job.prepareAttempt >= campaign.prepareAttempt
    );
  }

  let confirmPrepare = $state(false);
  let busy = $state(false);
  let actionError = $state('');

  /** Raise the member's prepare-attempt: the campaign lets it prepare again
   * at once, as its bandwidth cap allows. */
  async function prepareAgain(): Promise<void> {
    confirmPrepare = false;
    const campaign = campaignLoad?.campaign;
    if (!campaign) return;
    try {
      busy = true;
      actionError = '';
      await restconfPatchJson(DATA_ROOT, prepareAgainPatch(campaign.name, data.deviceName, campaign.prepareAttempt));
      // The next read must see the new prepare-attempt.
      dropReadCache();
      await invalidate('data:campaign-device');
    } catch (error) {
      actionError = errorText(error, 'The action failed.');
    } finally {
      busy = false;
    }
  }

  /** This device's start in the plan, real once released, else the
   * planner's estimate; "no window yet" when the plan has the campaign but
   * no window for it, unless its status is final and it needs none. */
  function plannedStart(campaign: DeviceCampaign): string {
    if (campaign.start === null) return '—';
    if (campaign.start === 'unplaced') return isFinalStatus(campaign.row.status) ? '—' : 'no window yet';
    return formatClock(campaign.start);
  }

  /** The checks of the last run that have a verdict. */
  function checks(row: DeviceStatusRow): { step: Step; result: CheckResult }[] {
    const all: { step: Step; result: CheckResult }[] = [
      { step: 'precheck', result: row.precheck },
      { step: 'postcheck', result: row.postcheck }
    ];
    return all.filter((c) => c.result.verdict !== 'not-run');
  }

  /** "a: x; b: y" -> one part per check, with the check's name apart. */
  function detailParts(detail: string): { source: string; text: string }[] {
    return detail.split('; ').map((part) => {
      const i = part.indexOf(': ');
      return i > 0 ? { source: part.slice(0, i + 1), text: part.slice(i + 2) } : { source: '', text: part };
    });
  }

  /** What neither the chain nor the check rows show: what the device does
   * now, or what stopped it. */
  function note(row: DeviceStatusRow, prepareAttempt: number): string {
    const doing = jobDetail(row, prepareAttempt);
    if (doing) return doing;
    const view = stageView(row);
    if (view.steps[0].state === 'skipped') return 'already on the target release';
    if (!view.steps.some((s) => s.state === 'failed')) return '';
    // A refusing check says why in its own row.
    const refused = row.precheck.verdict === 'fail' || row.postcheck.verdict === 'fail';
    if (refused && view.rollback !== 'failed') return '';
    return stageDetail(row);
  }
</script>

{#if loadError}
  <div class="page-header">
    <div>
      <h1>{data.deviceName}</h1>
    </div>
  </div>
  <LoadError message={loadError} />
{:else if deviceLoad === null || campaignLoad === null}
  <div class="page-header">
    <div>
      <h1>{data.deviceName}</h1>
      <p class="summary">Loading…</p>
    </div>
  </div>
  <section class="card run" aria-busy="true">
    <div class="placeholder">Loading the campaign…</div>
  </section>
{:else if !campaignLoad.exists}
  <section class="card">
    <div class="empty-state">No campaign named {data.campaignName}.</div>
  </section>
{:else if campaignLoad.campaign === null}
  <section class="card">
    {#if deviceLoad.device === null}
      <div class="empty-state">No device named {data.deviceName}.</div>
    {:else}
      <div class="empty-state">
        <a class="mono name" href={deviceHref(data.deviceName)}>{data.deviceName}</a> is not in
        <a class="mono name" href={campaignHref(data.campaignName)}>{data.campaignName}</a>.
      </div>
    {/if}
  </section>
{:else}
  {@const device = deviceLoad.device}
  {@const campaign = campaignLoad.campaign}
  {@const row = campaign.row}
  {@const text = note(row, campaign.prepareAttempt)}
  {@const progress = jobProgress(row)}
  <div class="page-header">
    <div class="ident">
      <DevicePicture />
      <div>
        <h1>{data.deviceName}</h1>
        <p class="summary">
          <!-- A member the fleet does not have gets nothing from the campaign. -->
          {#if device === null}
            Not in the fleet.
          {:else}
            <ConnectionDot connection={device.connection} text />
            {#if device.model}
              · model <span class="mono">{device.model}</span>
            {/if}
            {#if device.version}
              · version <span class="mono">{device.version}</span>
            {/if}
          {/if}
        </p>
      </div>
    </div>
    <div class="head-end">
      <StatusPill status={row.status} raw={row.raw} />
      {#if device !== null}
        <div class="page-actions">
          {#if mayPrepareAgain(campaign)}
            <button class="btn btn-secondary" type="button" disabled={busy} onclick={() => (confirmPrepare = true)}>
              Prepare again
            </button>
          {/if}
          <a class="btn btn-secondary" href={deviceHref(device.name)}>Device settings</a>
        </div>
      {/if}
    </div>
  </div>
  {#if actionError}
    <div class="error-state" role="alert">{actionError}</div>
  {/if}

  <ConfirmDialog
    open={confirmPrepare}
    title="Prepare again"
    message={`Prepare ${data.deviceName} again? ${campaign.name} lets it copy its image at once, as its bandwidth cap allows, until its window opens, but not in a time in which no member may prepare.`}
    confirmLabel="Prepare again"
    confirmClass="btn-primary"
    oncancel={() => (confirmPrepare = false)}
    onconfirm={prepareAgain}
  />

  <section class="card run">
    <div class="facts">
      <span class="fact">
        <span class="fact-label">Campaign</span>
        <a class="mono name" href={campaignHref(campaign.name)}>{campaign.name}</a>
      </span>
      <span class="fact">
        <span class="fact-label">Mode</span>
        <span>{modeLabel(campaign.adminState, campaign.runSince)}</span>
      </span>
      <span class="fact">
        <span class="fact-label">Image</span>
        <span class="mono">{campaign.image || '—'}</span>
      </span>
      {#if row.freed !== null}
        <span class="fact">
          <span class="fact-label">Finished</span>
          <span class="mono">{row.finished !== null ? formatClock(row.finished) : '—'}</span>
        </span>
        <span
          class="fact"
          title="The campaign is complete, and keeps this result: another campaign can take the device."
        >
          <span class="fact-label">Freed</span>
          <span class="mono">{formatClock(row.freed)}</span>
        </span>
      {:else}
        <span class="fact">
          <span class="fact-label">Planned start</span>
          <span class="mono">{plannedStart(campaign)}</span>
        </span>
      {/if}
    </div>
    <div class="track"><StageChain {row} large /></div>
    {#if progress !== null}
      <div class="transfer">
        <JobProgress value={progress} label={`Image transfer to ${data.deviceName}`} />
        <span class="mono percent">{progress}%</span>
      </div>
    {/if}
    {#if row.held !== null}
      <!-- Not having answered names the attempt. A member held before
           its window may prepare ahead of it. -->
      {@const pending = row.status === 'pending' ? pendingText(row) : ''}
      <p class="note held">
        <span class="held-label">held:</span>
        {#if row.held === 'not-answered' && pending}{pending}{:else}<HeldText {row} campaign={campaign.name} />{/if}{#if text}{` · ${text}`}{/if}
      </p>
    {:else if row.status === 'pending'}
      <p class="note">{pendingText(row)}</p>
    {:else if text}
      <p class="note">{text}</p>
    {/if}
    {#each checks(row) as check (check.step)}
      {@const verdict = check.result.verdict}
      <div class="check" class:pass={verdict === 'pass'} class:fail={verdict === 'fail'}>
        <span class="check-name">{STEP_LABEL[check.step]}</span>
        <span class="pill verdict" class:success={verdict === 'pass'} class:danger={verdict === 'fail'}>
          {verdict}
        </span>
        <span class="check-detail mono">
          {#each detailParts(check.result.detail) as part, i (i)}
            <span class="part">
              {#if part.source}<span class="source">{part.source}</span>{/if}
              {part.text}
            </span>
          {/each}
        </span>
        {#if check.step === 'precheck' && verdict === 'pass'}
          <span class="baseline mono" title="The post-check compares against this.">baseline</span>
        {/if}
        <span class="at mono">{check.result.at !== null ? formatClock(check.result.at) : ''}</span>
      </div>
    {/each}
  </section>

  {#if device !== null}
    {#key device.name}
      <DeviceLog name={device.name} />
    {/key}
  {/if}
{/if}

<style>
  .summary {
    color: var(--sw-text-muted);
  }

  /* The device's picture beside its name, as its page had it. */
  .ident {
    display: flex;
    align-items: center;
    gap: var(--sw-space-5);
  }

  .ident > div {
    min-width: 0;
  }

  /* The status and the page's actions, right of the title. */
  .head-end {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .head-end > :global(.pill) {
    padding: 4px 12px;
    font-size: var(--sw-text-sm);
  }

  .name {
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .name:hover {
    color: var(--sw-accent);
  }

  .run {
    padding: 28px;
  }

  /* The card's padding ends it, not also the margin of what comes last. */
  .run > :last-child {
    margin-bottom: 0;
  }

  /* About as tall as what it waits for. */
  .placeholder {
    display: grid;
    place-items: center;
    min-height: 160px;
    border: 1px dashed var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    font-size: var(--sw-text-sm);
    color: var(--sw-text-muted);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 28px;
  }

  .fact {
    font-size: var(--sw-text-sm);
    font-weight: 600;
    color: var(--sw-text-primary);
  }

  .fact .fact-label {
    margin-right: 6px;
  }

  .track {
    display: flex;
    justify-content: center;
    margin: 32px 0 28px;
  }

  .note {
    margin: -12px 0 20px;
    text-align: center;
    font-size: var(--sw-text-sm);
    color: var(--sw-text-secondary);
  }

  /* Under the chain, above the note that says what the device does. */
  .transfer {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(100%, 420px);
    margin: -12px auto 20px;
  }

  .transfer > :global(.bar) {
    flex: 1;
  }

  .transfer + .note {
    margin-top: -12px;
  }

  .percent {
    font-size: var(--sw-text-sm);
    color: var(--sw-text-muted);
  }

  .held-label {
    color: var(--sw-warning);
  }

  .check {
    display: grid;
    grid-template-columns: 120px 72px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 16px;
    padding: 14px 20px;
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-deep);
  }

  .check + .check {
    margin-top: 10px;
  }

  .check.pass {
    border-color: rgb(var(--sw-success-rgb) / 0.3);
  }

  .check.fail {
    border-color: rgb(var(--sw-danger-rgb) / 0.3);
  }

  .check-name {
    font-size: var(--sw-text-md);
    font-weight: 600;
  }

  .verdict {
    justify-self: start;
    padding: 2px 10px;
    font-size: var(--sw-text-xs);
  }

  .check-detail {
    font-size: var(--sw-text-sm);
    color: var(--sw-text-primary);
  }

  .part {
    display: block;
  }

  .source {
    color: var(--sw-text-muted);
  }

  .baseline {
    padding: 1px 7px;
    border: 1px solid rgb(var(--sw-accent-rgb) / 0.4);
    border-radius: var(--sw-radius-xs);
    font-size: var(--sw-text-2xs);
    color: var(--sw-accent);
  }

  .at {
    grid-column: 5;
    font-size: var(--sw-text-sm);
    color: var(--sw-text-muted);
  }

  @media (max-width: 720px) {
    .ident > :global(.device-picture) {
      display: none;
    }

    .run {
      padding: 20px 16px;
    }

    .track {
      margin: 24px 0 20px;
    }

    /* The step, its verdict and the baseline tag on one line, the detail
       under them and the time last, so that none of them wraps. */
    .check {
      grid-template-columns: auto auto minmax(0, 1fr);
      gap: 8px 12px;
      padding: 12px 14px;
    }

    .check-name {
      white-space: nowrap;
    }

    .check-detail {
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .baseline {
      justify-self: start;
    }

    .at {
      grid-column: 1 / -1;
      grid-row: 3;
      font-size: var(--sw-text-xs);
    }
  }
</style>
