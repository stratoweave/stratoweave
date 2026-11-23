// Redundancy groups. A device names the groups it is a member of on its
// fleet entry, with one priority for all of them, and a group's entry under
// /redundancy-groups says how far apart its members upgrade and what a
// failed member does to the others. A group exists while a device names it
// or it has an entry.

import { restconfPatchJson, rewriteListEntry } from '#lib/core/restconf/client.ts';
import { formatDuration, parseDuration } from '#lib/core/time.ts';
import type { ValidationResult } from '#lib/core/validation/types.ts';
import {
  DATA_ROOT,
  DEFAULT_PRIORITY,
  FLEET_DEVICE_LIST_ROOT,
  type CampaignPlan,
  type Device,
  type DeviceJson,
  type DeviceStatusRow,
  type FailurePolicy,
  type FleetPatchJson,
  type GroupPolicy,
  type KnownStatus,
  type PlanDevice,
  type RedundancyGroupsPatchJson,
  type SeparationPolicy
} from '#lib/software/model.ts';
import { holderOf } from '#lib/software/device-state.ts';
import { nameMatcher } from '#lib/software/selection.ts';

/** The ranges of redundancy-priority (uint16) and min-separation (uint32). */
const MAX_PRIORITY = 65535;
const MAX_SEPARATION = 4294967295;

/** Names a field suggests at most: a datalist of 30k names freezes the page. */
const SUGGEST_LIMIT = 50;

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The order a campaign upgrades the members of a group in: lower priority
 * first, equal priorities by name, as the controller sorts them. */
export function byUpgradeOrder(a: Device, b: Device): number {
  return a.priority !== b.priority ? a.priority - b.priority : compareNames(a.name, b.name);
}

/** Each group's members in upgrade order. */
export function groupMembers(devices: Device[]): Map<string, Device[]> {
  const out = new Map<string, Device[]>();
  for (const d of devices) {
    for (const g of d.groups) {
      const members = out.get(g);
      if (members) members.push(d);
      else out.set(g, [d]);
    }
  }
  for (const members of out.values()) members.sort(byUpgradeOrder);
  return out;
}

/** What a group with no entry does. */
export function defaultPolicy(name: string): GroupPolicy {
  return { name, separationPolicy: 'spread', minSeparation: 0, failurePolicy: 'continue' };
}

/** What each policy does, in one line from its YANG description. */
export const SEPARATION_TEXT: Record<SeparationPolicy, string> = {
  spread: 'Later members move to later windows of the campaign, as far apart as its windows allow.',
  pack: 'Each member starts as soon as the member before it is done.'
};

export const FAILURE_TEXT: Record<FailurePolicy, string> = {
  continue: 'A member that failed or rolled back holds the others only until it is done and up again.',
  hold: 'While a member is failed, the others wait for an operator.'
};

/** "pack, 1m · holds on failure". */
export function policyText(p: GroupPolicy): string {
  const separation =
    p.minSeparation > 0 ? `${p.separationPolicy}, ${formatDuration(p.minSeparation)}` : p.separationPolicy;
  return `${separation} · ${p.failurePolicy === 'hold' ? 'holds' : 'continues'} on failure`;
}

export interface GroupRow {
  name: string;
  /** In upgrade order. */
  members: Device[];
  policy: GroupPolicy;
  /** Whether it has an entry under /redundancy-groups. */
  hasEntry: boolean;
}

/** Every group that a device names or that has an entry, by name. */
export function groupRows(devices: Device[], policies: GroupPolicy[]): GroupRow[] {
  const members = groupMembers(devices);
  const entries = new Map(policies.map((p) => [p.name, p]));
  const names = [...new Set([...members.keys(), ...entries.keys()])].sort(compareNames);
  return names.map((name) => ({
    name,
    members: members.get(name) ?? [],
    policy: entries.get(name) ?? defaultPolicy(name),
    hasEntry: entries.has(name)
  }));
}

/** Where a member of a group is in a campaign. held: it has not run, and
 * the campaign holds it, as its device-status says: behind a member of its
 * groups, or for a reason of its own, such as being down. */
export type MemberState = 'done' | 'upgrading' | 'failed' | 'held' | 'waiting';

export interface CampaignMember {
  device: Device;
  row: DeviceStatusRow;
  state: MemberState;
  /** When it finished, started or is planned to start, by its state; null
   * when the plan does not say. */
  time: number | null;
  /** Whether the plan has it in a window. */
  placed: boolean;
  /** The group member it waits behind, as the campaign names it: one of
   * them when several hold it. Empty when no member holds it. */
  heldBy: string[];
}

/** In the order they need someone: held first, then failed with nobody
 * waiting behind. */
