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
  <table>
    <thead>
      <tr>
        <th class="device">Device</th>
        <th class="status">Status</th>
        <th><StageChain /></th>
        <th>Running release</th>
        <th>Detail</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.device)}
        <tr>
          <td><span class="device-name">{row.device}</span></td>
          <td><StatusPill status={row.status} raw={row.raw} /></td>
          <td><StageChain {row} /></td>
          <td class="mono">{row.runningRelease || '—'}</td>
          <td class="detail">{stageDetail(row) || '—'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
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
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: none;
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
  }

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
  }

  .detail {
    width: 100%;
    color: var(--sw-text-secondary);
    white-space: normal;
  }
</style>
