<script lang="ts">
  import HeldText from '#lib/software/HeldText.svelte';
  import JobProgress from '#lib/software/JobProgress.svelte';
  import StageChain from '#lib/software/StageChain.svelte';
  import StatusPill from '#lib/software/StatusPill.svelte';
  import { PREPARE_COLOR } from '#lib/software/cells.ts';
  import { campaignDeviceHref } from '#lib/software/links.ts';
  import type { DeviceStatusRow } from '#lib/software/model.ts';
  import type { PrepareView } from '#lib/software/prepare.ts';
  import { jobDetail, jobProgress, stageDetail } from '#lib/software/stages.ts';
  import { formatDayClock } from '#lib/core/time.ts';

  interface Props {
    /** The campaign the rows are of: a device opens as it shows it. */
    campaign: string;
    rows: DeviceStatusRow[];
    /** With it, a Prepare column after the status: when the device
     * prepares ahead, how far it is, or how it went. It then carries the
     * image copy that Detail shows otherwise. */
    prepare?: Map<string, PrepareView> | null;
    /** Unix seconds, for the day of a prepare time. */
    now?: number;
  }

  let { campaign, rows, prepare = null, now = Date.now() / 1000 }: Props = $props();

  /** Whether the Prepare column tells the row's prepare. */
  function inPrepareColumn(row: DeviceStatusRow): boolean {
    return prepare?.has(row.device) === true && row.status === 'upgrade-needed';
  }

  /** What the device's job says, less what the Prepare column already
   * says: of a prepare there, only why it failed. */
  function jobText(row: DeviceStatusRow): string {
    if (!inPrepareColumn(row)) return jobDetail(row);
    return row.prepare.state === 'failed' ? row.prepare.message || 'prepare failed' : '';
  }

  function detail(row: DeviceStatusRow): string {
    return (inPrepareColumn(row) ? jobText(row) : stageDetail(row)) || '—';
  }
</script>

<div class="table-wrap">
  <table class="dense">
    <thead>
      <tr>
        <th class="device">Device</th>
        <th class="status">Status</th>
        {#if prepare}
          <th class="prep">Prepare</th>
        {/if}
        <th><StageChain /></th>
        <th>Model</th>
        <th>Version</th>
        <th>Detail</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.device)}
        {@const ahead = prepare?.get(row.device) ?? null}
        {@const progress = prepare && ahead ? null : jobProgress(row)}
        <tr>
          <td><a class="device-name" href={campaignDeviceHref(campaign, row.device)}>{row.device}</a></td>
          <td><StatusPill status={row.status} raw={row.raw} /></td>
          {#if prepare}
            <td class="prep">
              {#if ahead === null || ahead.state === 'released'}
                <span class="muted">—</span>
              {:else if ahead.state === 'scheduled'}
                <span class="mono muted">{formatDayClock(ahead.start, now)}</span>
              {:else if ahead.state === 'preparing' && ahead.progress !== null}
                <span class="transfer prep-transfer" style:--sw-accent={PREPARE_COLOR.preparing}>
                  <JobProgress value={ahead.progress} label={`Image copy to ${row.device}`} />
                  <span class="mono percent">{ahead.progress}%</span>
                </span>
              {:else}
                <span class="tag" class:warn={ahead.state === 'failed'}>
                  <span class="sq" style:background={PREPARE_COLOR[ahead.state]}></span>
                  {ahead.state === 'failed' ? 'failed, copies in window' : ahead.state}
                </span>
              {/if}
            </td>
          {/if}
          <td><StageChain {row} /></td>
          <td>
            {#if row.model}
              <span class="pill mono">{row.model}</span>
            {:else}
              —
            {/if}
          </td>
          <td class="mono">{row.version || '—'}</td>
          <td class="detail">
            {#if progress !== null}
              <span class="transfer">
                <JobProgress value={progress} label={`Image transfer to ${row.device}`} />
                <span class="mono percent">{progress}%</span>
              </span>
            {/if}
            {#if row.held !== null}
              <!-- A member held before its window may prepare ahead of it. -->
              {@const doing = jobText(row)}
              <span class="held">held:</span> <HeldText {row} {campaign} />{#if doing}{` · ${doing}`}{/if}
            {:else}
              {detail(row)}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  td {
    white-space: nowrap;
  }

  /* Fixed first columns, so tables over different devices line up. */
  .device {
    width: 110px;
  }

  .status {
    width: 120px;
  }

  .prep {
    width: 170px;
  }

  .muted {
    color: var(--sw-text-muted);
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--sw-text-secondary);
  }

  .tag.warn {
    color: var(--sw-warning);
  }

  .sq {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  /* The copy ahead, in the prepare row's colour rather than the accent
     of a device at work in its window. */
  .transfer.prep-transfer {
    width: 150px;
    margin-bottom: 0;
  }

  .device-name {
    font-weight: 600;
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .device-name:hover {
    color: var(--sw-accent);
  }

  /* Takes the spare width, but never so little that a long check result
     turns into a column of single words when the table scrolls. */
  .held {
    color: var(--sw-warning);
  }

  .detail {
    width: 100%;
    min-width: 18rem;
    color: var(--sw-text-secondary);
    white-space: normal;
  }

  /* The bar above the line that says what the device does. */
  .transfer {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 18rem;
    margin-bottom: 4px;
  }

  .transfer > :global(.bar) {
    flex: 1;
  }

  .percent {
    font-size: var(--sw-text-2xs);
    color: var(--sw-text-muted);
  }
</style>
