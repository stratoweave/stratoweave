<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, invalidate } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { leaveNotice, takeNotice } from '#lib/core/notice.ts';
  import { getListEntryPath, restconfDelete, restconfPatchJson } from '#lib/core/restconf/client.ts';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import Pager, { paginate } from '#lib/core/ui/Pager.svelte';
  import SegmentedControl from '#lib/core/ui/SegmentedControl.svelte';
  import TokenSelect from '#lib/core/ui/TokenSelect.svelte';
  import { formatDuration } from '#lib/core/time.ts';
  import {
    addMembersPatch,
    devicesText,
    parseSeparation,
    removeFromGroup,
    separationPatch,
    suggestNames
  } from '#lib/software/groups.ts';
  import {
    DATA_ROOT,
    REDUNDANCY_GROUP_LIST_ROOT,
    type Device,
    type GroupSeparation,
    type SeparationPolicy
  } from '#lib/software/model.ts';

  const PAGE_SIZE = 100;
  const POLICIES: { value: SeparationPolicy; label: string }[] = [
    { value: 'spread', label: 'spread' },
    { value: 'pack', label: 'pack' }
  ];

  interface Props {
    name: string;
    /** In upgrade order. */
    members: Device[];
    /** The campaigns each member is in. */
    campaignsOf: Map<string, string[]>;
    /** The group's entry, or the defaults. */
    separation: GroupSeparation;
    hasEntry: boolean;
    /** Every device of the fleet, sorted: what a member is picked from. */
    deviceNames: string[];
  }

  let { name, members, campaignsOf, separation, hasEntry, deviceNames }: Props = $props();

  const uid = $props.id();
  // What the new group page that sent us here did.
  const notice = takeNotice();
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let busy = $state(false);
  let page = $state(1);
  let paged = $derived(paginate(members, page, PAGE_SIZE));

  onMount(() => {
    if (notice) statusMessage = { type: 'success', text: notice };
  });

  // Devices to add, picked by name from the fleet.
  let adding = $state<string[]>([]);
  let addDraft = $state('');
  let memberNames = $derived(new Set(members.map((d) => d.name)));
  let knownNames = $derived(new Set(deviceNames));
  let addOptions = $derived(
    suggestNames(deviceNames, addDraft, new Set([...memberNames, ...adding])).map((value) => ({ value }))
  );
  let addError = $derived.by(() => {
    // A PATCH for a name the fleet lacks would add a device without a type.
    const unknown = adding.find((n) => !knownNames.has(n));
    return unknown === undefined ? '' : `No device named ${unknown}.`;
  });

  async function addMembers(): Promise<void> {
    // A name typed but not added yet counts.
    const typed = addDraft.trim();
    if (typed && !adding.includes(typed)) adding = [...adding, typed];
    addDraft = '';
    const fresh = adding.filter((n) => !memberNames.has(n));
    if (addError || fresh.length === 0) return;
    try {
      busy = true;
      statusMessage = null;
      await restconfPatchJson(DATA_ROOT, addMembersPatch(name, fresh));
      adding = [];
      statusMessage = { type: 'success', text: `Added ${fresh.join(', ')}.` };
      await invalidate('data:group');
    } catch (error) {
      statusMessage = { type: 'error', text: errorText(error, 'Failed to add the devices.') };
    } finally {
      busy = false;
    }
  }

  let removeTarget = $state<Device | null>(null);

  async function removeMember(): Promise<void> {
    const target = removeTarget;
    removeTarget = null;
    if (!target) return;
    try {
      busy = true;
      statusMessage = null;
      await removeFromGroup(target.name, name);
      statusMessage = { type: 'success', text: `Removed ${target.name}.` };
      await invalidate('data:group');
    } catch (error) {
      statusMessage = { type: 'error', text: errorText(error, `Failed to remove ${target.name}.`) };
    } finally {
      busy = false;
    }
  }

  // null follows the group as loaded; an edit holds until it is saved.
  let policyPick = $state<SeparationPolicy | null>(null);
  let separationText = $state<string | null>(null);
  let separationMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let policy = $derived(policyPick ?? separation.policy);
  let typedSeparation = $derived(
    separationText ?? (separation.minSeparation > 0 ? formatDuration(separation.minSeparation) : '')
  );
  let minSeparation = $derived(parseSeparation(typedSeparation));
  let separationChanged = $derived(
    policy !== separation.policy ||
      (minSeparation !== null && minSeparation !== separation.minSeparation)
  );

  async function saveSeparation(): Promise<void> {
    if (minSeparation === null) return;
    try {
      busy = true;
      separationMessage = null;
      await restconfPatchJson(DATA_ROOT, separationPatch({ name, policy, minSeparation }));
      await invalidate('data:group');
      policyPick = null;
      separationText = null;
      separationMessage = { type: 'success', text: 'Saved.' };
    } catch (error) {
      separationMessage = { type: 'error', text: errorText(error, 'Failed to save the separation.') };
    } finally {
      busy = false;
    }
  }

  let confirmDelete = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);

  // A device leaves a group by a write of its own, so the members go one
  // at a time, then the entry.
  async function deleteGroup(): Promise<void> {
    confirmDelete = false;
    const names = members.map((d) => d.name);
    let done = 0;
    let current = '';
    try {
      busy = true;
      statusMessage = null;
      progress = { done, total: names.length };
      for (const device of names) {
        current = device;
        await removeFromGroup(device, name);
        done += 1;
        progress = { done, total: names.length };
      }
      current = '';
      if (hasEntry) await restconfDelete(getListEntryPath(REDUNDANCY_GROUP_LIST_ROOT, name));
      leaveNotice(`Deleted group ${name}.`);
      // Not a preload made before the writes.
      await goto('/groups', { refreshAll: true });
    } catch (error) {
      const reason = errorText(error, 'the write failed');
      statusMessage = {
        type: 'error',
        text: current
          ? `Removed ${done} of ${devicesText(names.length)}; ${current} failed: ${reason}`
          : `Failed to delete the entry: ${reason}`
      };
      await invalidate('data:group');
    } finally {
      busy = false;
      progress = null;
    }
  }

  let deleteMessage = $derived(
    members.length > 0
      ? `Delete ${name}? Its ${devicesText(members.length)} leave the group, one write each.`
      : `Delete ${name}?`
  );
