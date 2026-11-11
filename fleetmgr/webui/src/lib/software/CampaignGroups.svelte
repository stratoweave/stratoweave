<script lang="ts">
  import { errorText } from '#lib/core/errors.ts';
  import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import Pager, { paginate } from '#lib/core/ui/Pager.svelte';
  import { formatClock, formatDuration } from '#lib/core/time.ts';
  import {
    GROUP_STATES,
    campaignGroups,
    groupMembers,
    removeFromGroup,
    type CampaignGroup,
    type CampaignMember,
    type GroupState
  } from '#lib/software/groups.ts';
  import {
    FLEET_ROOT,
    REDUNDANCY_GROUPS_ROOT,
    STEP_LABEL,
    parseFleet,
    parseGroupSeparations,
    type CampaignPlan,
    type Device,
    type DeviceStatusRow,
    type GroupSeparation
  } from '#lib/software/model.ts';
  import { nameMatcher } from '#lib/software/selection.ts';
  import { stageDetail } from '#lib/software/stages.ts';

  interface Props {
    /** The campaign's members. */
    members: string[];
    rows: DeviceStatusRow[];
    plan: CampaignPlan | null;
    /** Changes with each load of the page, which reads the groups again. */
    version: number;
    /** After a write here, for the page to read the campaign again. */
    onwrote: () => void;
  }

  let { members, rows, plan, version, onwrote }: Props = $props();

  const PAGE_SIZE = 100;
  const TONE: Record<GroupState, string> = {
    held: 'warning',
    failed: 'danger',
    upgrading: 'pill-run',
    waiting: 'muted',
    done: 'success'
  };

  // Who is in which group: read on open, on Refresh and after a write here,
  // not on every poll of the page, as the fleet is 34 MB at 100k devices.
  let byGroup = $state.raw<Map<string, Device[]> | null>(null);
  let separations = $state.raw<GroupSeparation[]>([]);
  let readError = $state('');
  let reads = 0;

  async function readGroups(): Promise<void> {
    const mine = ++reads;
    try {
      const [fleetJson, groupsJson] = await Promise.all([
        restconfGetCachedOrNull<unknown>(FLEET_ROOT),
        restconfGetOrNull<unknown>(REDUNDANCY_GROUPS_ROOT)
      ]);
      if (mine !== reads) return;
      byGroup = groupMembers(parseFleet(fleetJson).devices);
      separations = parseGroupSeparations(groupsJson);
      readError = '';
    } catch (error) {
      if (mine === reads) readError = errorText(error, 'Failed to read the redundancy groups.');
    }
  }

  let readVersion = -1;
  $effect(() => {
    if (version !== readVersion) {
      readVersion = version;
      void readGroups();
    }
  });

  let groups = $derived(byGroup === null ? [] : campaignGroups(byGroup, separations, members, rows, plan));
  let counts = $derived.by(() => {
    const out = new Map<GroupState, number>();
    for (const g of groups) out.set(g.state, (out.get(g.state) ?? 0) + 1);
    return out;
  });

  // Folded when the page loads.
  let open = $state(false);
  let filterState = $state<GroupState | ''>('');
  let searchText = $state('');
  let page = $state(1);
  let filtered = $derived.by(() => {
    const match = nameMatcher(searchText.trim());
    return groups.filter((g) => (!filterState || g.state === filterState) && match(g.name));
  });
  let paged = $derived(paginate(filtered, page, PAGE_SIZE));

  function separationText(group: CampaignGroup): string {
    const s = group.separation;
    return s.minSeparation > 0 ? `${s.policy}, ${formatDuration(s.minSeparation)}` : s.policy;
  }

  /** What a member's chip says after its name. */
  function memberText(m: CampaignMember): string {
    const { status, stage } = m.row;
    switch (m.state) {
      case 'done':
        if (status === 'up-to-date') return 'up to date';
        return m.time !== null ? formatClock(m.time) : 'done';
      case 'upgrading':
        if (stage === null) return 'upgrading';
        return stage === 'rollback' ? 'rolling back' : STEP_LABEL[stage];
      case 'failed':
        return status;
      case 'held':
        return 'held';
      case 'waiting':
        if (m.time !== null) return formatClock(m.time);
        return plan !== null && !m.placed ? 'not placed' : status;
    }
  }

  function memberTitle(m: CampaignMember): string {
    if (m.state === 'held') return `waits behind ${m.heldBy.join(', ')}`;
    return stageDetail(m.row) || m.row.status;
  }

  let takeOut = $state<{ device: string; group: CampaignGroup } | null>(null);
  let busy = $state(false);
  let message = $state<{ type: 'success' | 'error'; text: string } | null>(null);

  let takeOutMessage = $derived.by(() => {
    if (!takeOut) return '';
    const { device, group } = takeOut;
    const behind = group.members.filter((m) => m.heldBy.includes(device)).map((m) => m.device.name);
    const stop = behind.length === 1 ? 'stops' : 'stop';
    return `Take ${device} out of ${group.name}? ${behind.join(', ')} ${stop} waiting for it.`;
  });

  async function confirmTakeOut(): Promise<void> {
    const target = takeOut;
    takeOut = null;
    if (!target) return;
    const { device, group } = target;
    try {
      busy = true;
      message = null;
      await removeFromGroup(device, group.name);
      onwrote();
      message = { type: 'success', text: `Took ${device} out of ${group.name}.` };
      await readGroups();
    } catch (error) {
      message = { type: 'error', text: errorText(error, `Failed to take ${device} out of ${group.name}.`) };
    } finally {
      busy = false;
    }
  }