export const GROUP_STATES = ['held', 'failed', 'upgrading', 'waiting', 'done'] as const;
export type GroupState = (typeof GROUP_STATES)[number];

export interface CampaignGroup {
  name: string;
  policy: GroupPolicy;
  /** Its members in the campaign, in upgrade order. */
  members: CampaignMember[];
  /** Its members outside the campaign, which the campaign does not pace. */
  outside: number;
  state: GroupState;
  /** Its failed members that other members wait behind: taking them out
   * lets the others go on. */
  holders: string[];
}

function isFailed(status: KnownStatus | undefined): boolean {
  return status === 'failed' || status === 'rolled-back' || status === 'not-started';
}

/** Whether the member's device is in an unknown state: its run failed its
 * rollback, or its attempt did not start because the run of an earlier one
 * did. Such a member holds its groups until an operator acts, whatever
 * their failure policy. */
export function rollbackFailed(row: DeviceStatusRow): boolean {
  return (row.status === 'failed' && row.stage === 'rollback') || row.status === 'not-started';
}

/** held comes first: only a member that waits is held. A member whose
 * status is final while it waits is done at once and waits for nothing. */
function memberState(status: KnownStatus, held: boolean): MemberState {
  if (held) return 'held';
  if (status === 'succeeded' || status === 'up-to-date') return 'done';
  if (status === 'in-progress') return 'upgrading';
  if (isFailed(status)) return 'failed';
  return 'waiting';
}

function memberTime(state: MemberState, planned: PlanDevice | undefined): number | null {
  if (!planned) return null;
  if (state === 'upgrading') return planned.started;
  if (state === 'done' || state === 'failed') return planned.finished;
  return planned.started ?? (planned.estimatedStart > 0 ? planned.estimatedStart : null);
}

/** The earliest planned start of a waiting member; Infinity when none. */
function nextStart(group: CampaignGroup): number {
  let next = Infinity;
  for (const m of group.members) {
    if (m.state === 'waiting' && m.time !== null && m.time < next) next = m.time;
  }
  return next;
}

/** Whether member waits behind failed for its failure: under the group's
 * failure policy hold until an operator acts, and under continue only when
 * the rollback of failed failed. */
function holdsBack(member: CampaignMember, failed: string): boolean {
  return member.row.held === 'group-failed' && member.heldBy.includes(failed);
}

/** The groups of a campaign's members: held and failed ones first, then
 * upgrading, waiting by their next start, and done. How long a failed
 * member holds the others is the group's failure policy; the campaign says
 * whom it holds, and why, in each member's row. Only the campaign's members
 * count, as it paces only them. `byGroup` is groupMembers() of the fleet. */
