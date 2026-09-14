<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { invalidate } from '$app/navigation';

  import StatusPill from '$lib/software/StatusPill.svelte';
  import { createPoller } from '$lib/core/polling/poller';
  import type { Campaign, Device } from '$lib/software/model';

  let {
    data
  }: { data: { name: string; device: Device | null; campaigns: Campaign[]; loadError: string } } =
    $props();

  let statusMessage = $state<string>(untrack(() => data.loadError));

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
</script>

{#if statusMessage}
  <div class="error-state status">{statusMessage}</div>
{/if}

{#if data.device === null}
  <section class="card">
    <div class="empty-state">No device named {data.name}.</div>
  </section>
{:else}
  {@const device = data.device}
  <div class="page-header">
    <div>
      <div class="kick mono">/fleet/device={device.name}</div>
      <h2>{device.name}</h2>
      <p class="meta">
        type <span class="mono">{device.type}</span>
        {#if device.hardwareModel}
          · hardware <span class="mono">{device.hardwareModel}{device.hardwareRevision ? ` ${device.hardwareRevision}` : ''}</span>
        {/if}
        {#if device.address}
          · OOB <span class="mono">{device.address}</span>
        {/if}
        {#if device.description}
          · {device.description}
        {/if}
      </p>
    </div>
  </div>

  <section class="card">
    <h3 class="panel-title">Campaign membership</h3>
    {#if data.campaigns.length === 0}
      <div class="empty-state">Not a member of any campaign.</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Target release</th>
              <th>admin-state</th>
              <th>Status</th>
              <th>Running release</th>
            </tr>
          </thead>
          <tbody>
            {#each data.campaigns as campaign (campaign.name)}
              {@const row = statusRow(campaign)}
              <tr>
                <td>
                  <a class="campaign-name mono" href={campaignHref(campaign)}>{campaign.name}</a>
                </td>
                <td class="mono tn">{campaign.targetRelease}</td>
                <td>
                  <span class="pill" class:pill-run={campaign.adminState === 'run'} class:muted={campaign.adminState === 'plan'}>
                    <span class="dot"></span>
                    {campaign.adminState}
                  </span>
                </td>
                <td>
                  {#if row}
                    <StatusPill status={row.status} raw={row.raw} />
                  {:else}
                    —
                  {/if}
                </td>
                <td class="mono tn">{row?.runningRelease || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <p class="hint">
      Job steps, pre/post-check verdicts and the adapter log are modelled southbound but not
      published yet — this page grows as they land.
    </p>
  </section>
{/if}

<style>
  .status {
    margin-bottom: 12px;
  }

  .card {
    padding: 20px;
    margin-bottom: 16px;
  }

  .meta {
    margin: 4px 0 0;
    color: var(--sw-text-secondary);
    font-size: 13px;
  }

  .panel-title {
    margin: 0 0 12px;
    font-size: 14px;
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
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--sw-text-muted);
    padding: 9px 10px;
    border-bottom: 1px solid var(--sw-border-subtle);
    white-space: nowrap;
  }

  td {
    padding: 11px 10px;
    border-bottom: 1px solid rgba(226, 232, 240, 0.07);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .campaign-name {
    color: #93b4fc;
    text-decoration: none;
  }

  .campaign-name:hover {
    color: var(--sw-accent);
  }

  .hint {
    margin: 14px 0 0;
    font-size: 12px;
    color: var(--sw-text-muted);
  }

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
  }

  .tn {
    font-variant-numeric: tabular-nums;
  }
</style>
