<script lang="ts">
  import { onMount } from 'svelte';

  import { errorText } from '#lib/core/errors.ts';
  import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
  import TokenSelect from '#lib/core/ui/TokenSelect.svelte';
  import {
    around,
    byUpgradeOrder,
    devicesText,
    groupMembers,
    parsePriority,
    saveMembership,
    suggestNames
  } from '#lib/software/groups.ts';
  import {
    FLEET_ROOT,
    REDUNDANCY_GROUPS_ROOT,
    parseFleet,
    parseGroupSeparations,
    type Device
  } from '#lib/software/model.ts';

  interface Props {
    /** As the page polls it. */
    device: Device;
    /** Reads the device again; resolves once the page shows the new read. */
    reload: () => Promise<void>;
  }

  let { device, reload }: Props = $props();

  const uid = $props.id();
  // More groups than this pick from suggestions instead of toggles.
  const TOGGLE_MAX = 16;

  // The other devices and the group entries, for the suggestions and the
  // order. Read on mount and after a save, not on every poll of the page:
  // at 30k devices the fleet is 14 MB.
  let fleet = $state.raw<Device[]>([]);
  let entryNames = $state.raw<string[]>([]);
  let readError = $state('');

  // null follows the device as polled; an edit holds until it is saved.
  let picked = $state<string[] | null>(null);
  let priorityText = $state<string | null>(null);
  let draft = $state('');
  let saving = $state(false);
  let message = $state<{ type: 'success' | 'error'; text: string } | null>(null);

  let groups = $derived(picked ?? device.groups);
  let typedPriority = $derived(priorityText ?? String(device.priority));
  let priority = $derived(parsePriority(typedPriority));
  let changed = $derived(
    !!draft.trim() ||
      priority !== device.priority ||
      groups.length !== device.groups.length ||
      groups.some((g) => !device.groups.includes(g))
  );

  let members = $derived(groupMembers(fleet));
  // Every group with how many devices it has, this device as polled.
  let allOptions = $derived.by(() => {
    const names = [...new Set([...members.keys(), ...entryNames, ...device.groups])];
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return names.map((value) => {
      const others = (members.get(value) ?? []).filter((d) => d.name !== device.name).length;
      return { value, count: others + (device.groups.includes(value) ? 1 : 0) };
    });
  });
  let many = $derived(allOptions.length > TOGGLE_MAX);
  let options = $derived.by(() => {
    if (!many) return allOptions;
    const shown = new Set(suggestNames(allOptions.map((o) => o.value), draft, new Set(groups)));
    return allOptions.filter((o) => shown.has(o.value));
  });

  /** The members of group in upgrade order, this device as polled. */
  function orderOf(group: string): Device[] {
    const others = (members.get(group) ?? []).filter((d) => d.name !== device.name);
    return [...others, device].sort(byUpgradeOrder);
  }

  async function readContext(): Promise<void> {
    try {
      const [fleetJson, groupsJson] = await Promise.all([
        restconfGetCachedOrNull<unknown>(FLEET_ROOT),
        restconfGetOrNull<unknown>(REDUNDANCY_GROUPS_ROOT)
      ]);
      fleet = parseFleet(fleetJson).devices;
      entryNames = parseGroupSeparations(groupsJson).map((s) => s.name);
      readError = '';
    } catch (error) {
      readError = errorText(error, 'Failed to read the other groups.');
    }
  }

  onMount(() => {
    void readContext();
  });

  async function save(): Promise<void> {
    // A name typed but not added yet counts.
    const typed = draft.trim();
    const next = typed && !groups.includes(typed) ? [...groups, typed] : groups;
    if (priority === null) return;
    try {
      saving = true;
      message = null;
      await saveMembership(
        device.name,
        { groups: device.groups, priority: device.priority },
        { groups: next, priority }
      );
      // The edit shows until the read after the write is in.
      await reload();
      picked = null;
      priorityText = null;
      draft = '';
      message = { type: 'success', text: 'Saved.' };
      void readContext();
    } catch (saveError) {
      message = { type: 'error', text: errorText(saveError, 'Failed to save the groups.') };
    } finally {
      saving = false;
    }
  }
</script>

<section class="card">
  <h2 class="panel-title" title="YANG: /fleet/device/redundancy-group">Redundancy groups</h2>
  <TokenSelect
    {options}
    selected={groups}
    label="Redundancy groups"
    placeholder="add group"
    suggest={many}
    countLabel={devicesText}
    bind:draft
    onchange={(next) => (picked = next)}
  />
  <div class="save-row">
    <label class="dim" for={`${uid}-priority`}>Priority</label>
    <input
      id={`${uid}-priority`}
      class="input compact mono priority"
      class:has-error={priority === null}
      inputmode="numeric"
      aria-invalid={priority === null ? 'true' : undefined}
      value={typedPriority}
      disabled={saving}
      oninput={(e) => (priorityText = e.currentTarget.value)}
    />
    <button class="btn btn-primary" type="button" disabled={saving || !changed || priority === null} onclick={save}>
      {saving ? 'Saving…' : 'Save'}
    </button>
    {#if priority === null}
      <span class="save-error">0 to 65535, lower goes first.</span>
    {:else if message}
      <span class={message.type === 'error' ? 'save-error' : 'save-ok'}>{message.text}</span>
    {/if}
  </div>
  {#if readError}
    <p class="save-error">{readError}</p>
  {/if}
  {#if device.groups.length > 0}
    <div class="orders">
      {#each device.groups as group (group)}
        {@const order = orderOf(group)}
        {@const k = order.findIndex((d) => d.name === device.name)}
        {@const part = around(order, k)}
        <div class="order">
          <a class="group-name mono" href={`/groups/${encodeURIComponent(group)}`}>{group}</a>
          <span class="names mono">
            {#if part.before}<span class="dim">… →</span>{/if}
            {#each part.items as member, i (member.name)}
              {#if i > 0}<span class="dim">→</span>{/if}
              {#if member.name === device.name}
                <strong>{member.name}</strong>
              {:else}
                <a class="member" href={`/devices/${encodeURIComponent(member.name)}`}>{member.name}</a>
              {/if}
            {/each}
            {#if part.after}<span class="dim">→ …</span>{/if}
          </span>
          {#if part.before || part.after}
            <span class="dim tn">{k + 1} of {order.length}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .save-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 12px;
  }

  .priority {
    width: 6rem;
  }

  .orders {
    display: grid;
    gap: 6px;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--sw-border-subtle);
  }

  .order {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: var(--sw-text-sm);
  }

  .names {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .group-name,
  .member {
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .group-name {
    min-width: 8rem;
    font-weight: 600;
  }

  .group-name:hover,
  .member:hover {
    color: var(--sw-accent);
  }

  .dim {
    color: var(--sw-text-muted);
  }

  .save-ok {
    font-size: 12px;
    color: var(--sw-text-secondary);
  }

  .save-error {
    font-size: 12px;
    color: var(--sw-danger-text);
  }

  p.save-error {
    margin: 8px 0 0;
  }
</style>