</script>

<div class="page-header">
  <div>
    <h1 class="mono" title={`YANG: /redundancy-groups/redundancy-group=${name}`}>{name}</h1>
  </div>
  <div class="page-actions">
    {#if members.length > 0 || hasEntry}
      <button
        class="btn btn-secondary btn-danger-ghost"
        type="button"
        disabled={busy}
        onclick={() => (confirmDelete = true)}
      >
        Delete
      </button>
    {/if}
  </div>
</div>

{#if progress}
  <div class="success-banner status">
    Removing the group from {Math.min(progress.done + 1, progress.total)} of {devicesText(progress.total)}…
  </div>
{:else if statusMessage}
  <div class={statusMessage.type === 'error' ? 'error-state status' : 'success-banner status'}>
    {statusMessage.text}
  </div>
{/if}

<section class="card">
  <h2 class="panel-title">Members</h2>
  {#if members.length === 0}
    <div class="empty-state">No members.</div>
  {:else}
    <div class="table-wrap">
      <table class="dense">
        <thead>
          <tr>
            <th class="right">#</th>
            <th>Device</th>
            <th class="right" title="Lower goes first. Set on the device page.">Priority</th>
            <th class="col-platform">Model</th>
            <th class="col-platform">Version</th>
            <th>Campaigns</th>
            <th class="col-action"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each paged.rows as member, i (member.name)}
            {@const campaigns = campaignsOf.get(member.name) ?? []}
            <tr>
              <td class="tn right dim">{((paged.page - 1) * PAGE_SIZE + i + 1).toLocaleString()}</td>
              <td>
                <a class="device-name" href={`/devices/${encodeURIComponent(member.name)}`}>{member.name}</a>
              </td>
              <td class="tn right mono">{member.priority}</td>
              <td class="col-platform">
                {#if member.model}
                  <span class="pill mono">{member.model}</span>
                {:else}
                  <span class="dim">—</span>
                {/if}
              </td>
              <td class="mono col-platform">{member.version || '—'}</td>
              <td>
                {#each campaigns as campaign, j (campaign)}
                  {#if j > 0}<span class="dim">, </span>{/if}
                  <a class="campaign-name mono" href={`/campaigns/${encodeURIComponent(campaign)}`}>{campaign}</a>
                {:else}
                  <span class="dim">—</span>
                {/each}
              </td>
              <td class="col-action">
                <button
                  class="btn btn-ghost btn-sm row-remove on-row"
                  type="button"
                  aria-label={`Remove ${member.name}`}
                  disabled={busy}
                  onclick={() => (removeTarget = member)}
                >
                  Remove
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (page = p)} />
  {/if}
  <div class="add-row">
    <TokenSelect
      id={`${uid}-add`}
      options={addOptions}
      selected={adding}
      label="Add devices"
      placeholder="add device"
      suggest={true}
      invalid={!!addError}
      describedby={`${uid}-add-meta`}
      bind:draft={addDraft}
      onchange={(next) => (adding = next)}
    >
      <button
        class="btn btn-secondary"
        type="button"
        disabled={busy || !!addError || (adding.length === 0 && !addDraft.trim())}
        onclick={addMembers}
      >
        Add
      </button>
    </TokenSelect>
    <small id={`${uid}-add-meta`} class="field__meta" class:field__meta--error={!!addError}>{addError || ' '}</small>
  </div>
</section>

<section class="card">
  <h2 class="panel-title" title="YANG: separation-policy, min-separation">Separation</h2>
  <div class="separation">
    <SegmentedControl
      options={POLICIES}
      value={policy}
      ariaLabel="Separation policy"
      onchange={(next) => (policyPick = next)}
    />
    <label class="dim" for={`${uid}-min`}>Min separation</label>
    <input
      id={`${uid}-min`}
      class="input compact mono min"
      class:has-error={minSeparation === null}
      aria-invalid={minSeparation === null ? 'true' : undefined}
      placeholder="e.g. 30m"
      value={typedSeparation}
      disabled={busy}
      oninput={(e) => (separationText = e.currentTarget.value)}
    />
    <button
      class="btn btn-primary"
      type="button"
      disabled={busy || !separationChanged || minSeparation === null}
      onclick={saveSeparation}
    >
      Save
    </button>
    {#if minSeparation === null}
      <span class="save-error">A duration such as 30m or 2h.</span>
    {:else if separationMessage}
      <span class={separationMessage.type === 'error' ? 'save-error' : 'save-ok'}>{separationMessage.text}</span>
    {/if}
  </div>
</section>

<ConfirmDialog
  open={removeTarget !== null}
  title="Remove from group"
  message={`Remove ${removeTarget?.name ?? ''} from ${name}?`}
  confirmLabel="Remove"
  confirmClass="btn-danger"
  oncancel={() => (removeTarget = null)}
  onconfirm={removeMember}
/>

<ConfirmDialog
  open={confirmDelete}
  title="Delete group"
  message={deleteMessage}
  confirmLabel="Delete"
  confirmClass="btn-danger"
  oncancel={() => (confirmDelete = false)}
  onconfirm={deleteGroup}
/>

<style>
  .device-name {
    font-weight: 600;
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .device-name:hover,
  .campaign-name:hover {
    color: var(--sw-accent);
  }

  .campaign-name {
    color: var(--sw-accent-bright);
    text-decoration: none;
    font-size: var(--sw-text-sm);
  }

  .col-action {
    width: 1%;
    text-align: right;
    white-space: nowrap;
  }

  .dim {
    color: var(--sw-text-muted);
  }

  .add-row {
    margin-top: 14px;
  }

  .separation {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .min {
    width: 8rem;
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
    .col-platform {
      display: none;
    }

    .device-name,
    .campaign-name {
      white-space: nowrap;
    }
  }
</style>