export function campaignGroups(
  byGroup: Map<string, Device[]>,
  policies: GroupPolicy[],
  members: string[],
  rows: DeviceStatusRow[],
  plan: CampaignPlan | null
): CampaignGroup[] {
  // Rows can still list devices that left the campaign.
  const memberSet = new Set(members);
  const rowOf = new Map(rows.filter((r) => memberSet.has(r.device)).map((r) => [r.device, r]));
  const planned = new Map<string, PlanDevice>();
  for (const w of plan?.windows ?? []) {
    for (const d of w.devices) planned.set(d.name, d);
  }
  const entries = new Map(policies.map((p) => [p.name, p]));
  const out: CampaignGroup[] = [];
  for (const [name, devices] of byGroup) {
    const inCampaign: CampaignMember[] = [];
    for (const device of devices) {
      const row = rowOf.get(device.name);
      if (!row) continue;
      const holder = holderOf(row);
      const by = holder ? [holder] : [];
      const state = memberState(row.status, row.held !== null);
      const p = planned.get(device.name);
      const time = memberTime(state, p);
      inCampaign.push({ device, row, state, time, placed: p !== undefined, heldBy: by });
    }
    if (inCampaign.length === 0) continue;
    const state = GROUP_STATES.find((s) => inCampaign.some((m) => m.state === s)) ?? 'done';
    out.push({
      name,
      policy: entries.get(name) ?? defaultPolicy(name),
      members: inCampaign,
      outside: devices.length - inCampaign.length,
      state,
      holders: inCampaign
        .filter((m) => m.state === 'failed' && inCampaign.some((o) => holdsBack(o, m.device.name)))
        .map((m) => m.device.name)
    });
  }
  const rank = (g: CampaignGroup) => GROUP_STATES.indexOf(g.state);
  const starts = (a: CampaignGroup, b: CampaignGroup) => {
    if (a.state !== 'waiting') return 0;
    const x = nextStart(a);
    const y = nextStart(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
  return out.sort((a, b) => rank(a) - rank(b) || starts(a, b) || compareNames(a.name, b.name));
}

/** Up to SUGGEST_LIMIT names that match what is typed, an exact match
 * first, without the names in skip. */
export function suggestNames(names: string[], typed: string, skip: Set<string>): string[] {
  const t = typed.trim();
  const match = nameMatcher(t);
  const exact = names.find((n) => n.toLowerCase() === t.toLowerCase() && !skip.has(n));
  const out = exact ? [exact] : [];
  for (const n of names) {
    if (out.length >= SUGGEST_LIMIT) break;
    if (n !== exact && !skip.has(n) && match(n)) out.push(n);
  }
  return out;
}

/** The part of a long list to show around item k: span items either side,
 * and whether items before and after are left out. A short list is shown
 * whole. */
export function around<T>(items: T[], k: number, span = 2): { items: T[]; before: boolean; after: boolean } {
  if (items.length <= 2 * span + 2) return { items, before: false, after: false };
  const from = Math.max(0, k - span);
  const to = Math.min(items.length, k + span + 1);
  return { items: items.slice(from, to), before: from > 0, after: to < items.length };
}

/** "3 devices". */
export function devicesText(n: number): string {
  return `${n.toLocaleString()} device${n === 1 ? '' : 's'}`;
}

/** A priority as typed; null unless it is a whole number in range. */
export function parsePriority(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) && Number(t) <= MAX_PRIORITY ? Number(t) : null;
}

/** A min-separation as typed, 30m or 1h; empty is none. Null when it does
 * not read as a duration in range. */
export function parseSeparation(text: string): number | null {
  if (!text.trim()) return 0;
  const s = parseDuration(text);
  return s !== null && s <= MAX_SEPARATION ? s : null;
}

/** A PATCH merges a leaf-list, so the devices keep their other groups. */
export function addMembersPatch(group: string, names: string[]): FleetPatchJson {
  return { 'fleetmgr:fleet': { device: names.map((name) => ({ name, 'redundancy-group': [group] })) } };
}

export function policyPatch(p: GroupPolicy): RedundancyGroupsPatchJson {
  const entry = {
    name: p.name,
    'separation-policy': p.separationPolicy,
    'min-separation': p.minSeparation,
    'failure-policy': p.failurePolicy
  };
  return { 'fleetmgr:redundancy-groups': { 'redundancy-group': [entry] } };
}

/** A new group in one write: its members and its entry. */
export function groupCreatePatch(p: GroupPolicy, members: string[]): FleetPatchJson & RedundancyGroupsPatchJson {
  return { ...addMembersPatch(p.name, members), ...policyPatch(p) };
}

/** Takes device `name` out of `group`. A PATCH cannot remove a leaf-list
 * value and a DELETE of one fails, so the entry goes back whole without it. */
export function removeFromGroup(name: string, group: string): Promise<void> {
  return rewriteListEntry(FLEET_DEVICE_LIST_ROOT, name, (entry) => {
    const groups = (entry['redundancy-group'] as string[] | undefined) ?? [];
    if (!groups.includes(group)) return null;
    const rest = { ...entry };
    const left = groups.filter((g) => g !== group);
    if (left.length > 0) rest['redundancy-group'] = left;
    else delete rest['redundancy-group'];
    return rest;
  });
}

export interface Membership {
  groups: string[];
  priority: number;
}

/** Saves what changed from `before` to `after` on device `name`. Adding
 * groups and a new priority is one PATCH; leaving a group rewrites the
 * entry, keeping any group added there since it was read. */
export async function saveMembership(name: string, before: Membership, after: Membership): Promise<void> {
  const added = after.groups.filter((g) => !before.groups.includes(g));
  const removed = new Set(before.groups.filter((g) => !after.groups.includes(g)));
  const priorityChanged = after.priority !== before.priority;
  if (removed.size === 0) {
    const entry: DeviceJson = { name };
    if (added.length > 0) entry['redundancy-group'] = added;
    if (priorityChanged) entry['redundancy-priority'] = after.priority;
    await restconfPatchJson(DATA_ROOT, { 'fleetmgr:fleet': { device: [entry] } });
    return;
  }
  await rewriteListEntry(FLEET_DEVICE_LIST_ROOT, name, (entry) => {
    const stored = (entry['redundancy-group'] as string[] | undefined) ?? [];
    const groups = [...stored.filter((g) => !removed.has(g)), ...added.filter((g) => !stored.includes(g))];
    const rest = { ...entry };
    if (groups.length > 0) rest['redundancy-group'] = groups;
    else delete rest['redundancy-group'];
    if (priorityChanged) rest['redundancy-priority'] = after.priority;
    return rest;
  });
}

/** Room left before or after a member moved to an end of the order. */
const PRIORITY_STEP = 10;

function keyBefore(pa: number, na: string, pb: number, nb: string): boolean {
  return pa < pb || (pa === pb && na < nb);
}

/** The priorities to write so that the members upgrade in `order`, which
 * is their order now with `moved` taken to another place. Only `moved`
 * changes when a priority fits between its new neighbours; else the
 * members from it on go up as far as needed, and only if that runs out of
 * range is every member numbered again. */
export function reorderPriorities(members: Device[], order: string[], moved: string): Map<string, number> {
  const prio = new Map(members.map((d) => [d.name, d.priority]));
  const at = (name: string) => prio.get(name) ?? DEFAULT_PRIORITY;
  const i = order.indexOf(moved);
  const prev = i > 0 ? order[i - 1] : null;
  const next = i + 1 < order.length ? order[i + 1] : null;
  const fits = (p: number): boolean =>
    p >= 0 &&
    p <= MAX_PRIORITY &&
    (prev === null || keyBefore(at(prev), prev, p, moved)) &&
    (next === null || keyBefore(p, moved, at(next), next));
  const candidates =
    prev !== null && next !== null
      ? [Math.floor((at(prev) + at(next)) / 2), at(prev), at(next)]
      : next !== null
        ? [at(next) - PRIORITY_STEP, Math.floor(at(next) / 2), at(next) - 1, at(next)]
        : prev !== null
          ? [at(prev) + PRIORITY_STEP, at(prev) + 1, at(prev)]
          : [];
  const single = candidates.find(fits);
  if (single !== undefined) return new Map([[moved, single]]);

  const out = new Map<string, number>();
  let last: [number, string] | null = prev === null ? null : [at(prev), prev];
  for (let k = i; k < order.length; k++) {
    const name = order[k];
    if (k > i && last !== null && keyBefore(last[0], last[1], at(name), name)) break;
    const p = last === null ? 0 : last[1] < name ? last[0] : last[0] + 1;
    if (p > MAX_PRIORITY) return renumber(order, at);
    if (p !== at(name)) out.set(name, p);
    last = [p, name];
  }
  return out;
}

function renumber(order: string[], at: (name: string) => number): Map<string, number> {
  const step = Math.max(1, Math.min(PRIORITY_STEP, Math.floor(MAX_PRIORITY / order.length)));
  const out = new Map<string, number>();
  order.forEach((name, k) => {
    if ((k + 1) * step !== at(name)) out.set(name, (k + 1) * step);
  });
  return out;
}

/** The other groups of the changed members whose upgrade order the new
 * priorities change: a device has one priority for all its groups. */
export function reorderedGroups(
  otherGroups: Map<string, Device[]>,
  members: Device[],
  changes: Map<string, number>
): string[] {
  const groups = new Set(members.filter((d) => changes.has(d.name)).flatMap((d) => d.groups));
  const out: string[] = [];
  for (const g of groups) {
    const devices = otherGroups.get(g);
    if (!devices) continue;
    const after = devices.map((d) => ({ ...d, priority: changes.get(d.name) ?? d.priority })).sort(byUpgradeOrder);
    if (after.some((d, k) => d.name !== devices[k].name)) out.push(g);
  }
  return out.sort(compareNames);
}

/** A PATCH merges, so it sets the priorities and keeps the rest. */
export function priorityPatch(changes: Map<string, number>): FleetPatchJson {
  const device = [...changes].map(([name, p]) => ({ name, 'redundancy-priority': p }));
  return { 'fleetmgr:fleet': { device } };
}

export interface NewGroupInput {
  name: string;
  members: string[];
  separationPolicy: SeparationPolicy;
  /** As typed. */
  minSeparation: string;
  failurePolicy: FailurePolicy;
}

export function validateNewGroup(
  input: NewGroupInput,
  existingGroups: Set<string>,
  deviceNames: Set<string>
): ValidationResult {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) {
    errors['name'] = 'A name is required.';
  } else if (existingGroups.has(name)) {
    errors['name'] = `Group ${name} already exists.`;
  }
  // A PATCH for a name the fleet lacks would add a device without a type.
  const unknown = input.members.find((m) => !deviceNames.has(m));
  if (unknown !== undefined) {
    errors['members'] = `No device named ${unknown}.`;
  } else if (input.members.length < 2) {
    errors['members'] = 'Pick at least two devices.';
  }
  if (parseSeparation(input.minSeparation) === null) {
    errors['min-separation'] = 'A duration such as 30m or 2h.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
