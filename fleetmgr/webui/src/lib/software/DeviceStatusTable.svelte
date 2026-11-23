<script lang="ts">
  import HeldText from '#lib/software/HeldText.svelte';
  import JobProgress from '#lib/software/JobProgress.svelte';
  import StageChain from '#lib/software/StageChain.svelte';
  import StatusPill from '#lib/software/StatusPill.svelte';
  import { campaignDeviceHref } from '#lib/software/links.ts';
  import type { DeviceStatusRow } from '#lib/software/model.ts';
  import { jobDetail, jobProgress, stageDetail } from '#lib/software/stages.ts';

  interface Props {
    /** The campaign the rows are of: a device opens as it shows it. */
    campaign: string;
    rows: DeviceStatusRow[];
  }

  let { campaign, rows }: Props = $props();
</script>

<div class="table-wrap">
  <table class="dense">
    <thead>
      <tr>
        <th class="device">Device</th>
        <th class="status">Status</th>
        <th><StageChain /></th>
        <th>Model</th>
        <th>Version</th>
        <th>Detail</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.device)}
        {@const progress = jobProgress(row)}
        <tr>
          <td><a class="device-name" href={campaignDeviceHref(campaign, row.device)}>{row.device}</a></td>
          <td><StatusPill status={row.status} raw={row.raw} /></td>
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
              {@const doing = jobDetail(row)}
              <span class="held">held:</span> <HeldText {row} {campaign} />{#if doing}{` · ${doing}`}{/if}
            {:else}
              {stageDetail(row) || '—'}
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
