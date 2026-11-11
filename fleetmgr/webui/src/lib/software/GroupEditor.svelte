<script lang="ts">
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
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
    byUpgradeOrder,
    devicesText,
    parsePriority,
    parseSeparation,
    priorityPatch,
    removeFromGroup,
    reorderPriorities,
    reorderedGroups,
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
    /** The other groups of the members, each in upgrade order. */
    otherGroups: Map<string, Device[]>;
    /** The campaigns each member is in. */
    campaignsOf: Map<string, string[]>;
    /** The group's entry, or the defaults. */
    separation: GroupSeparation;
    hasEntry: boolean;
    /** Every device of the fleet, sorted: what a member is picked from. */
    deviceNames: string[];
  }

  let { name, members, otherGroups, campaignsOf, separation, hasEntry, deviceNames }: Props = $props();

  const uid = $props.id();
  // What the new group page that sent us here did.
  const notice = takeNotice();
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let busy = $state(false);
  let page = $state(1);

  // A row dragged by its grip: the order while it moves, where the pointer
  // is and where it took the row. The order a drop made shows until it is
  // saved or called off.
  let drag = $state<{ name: string; order: string[]; y0: number; y: number; grab: number; moved: boolean } | null>(
    null
  );
  let pendingOrder = $state<string[] | null>(null);
  let byName = $derived(new Map(members.map((d) => [d.name, d])));
  let shown = $derived.by(() => {
    const order = drag?.order ?? pendingOrder;
    if (!order) return members;
    return order.map((n) => byName.get(n)).filter((d): d is Device => d !== undefined);
  });
  let paged = $derived(paginate(shown, page, PAGE_SIZE));
  let canMove = $derived(members.length > 1);
  let tbody = $state<HTMLElement | null>(null);

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

  const DRAG_PX = 4;

  function onGripDown(event: PointerEvent, member: Device): void {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    const top = (event.currentTarget as HTMLElement).closest('tr')?.getBoundingClientRect().top ?? event.clientY;
    const order = members.map((d) => d.name);
    drag = { name: member.name, order, y0: event.clientY, y: event.clientY, grab: event.clientY - top, moved: false };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', stopDrag);
    window.addEventListener('keydown', onDragKey);
  }

  /** The row goes where the pointer is among the other rows of the page. */
  function onPointerMove(event: PointerEvent): void {
    const d = drag;
    if (!d || !tbody) return;
    if (!d.moved && Math.abs(event.clientY - d.y0) < DRAG_PX) return;
    const rows = [...tbody.querySelectorAll<HTMLElement>('tr[data-member]')];
    const others = rows.map((r) => r.dataset.member ?? '').filter((n) => n !== d.name);
    const above = rows.filter((r) => {
      if (r.dataset.member === d.name) return false;
      const box = r.getBoundingClientRect();
      return event.clientY > box.top + box.height / 2;
    }).length;
    const start = (paged.page - 1) * PAGE_SIZE;
    const order = [
      ...d.order.slice(0, start),
      ...others.slice(0, above),
      d.name,
      ...others.slice(above),
      ...d.order.slice(start + rows.length)
    ];
    document.body.style.cursor = 'grabbing';
    drag = { ...d, moved: true, y: event.clientY, order: order.join('\n') === d.order.join('\n') ? d.order : order };
  }

  // The dragged row stays under the pointer between the places it passes.
  // offsetTop is its place in the table, without the transform.
  $effect(() => {
    const d = drag;
    if (!d?.moved || !tbody) return;
    const row = tbody.querySelector<HTMLElement>(`tr[data-member="${CSS.escape(d.name)}"]`);
    const table = row?.closest('table');
    if (!row || !table) return;
    row.style.transform = `translateY(${d.y - d.grab - table.getBoundingClientRect().top - row.offsetTop}px)`;
    return () => {
      row.style.transform = '';
    };
  });

  function onPointerUp(): void {
    const d = drag;
    stopDrag();
    if (d?.moved) void reorder(d.name, d.order);
  }

  function onDragKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') stopDrag();
  }

  function stopDrag(): void {
    drag = null;
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', stopDrag);
    window.removeEventListener('keydown', onDragKey);
  }

  // Leaving the page mid-drag drops the window listeners.
  $effect(() => stopDrag);

  /** The arrow keys on a grip move its row up or down by one. */
  function onGripKey(event: KeyboardEvent, member: Device): void {
    if (busy || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const order = members.map((d) => d.name);
    const k = order.indexOf(member.name);
    const to = event.key === 'ArrowUp' ? k - 1 : k + 1;
    if (to < 0 || to >= order.length) return;
    order.splice(k, 1);
    order.splice(to, 0, member.name);
    void reorder(member.name, order);
  }

  // A device has one priority for all its groups: a new order that moves
  // a member in another group asks first.
  let confirmReorder = $state<{ changes: Map<string, number>; groups: string[] } | null>(null);
  let reorderMessage = $derived.by(() => {
    if (!confirmReorder) return '';
    const { changes, groups } = confirmReorder;
    const names = groups.length > 5 ? `${groups.slice(0, 5).join(', ')} and ${groups.length - 5} more` : groups.join(', ');
    const what = changes.size === 1 ? `The new priority of ${[...changes.keys()][0]} also changes` : 'The new priorities also change';
    return `${what} the order in ${names}.`;
  });

  async function reorder(moved: string, order: string[]): Promise<void> {
    if (order.join('\n') === members.map((d) => d.name).join('\n')) return;
    await applyPriorities(reorderPriorities(members, order, moved), order);
  }

  // Priorities as typed, by device, until saved or called off.
  let drafts = $state.raw(new Map<string, string>());

  function setDraft(device: string, text: string | null): void {
    const next = new Map(drafts);
    if (text === null) next.delete(device);
    else next.set(device, text);
    drafts = next;
  }

  function dropDrafts(devices: Iterable<string>): void {
    const gone = new Set(devices);
    drafts = new Map([...drafts].filter(([d]) => !gone.has(d)));
  }

  /** Enter or leaving the field saves a typed priority that is valid. */
  function commitPriority(member: Device): void {
    const text = drafts.get(member.name);
    if (text === undefined || busy || confirmReorder !== null) return;
    const p = parsePriority(text);
    if (p === null) return;
    if (p === member.priority) {
      setDraft(member.name, null);
      return;
    }
    const moved = members.map((d) => (d.name === member.name ? { ...d, priority: p } : d));
    void applyPriorities(new Map([[member.name, p]]), moved.sort(byUpgradeOrder).map((d) => d.name));
  }

  /** Saves new priorities, after a question when they change the order of
   * another group; the members show in `order` meanwhile. */
  async function applyPriorities(changes: Map<string, number>, order: string[]): Promise<void> {
    pendingOrder = order;
    const groups = reorderedGroups(otherGroups, members, changes);
    if (groups.length > 0) {
      confirmReorder = { changes, groups };
      return;
    }
    await savePriorities(changes);
  }

  async function savePriorities(changes: Map<string, number>): Promise<void> {
    try {
      busy = true;
      statusMessage = null;
      await restconfPatchJson(DATA_ROOT, priorityPatch(changes));
      await invalidate('data:group');
      dropDrafts(changes.keys());
      const set = [...changes].map(([n, p]) => `${n} to ${p}`);
      statusMessage = { type: 'success', text: `Set the priority of ${set.join(', ')}.` };
    } catch (error) {
      statusMessage = { type: 'error', text: errorText(error, 'Failed to save the order.') };
    } finally {
      busy = false;
      pendingOrder = null;
    }
  }

  function cancelReorder(): void {
    if (confirmReorder) dropDrafts(confirmReorder.changes.keys());
    confirmReorder = null;
    pendingOrder = null;
  }

  async function confirmReorderSave(): Promise<void> {
    const c = confirmReorder;
    confirmReorder = null;
    if (c) await savePriorities(c.changes);
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
            {#if canMove}
              <th class="col-grip"><span class="sr-only">Move</span></th>
            {/if}
            <th class="right">#</th>
            <th>Device</th>
            <th class="right" title="Lower goes first. Type a value or drag a row.">Priority</th>
            <th class="col-platform">Model</th>
            <th class="col-platform">Version</th>
            <th>Campaigns</th>
            <th class="col-action"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody bind:this={tbody}>
          {#each paged.rows as member, i (member.name)}
            {@const campaigns = campaignsOf.get(member.name) ?? []}
            <tr
              data-member={member.name}
              class:dragging={drag?.moved && drag.name === member.name}
              animate:flip={{ duration: drag?.name === member.name ? 0 : 150 }}
            >
              {#if canMove}
                <td class="col-grip">
                  <button
                    class="grip"
                    type="button"
                    aria-label={`Move ${member.name}`}
                    title="Drag to change the upgrade order, or use the arrow keys"
                    disabled={busy}
                    onpointerdown={(e) => onGripDown(e, member)}
                    onkeydown={(e) => onGripKey(e, member)}
                  >
                    <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
                      <circle cx="2" cy="3" r="1.2" /><circle cx="6" cy="3" r="1.2" />
                      <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
                      <circle cx="2" cy="11" r="1.2" /><circle cx="6" cy="11" r="1.2" />
                    </svg>
                  </button>
                </td>
              {/if}
              <td class="tn right dim">{((paged.page - 1) * PAGE_SIZE + i + 1).toLocaleString()}</td>
              <td>
                <a class="device-name" href={`/devices/${encodeURIComponent(member.name)}`}>{member.name}</a>
              </td>
              <td class="tn right">
                <input
                  class="input compact mono prio"
                  class:has-error={drafts.has(member.name) && parsePriority(drafts.get(member.name) ?? '') === null}
                  type="text"
                  inputmode="numeric"
                  aria-label={`Priority of ${member.name}`}
                  title="0 to 65535, lower goes first"
                  value={drafts.get(member.name) ?? String(member.priority)}
                  disabled={busy}
                  oninput={(e) => setDraft(member.name, e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') commitPriority(member);
                    if (e.key === 'Escape') {
                      setDraft(member.name, null);
                      e.currentTarget.value = String(member.priority);
                    }
                  }}
                  onblur={() => commitPriority(member)}
                />
              </td>
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
  open={confirmReorder !== null}
  title="Change the order"
  message={reorderMessage}
  confirmLabel="Change"
  confirmClass="btn-primary"
  oncancel={cancelReorder}
  onconfirm={confirmReorderSave}
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

  .col-grip {
    width: 1%;
    padding-right: 0;
  }

  .grip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--sw-radius-sm);
    background: none;
    color: var(--sw-text-muted);
    fill: currentColor;
    cursor: grab;
    /* A touch drags the row instead of scrolling the page. */
    touch-action: none;
  }

  .grip:hover:not(:disabled),
  .grip:focus-visible {
    color: var(--sw-accent-bright);
    background: var(--sw-bg-elevated);
  }

  .grip:disabled {
    cursor: default;
    opacity: 0.5;
  }

  /* Lifted above the other rows, with a border drawn inside its cells: a
     collapsed table has no border of its own for a row. */
  tr.dragging {
    position: relative;
    z-index: 2;
  }

  tr.dragging td {
    background: var(--sw-bg-elevated);
    box-shadow:
      inset 0 2px 0 var(--sw-accent),
      inset 0 -2px 0 var(--sw-accent),
      0 12px 16px -12px rgb(0 0 0 / 0.8);
  }

  tr.dragging td:first-child {
    box-shadow:
      inset 2px 0 0 var(--sw-accent),
      inset 0 2px 0 var(--sw-accent),
      inset 0 -2px 0 var(--sw-accent),
      0 12px 16px -12px rgb(0 0 0 / 0.8);
  }

  tr.dragging td:last-child {
    box-shadow:
      inset -2px 0 0 var(--sw-accent),
      inset 0 2px 0 var(--sw-accent),
      inset 0 -2px 0 var(--sw-accent),
      0 12px 16px -12px rgb(0 0 0 / 0.8);
  }

  tr.dragging .grip {
    color: var(--sw-accent-bright);
    cursor: grabbing;
  }

  .input.prio {
    width: 5.5rem;
    padding: 4px 8px;
    text-align: right;
  }

  /* Quiet until hovered or focused, so the column reads like the numbers it
     holds; hover, focus and an error look as on any field. */
  .prio:not(:hover):not(:focus):not(.has-error) {
    background: transparent;
    border-color: var(--sw-border-subtle);
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
