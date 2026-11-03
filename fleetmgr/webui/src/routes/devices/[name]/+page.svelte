<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';

  import DevicePicture from '$lib/software/DevicePicture.svelte';
  import StageChain from '$lib/software/StageChain.svelte';
  import StatusPill from '$lib/software/StatusPill.svelte';
  import { errorText } from '$lib/core/errors';
  import { createPoller } from '$lib/core/polling/poller';
  import { setDeviceSchedule } from '$lib/maintenance/binding';
  import {
    STEP_LABEL,
    deviceStart,
    type Campaign,
    type CheckResult,
    type DeviceStatusRow,
    type Step
  } from '$lib/software/model';
  import { stageDetail, stageView } from '$lib/software/stages';
  import { formatClock } from '$lib/core/time';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // null follows the device as polled; a pick holds until it is saved.
  let picked = $state<string | null>(null);
  let savingSchedule = $state(false);
  let scheduleMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let bound = $derived(data.device?.schedule ?? '');
  let choice = $derived(picked ?? bound);
  let scheduleOptions = $derived.by(() => {
    const options = data.schedules.map((s) => ({ name: s.name, label: s.name }));
    if (bound && !data.schedules.some((s) => s.name === bound)) {
      options.push({ name: bound, label: `${bound} (missing)` });
    }
    return options;
  });
  // Unbound, the device follows each campaign's default schedule.
  let defaultLabel = $derived.by(() => {
    const names = new Set(data.campaigns.map((c) => c.defaultSchedule || 'none'));
    return `${names.size > 0 ? [...names].join(', ') : 'none'} (default)`;
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
        text: errorText(saveError, 'Failed to save the schedule.')
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

  /** This device's start in the plan, real once released, else the
   * planner's estimate; "not placed" when the plan has the campaign but
   * no window for it. */
  function plannedStart(campaign: Campaign): string {
    if (campaign.plan === null) return '—';
    for (const w of campaign.plan.windows) {
      const d = w.devices.find((x) => x.name === data.name);
      if (d) return formatClock(deviceStart(d));
    }
    return campaign.plan.unplaced.includes(data.name) ? 'not placed' : '—';
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

  /** What neither the chain nor the check rows show. */
  function note(row: DeviceStatusRow): string {
    const view = stageView(row);
    if (view.steps[0].state === 'skipped') return 'already on the target release';
    if (!view.steps.some((s) => s.state === 'failed')) return '';
    // A refusing check says why in its own row.
    const refused = row.precheck.verdict === 'fail' || row.postcheck.verdict === 'fail';
    if (refused && view.rollback !== 'failed') return '';
    return stageDetail(row);
  }
</script>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

{#if data.device === null}
  <section class="card">
    <div class="empty-state">No device named {data.name}.</div>
  </section>
{:else}
  {@const device = data.device}
  {@const single = data.campaigns.length === 1}
  <section class="card hero">
    <div class="head">
      <DevicePicture />
      <div class="ident">
        <h1 title={`YANG: /fleet/device=${device.name}`}>{device.name}</h1>
        <p class="meta">
          type <span class="mono">{device.type}</span>
          {#if device.model}
            · model <span class="mono">{device.model}</span>
          {/if}
          {#if device.version}
            · version <span class="mono">{device.version}</span>
          {/if}
          {#if device.serialNumber}
            · serial number <span class="mono">{device.serialNumber}</span>
          {/if}
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
      {#if single}
        {@const row = statusRow(data.campaigns[0])}
        {#if row}
          <div class="status"><StatusPill status={row.status} raw={row.raw} /></div>
        {/if}
      {/if}
    </div>

    {#if data.campaigns.length === 0}
      <p class="none">Not a member of any campaign.</p>
    {/if}
    {#each data.campaigns as campaign (campaign.name)}
      {@const row = statusRow(campaign)}
      <div class="run">
        <div class="run-head">
          <div class="facts">
            <span class="fact">
              <span class="fact-label">Campaign</span>
              <a class="mono campaign-name" href={campaignHref(campaign)}>{campaign.name}</a>
            </span>
            <span class="fact">
              <span class="fact-label">Mode</span>
              <span class="mono">{campaign.adminState}</span>
            </span>
            <span class="fact">
              <span class="fact-label">Target release</span>
              <span class="mono">{campaign.targetRelease}</span>
            </span>
            <span class="fact">
              <span class="fact-label">Planned start</span>
              <span class="mono">{plannedStart(campaign)}</span>
            </span>
          </div>
          {#if !single && row}
            <div class="status"><StatusPill status={row.status} raw={row.raw} /></div>
          {/if}
        </div>
        {#if row}
          {@const text = note(row)}
          <div class="track"><StageChain {row} large /></div>
          {#if text}
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
        {/if}
      </div>
    {/each}
  </section>

  <section class="card">
    <h2 class="panel-title">Maintenance schedule</h2>
    <div class="binding">
      <select
        class="select binding-select"
        aria-label="Maintenance schedule"
        value={choice}
        disabled={savingSchedule}
        onchange={(e) => (picked = e.currentTarget.value)}
      >
        <option value="">{defaultLabel}</option>
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
  </section>
{/if}

<style>
  .hero {
    padding: 28px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 28px;
  }

  .ident {
    min-width: 0;
  }

  .ident h1 {
    font-size: var(--sw-text-3xl);
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }

  .meta {
    margin: 4px 0 0;
    color: var(--sw-text-secondary);
    font-size: var(--sw-text-md);
  }

  .status {
    margin-left: auto;
  }

  .status :global(.pill) {
    padding: 4px 12px;
    font-size: var(--sw-text-sm);
  }

  .none {
    margin: 24px 0 0;
    color: var(--sw-text-muted);
  }

  .run {
    margin-top: 24px;
  }

  .run + .run {
    padding-top: 24px;
    border-top: 1px solid var(--sw-border-subtle);
  }

  .run-head {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .facts {
    flex: 1;
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

  .campaign-name {
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .campaign-name:hover {
    color: var(--sw-accent);
  }

  .track {
    display: flex;
    justify-content: center;
    margin: 32px 0 28px;
  }

  .note {
    margin: -12px 0 20px;
    text-align: center;
    font-size: 13px;
    color: var(--sw-text-secondary);
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
    font-size: 13px;
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
    font-size: 13px;
    color: var(--sw-text-muted);
  }

  .binding {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .binding-select {
    width: min(100%, 260px);
  }

  .save-ok {
    font-size: 12px;
    color: var(--sw-text-secondary);
  }

  .save-error {
    font-size: 12px;
    color: var(--sw-danger-text);
  }

  @media (max-width: 720px) {
    .hero {
      padding: 20px 16px;
    }

    .head > :global(.device-picture) {
      display: none;
    }

    .ident h1 {
      font-size: var(--sw-text-2xl);
    }

    .track {
      margin: 24px 0 20px;
    }

    .check {
      grid-template-columns: auto auto 1fr auto;
    }

    .check-detail {
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .baseline {
      justify-self: start;
    }

    .at {
      grid-column: 4;
    }
  }
</style>
