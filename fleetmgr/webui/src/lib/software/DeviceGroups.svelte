<script lang="ts">
  // The fields of a device's redundancy groups and its priority in them,
  // with where it comes in each group's upgrade order.
  import { untrack } from 'svelte';

  import { errorText } from '#lib/core/errors.ts';
  import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
  import FieldText from '#lib/core/ui/FieldText.svelte';
  import TokenSelect from '#lib/core/ui/TokenSelect.svelte';
  import type { MembershipDraft, SectionFields } from '#lib/software/device-config.ts';
  import { around, byUpgradeOrder, devicesText, groupMembers, suggestNames } from '#lib/software/groups.ts';
  import {
    FLEET_LIST,
    REDUNDANCY_GROUPS_ROOT,
    parseFleet,
    parseGroupPolicies,
    type Device
  } from '#lib/software/model.ts';

  interface Props extends SectionFields<MembershipDraft> {
    /** As the page polls it. */
    device: Device;
  }

  let { device, draft, set, errors, touch, disabled }: Props = $props();

  const uid = $props.id();
  // More groups than this pick from suggestions instead of toggles.
  const TOGGLE_MAX = 16;
  const TIP = {
    groups: "The redundancy groups the device is in. A group's members upgrade one after another.",
    priority: 'Where the device comes in the upgrade order of each of its groups: lower goes first.'
  };

  // The other devices and the group entries, for the suggestions and the
  // order. Read on mount and when the device's groups change, not on every
  // poll of the page: at 100k devices the fleet list is 14 MB.
  let fleet = $state.raw<Device[]>([]);
  let entryNames = $state.raw<string[]>([]);
  let readError = $state('');

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
    const shown = new Set(suggestNames(allOptions.map((o) => o.value), draft.typed, new Set(draft.groups)));
    return allOptions.filter((o) => shown.has(o.value));
  });
  let stored = $derived(device.groups.join('\n'));

  /** The members of group in upgrade order, this device as polled. */
  function orderOf(group: string): Device[] {
    const others = (members.get(group) ?? []).filter((d) => d.name !== device.name);
    return [...others, device].sort(byUpgradeOrder);
  }

  async function readContext(): Promise<void> {
    try {
      const [fleetJson, groupsJson] = await Promise.all([
        restconfGetCachedOrNull<unknown>(FLEET_LIST),
        restconfGetOrNull<unknown>(REDUNDANCY_GROUPS_ROOT)
      ]);
      fleet = parseFleet(fleetJson).devices;
      entryNames = parseGroupPolicies(groupsJson).map((p) => p.name);
      readError = '';
    } catch (error) {
      readError = errorText(error, 'Failed to read the other groups.');
    }
  }

  $effect(() => {
    void stored;
    untrack(() => void readContext());
  });
</script>

<div class="field groups">
  <label class="field__label" for={`${uid}-groups`} title={TIP.groups}>Groups</label>
  <TokenSelect
    id={`${uid}-groups`}
    {options}
    selected={draft.groups}
    label="Redundancy groups"
    placeholder="add group"
    suggest={many}
    compact={true}
    countLabel={devicesText}
    describedby={`${uid}-groups-tip`}
    bind:draft={() => draft.typed, (typed) => set({ ...draft, typed })}
    onchange={(groups) => set({ ...draft, groups })}
  />
  <span id={`${uid}-groups-tip`} class="sr-only">{TIP.groups}</span>
</div>
<FieldText
  label="Priority"
  value={draft.priority}
  error={errors['priority']}
  mono={true}
  tooltip={TIP.priority}
  {disabled}
  onchange={(priority) => set({ ...draft, priority })}
  ontouch={touch}
/>
{#if readError}
  <p class="read-error">{readError}</p>
{:else if device.groups.length > 0}
  <!-- Without the other devices the order would show this one alone. -->
  <div class="orders">
    {#each device.groups as group (group)}
      {@const order = orderOf(group)}
      {@const k = order.findIndex((d) => d.name === device.name)}
      {@const part = around(order, k)}
      <div class="order">
        <span class="mono"><a class="group-name" href={`/groups/${encodeURIComponent(group)}`}>{group}</a>:</span>
        <span class="names mono">
          {#if part.before}<span>… →</span>{/if}
          {#each part.items as member, i (member.name)}
            {#if i > 0}<span>→</span>{/if}
            {#if member.name === device.name}
              <strong>{member.name}</strong>
            {:else}
              <a class="member" href={`/devices/${encodeURIComponent(member.name)}`}>{member.name}</a>
            {/if}
          {/each}
          {#if part.after}<span>→ …</span>{/if}
        </span>
        {#if part.before || part.after}
          <span class="tn">{(k + 1).toLocaleString()} of {order.length.toLocaleString()}</span>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .groups {
    grid-column: span 2;
  }

  /* The upgrade order, as a note under the fields. */
  .orders {
    grid-column: 1 / -1;
    display: grid;
    gap: 2px;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
  }

  .order {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 2px 6px;
  }

  .names {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .group-name,
  .member {
    color: var(--sw-text-secondary);
    text-decoration: none;
  }

  .group-name:hover,
  .member:hover {
    color: var(--sw-accent-bright);
    text-decoration: underline;
  }

  strong {
    font-weight: 600;
    color: var(--sw-text-primary);
  }

  .read-error {
    grid-column: 1 / -1;
    margin: 0;
    font-size: var(--sw-text-xs);
    color: var(--sw-danger-text);
  }

  @media (max-width: 720px) {
    .groups {
      grid-column: 1 / -1;
    }
  }
</style>
