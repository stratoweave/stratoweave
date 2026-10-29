<script lang="ts">
  import StageChain from '$lib/software/StageChain.svelte';
  import StatusPill from '$lib/software/StatusPill.svelte';
  import type { DeviceStatusRow } from '$lib/software/model';
  import { stageDetail } from '$lib/software/stages';

  interface Props {
    rows: DeviceStatusRow[];
  }

  let { rows }: Props = $props();
</script>

<div class="table-wrap">
  <table class="dense">
    <thead>
      <tr>
        <th class="device">Device</th>
        <th class="status">Status</th>
        <th><StageChain /></th>
        <th>Version</th>
        <th>Detail</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.device)}
        <tr>
          <td><a class="device-name" href={`/devices/${encodeURIComponent(row.device)}`}>{row.device}</a></td>
          <td><StatusPill status={row.status} raw={row.raw} /></td>
          <td><StageChain {row} /></td>
          <td class="mono">{row.version || '—'}</td>
          <td class="detail">{stageDetail(row) || '—'}</td>
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
  .detail {
    width: 100%;
    min-width: 18rem;
    color: var(--sw-text-secondary);
    white-space: normal;
  }
</style>
