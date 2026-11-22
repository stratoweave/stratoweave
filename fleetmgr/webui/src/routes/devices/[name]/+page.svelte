<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate, goto, invalidate } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { onLoaded } from '#lib/core/loading.svelte.ts';
  import { leaveNotice } from '#lib/core/notice.ts';
  import { createPoller } from '#lib/core/polling/poller.ts';
  import { getListEntryPath, restconfDelete } from '#lib/core/restconf/client.ts';
  import { formatClock } from '#lib/core/time.ts';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import { campaignsText } from '#lib/maintenance/schedule-form.ts';
  import ConnectionDot from '#lib/software/ConnectionDot.svelte';
  import DeviceLog from '#lib/software/DeviceLog.svelte';
  import DeviceSettings from '#lib/software/DeviceSettings.svelte';
  import { campaignDeviceHref } from '#lib/software/links.ts';
  import { FLEET_DEVICE_LIST_ROOT, STATUS_LABEL, modeLabel } from '#lib/software/model.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  // null until their reads are in; a poll keeps what is shown until then.
  let deviceLoad = $state.raw<Awaited<typeof data.device> | null>(null);
  let campaignsLoad = $state.raw<Awaited<typeof data.campaigns> | null>(null);
  // A read that failed once the device shows: what shows stays, with
  // the edits in it.
  let pollError = $state('');
  onLoaded(
    () => data.device,
    (value) => {
      if (value.loadError && deviceLoad?.device) {
        pollError = value.loadError;
        return;
      }
      pollError = '';
      deviceLoad = value;
    }
  );
  onLoaded(() => data.campaigns, (value) => (campaignsLoad = value));
  /** undefined while loading, null when there is no such device. */
  let device = $derived(deviceLoad?.device);
  let config = $derived(deviceLoad?.config ?? null);
  let campaigns = $derived(campaignsLoad?.campaigns ?? []);

  let confirmDelete = $state(false);
  let deleting = $state(false);
  let deleteError = $state('');
  // Whether the settings have changes to save, and where the operator
  // asked to go with them unsaved.
  let dirty = $state(false);
  let unsaved = $derived(!!device && !!config && dirty);
  let leaveTo = $state<URL | null>(null);
  let leaving = false;

  let deleteMessage = $derived.by(() => {
    const text = `Delete ${data.name} from the fleet? The orchestrator disconnects from it.`;
    if (campaignsLoad?.loadError) return `${text} Its campaigns could not be read.`;
    if (campaigns.length === 0) return text;
    const one = campaigns.length === 1;
    return `${text} ${campaignsText(campaigns.map((c) => c.name))} ${one ? 'keeps' : 'keep'} it as a member but can no longer upgrade it.`;
  });

  // Leaving drops the changes, so it is asked first. A reload or a closed
  // tab gets the browser's own question.
  beforeNavigate(({ cancel, to, willUnload }) => {
    if (!unsaved || leaving) return;
    cancel();
    if (!willUnload && to) leaveTo = to.url;
  });

  function leave(): void {
    const to = leaveTo;
    leaveTo = null;
    if (!to) return;
    leaving = true;
    void goto(to);
  }

  async function handleDelete(): Promise<void> {
    try {
      deleting = true;
      deleteError = '';
      await restconfDelete(getListEntryPath(FLEET_DEVICE_LIST_ROOT, data.name));
      leaving = true;
      leaveNotice(`Deleted device ${data.name}.`);
      await goto('/devices');
    } catch (error) {
      deleteError = errorText(error, 'Failed to delete the device.');
    } finally {
      deleting = false;
      confirmDelete = false;
    }
  }

  /** For the settings: reads the device again and waits for it. */
  async function reloadDevice(): Promise<void> {
    await invalidate('data:device');
    await data.device;
  }

  onMount(() => {
    // Waits for the reads: loads return before them, and a slow top must
    // not be asked again before it answered.
    const poller = createPoller(async () => {
      await invalidate('data:device');
      await Promise.all([data.device, data.campaigns]);
    }, 5000);
    poller.start();
    return () => poller.stop();
  });
