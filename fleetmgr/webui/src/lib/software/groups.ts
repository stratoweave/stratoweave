// Redundancy groups. A device names the groups it is a member of on its
// fleet entry, with one priority for all of them, and a group's entry under
// /redundancy-groups says how far apart its members upgrade. A group exists
// while a device names it or it has an entry.

import { rewriteListEntry } from '#lib/core/restconf/client.ts';
import { parseDuration } from '#lib/core/time.ts';
import type { ValidationResult } from '#lib/core/validation/types.ts';
import {
  FLEET_DEVICE_LIST_ROOT,
  type Device,
  type FleetPatchJson,
  type GroupSeparation,
  type RedundancyGroupsPatchJson,
  type SeparationPolicy
} from '#lib/software/model.ts';
import { nameMatcher } from '#lib/software/selection.ts';

/** The range of min-separation (uint32). */
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
export function defaultSeparation(name: string): GroupSeparation {
  return { name, policy: 'spread', minSeparation: 0 };
}

export interface GroupRow {
  name: string;
  /** In upgrade order. */
  members: Device[];
  separation: GroupSeparation;
  /** Whether it has an entry under /redundancy-groups. */
  hasEntry: boolean;
}

/** Every group that a device names or that has an entry, by name. */
export function groupRows(devices: Device[], separations: GroupSeparation[]): GroupRow[] {
  const members = groupMembers(devices);
  const entries = new Map(separations.map((s) => [s.name, s]));
  const names = [...new Set([...members.keys(), ...entries.keys()])].sort(compareNames);
  return names.map((name) => ({
    name,
    members: members.get(name) ?? [],
    separation: entries.get(name) ?? defaultSeparation(name),
    hasEntry: entries.has(name)
  }));
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

/** "3 devices". */
export function devicesText(n: number): string {
  return `${n.toLocaleString()} device${n === 1 ? '' : 's'}`;
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

export function separationPatch(s: GroupSeparation): RedundancyGroupsPatchJson {
  const entry = { name: s.name, 'separation-policy': s.policy, 'min-separation': s.minSeparation };
  return { 'fleetmgr:redundancy-groups': { 'redundancy-group': [entry] } };
}

/** A new group in one write: its members and its entry. */
export function groupCreatePatch(s: GroupSeparation, members: string[]): FleetPatchJson & RedundancyGroupsPatchJson {
  return { ...addMembersPatch(s.name, members), ...separationPatch(s) };
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

export interface NewGroupInput {
  name: string;
  members: string[];
  policy: SeparationPolicy;
  /** As typed. */
  minSeparation: string;
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