</script>

{#if groups.length > 0 || readError}
  <section class="card">
    <h2 class="fold-heading">
      <button class="fold" type="button" aria-expanded={open} onclick={() => (open = !open)}>
        Redundancy groups ({groups.length.toLocaleString()})
      </button>
      {#if !open && counts.get('held')}
        <span class="pill warning"><span class="dot"></span>{counts.get('held')} held</span>
      {/if}
    </h2>
    {#if readError}
      <div class="error-state status">{readError}</div>
    {/if}
    {#if open && message}
      <div class={message.type === 'error' ? 'error-state status' : 'success-banner status'} role="status">
        {message.text}
      </div>
    {/if}
    {#if open && groups.length > 0}
      <div class="filter-row">
        <button
          class="chip"
          class:active={filterState === ''}
          type="button"
          aria-pressed={filterState === ''}
          onclick={() => {
            filterState = '';
            page = 1;
          }}
        >
          all {groups.length}
        </button>
        {#each GROUP_STATES as state (state)}
          {#if counts.get(state)}
            <button
              class="chip"
              class:active={filterState === state}
              type="button"
              aria-pressed={filterState === state}
              onclick={() => {
                filterState = state;
                page = 1;
              }}
            >
              {state} {counts.get(state)}
            </button>
          {/if}
        {/each}
        <input
          class="input compact mono search"
          type="text"
          aria-label="Find group"
          placeholder="find group (glob with * and ?)"
          bind:value={searchText}
          oninput={() => (page = 1)}
        />
      </div>
      <div class="table-wrap">
        <table class="dense">
          <thead>
            <tr>
              <th>Group</th>
              <th>State</th>
              <th>Members in upgrade order</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {#each paged.rows as group (group.name)}
              <tr>
                <td class="group">
                  <a class="name" href={`/groups/${encodeURIComponent(group.name)}`}>{group.name}</a>
                  <span class="separation">{separationText(group)}</span>
                </td>
                <td><span class={`pill ${TONE[group.state]}`}><span class="dot"></span>{group.state}</span></td>
                <td>
                  <div class="chain">
                    {#each group.members as m, i (m.device.name)}
                      {#if i > 0}<span class="arrow" aria-hidden="true">→</span>{/if}
                      <span class={`member ${m.state}`} title={memberTitle(m)}>
                        <span class="dot"></span>
                        <a class="name" href={`/devices/${encodeURIComponent(m.device.name)}`}>{m.device.name}</a>
                        <span class="detail">{memberText(m)}</span>
                      </span>
                    {/each}
                    {#if group.outside > 0}
                      <span class="outside">+{group.outside} not in this campaign</span>
                    {/if}
                  </div>
                </td>
                <td class="actions">
                  {#each group.holders as holder (holder)}
                    <button
                      class="btn btn-secondary btn-sm"
                      type="button"
                      disabled={busy}
                      aria-label={`Take ${holder} out of ${group.name}`}
                      onclick={() => (takeOut = { device: holder, group })}
                    >
                      Take {holder} out
                    </button>
                  {/each}
                </td>
              </tr>
            {:else}
              <tr><td class="none" colspan="4">No group matches.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (page = p)} />
    {/if}
  </section>
{/if}

<ConfirmDialog
  open={takeOut !== null}
  title="Take out of group"
  message={takeOutMessage}
  confirmLabel="Take out"
  confirmClass="btn-danger"
  oncancel={() => (takeOut = null)}
  onconfirm={confirmTakeOut}
/>

<style>
  .fold-heading {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    font-size: inherit;
  }

  .filter-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }

  .search {
    width: auto;
    margin-left: auto;
  }

  .group {
    white-space: nowrap;
  }

  .separation {
    display: block;
    color: var(--sw-text-muted);
    font-size: var(--sw-text-2xs);
  }

  .name {
    font-family: var(--sw-font-mono);
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .name:hover {
    color: var(--sw-accent);
  }

  .chain {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }

  .member {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }

  .member .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sw-text-muted);
  }

  .member.done .dot {
    background: var(--sw-success);
  }

  .member.upgrading .dot {
    background: var(--sw-accent);
  }

  .member.failed .dot {
    background: var(--sw-danger);
  }

  .member.held .dot {
    background: var(--sw-warning);
  }

  .detail,
  .outside {
    color: var(--sw-text-muted);
    font-size: var(--sw-text-2xs);
  }

  .member.upgrading .detail {
    color: var(--sw-accent);
  }

  .member.failed .detail {
    color: var(--sw-danger-text);
  }

  .member.held .detail {
    color: var(--sw-warning);
  }

  .arrow {
    color: var(--sw-text-muted);
  }

  .actions {
    text-align: right;
    white-space: nowrap;
  }

  .actions .btn + .btn {
    margin-left: 6px;
  }

  .none {
    color: var(--sw-text-muted);
  }
</style>