</script>

{#if deviceLoad === null}
  <div class="page-header">
    <div>
      <h1>{data.name}</h1>
      <p aria-busy="true">Loading…</p>
    </div>
  </div>
{:else if deviceLoad.loadError}
  <LoadError message={deviceLoad.loadError} />
{:else if !device || !config}
  <section class="card">
    <div class="empty-state">No device named {data.name}.</div>
  </section>
{:else}
  <div class="page-header">
    <div>
      <h1 title={`YANG: /fleet/device=${device.name}`}>{device.name}</h1>
      <p class="summary">
        <ConnectionDot connection={device.connection} text />
        {#if device.model}
          · model <span class="mono">{device.model}</span>
        {/if}
        {#if device.version}
          · version <span class="mono">{device.version}</span>
        {/if}
        {#if device.serialNumber}
          · serial number <span class="mono">{device.serialNumber}</span>
        {/if}
        {#if deviceLoad.lastBoot !== null}
          · last boot <span class="mono">{formatClock(deviceLoad.lastBoot)}</span>
        {/if}
      </p>
      <div class="campaigns">
        {#if campaignsLoad === null}
          <span aria-busy="true">Loading campaigns…</span>
        {:else if campaignsLoad.loadError}
          <LoadError message={`Its campaigns could not be read. ${campaignsLoad.loadError}`} />
        {:else if campaigns.length === 0}
          Not in any campaign.
        {:else}
          In
          {#each campaigns as campaign, i (campaign.name)}
            {#if i > 0}{i === campaigns.length - 1 ? ' and' : ','}{/if}
            <a class="mono campaign-link" href={campaignDeviceHref(campaign.name, device.name)}>{campaign.name}</a>
            ({STATUS_LABEL[campaign.row.status]} · {modeLabel(campaign.adminState, campaign.runSince)})
          {/each}
        {/if}
      </div>
    </div>
    <div class="page-actions">
      <button
        class="btn btn-secondary btn-danger-ghost"
        type="button"
        disabled={deleting}
        onclick={() => (confirmDelete = true)}
      >
        Delete
      </button>
    </div>
  </div>

  <!-- In place before any message, so that a screen reader reads each one. -->
  <div role="alert">
    {#if deleteError}
      <div class="error-state status">{deleteError}</div>
    {/if}
  </div>
  {#if pollError}
    <LoadError message={pollError} />
  {/if}

  {#key data.name}
    <DeviceSettings
      {device}
      {config}
      schedules={deviceLoad.schedules}
      campaigns={campaignsLoad}
      reload={reloadDevice}
      bind:dirty
    />
  {/key}

  {#key data.name}
    <DeviceLog name={data.name} />
  {/key}
{/if}

<ConfirmDialog
  open={confirmDelete}
  title="Delete device"
  message={deleteMessage}
  confirmLabel={deleting ? 'Deleting…' : 'Delete'}
  confirmClass="btn-danger"
  oncancel={() => (confirmDelete = false)}
  onconfirm={handleDelete}
/>

<ConfirmDialog
  open={leaveTo !== null}
  title="Discard unsaved changes?"
  message="Your changes are not saved."
  confirmLabel="Discard"
  cancelLabel="Keep editing"
  confirmClass="btn-danger"
  oncancel={() => (leaveTo = null)}
  onconfirm={leave}
/>

<style>
  .summary {
    color: var(--sw-text-muted);
  }

  .campaigns {
    margin-top: var(--sw-space-1);
    font-size: var(--sw-text-sm);
    color: var(--sw-text-muted);
  }

  .campaigns :global(.load-error) {
    margin: 0;
    padding: var(--sw-space-1) var(--sw-space-3);
    font-size: var(--sw-text-sm);
  }

  .campaign-link {
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .campaign-link:hover {
    color: var(--sw-accent);
  }
</style>
