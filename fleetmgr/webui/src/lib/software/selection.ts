import type { Device } from '#lib/software/model.ts';

// Campaign members are leafrefs into the fleet, so every selection ends
// as an explicit, inventory-verified name list ("no range expansion" is
// the model's stated philosophy — the UI does the expanding). Exclusions
// get the same weight as the match: they are where a selection surprises
// an operator.

export interface Selection {
  /** is any of; empty = all */
  types: string[];
  /** is any of; empty = all; '' stands for devices that have not
   * reported one */
  models: string[];
  versions: string[];
  /** substring, or glob when it contains * or ? */
  namePattern: string;
  addressContains: string;
  descriptionContains: string;
  /** '' any, 'none' no schedule, '=NAME' bound to NAME */
  schedule: string;
  /** explicit names, newline/comma-separated; when non-empty it is the
   * base set instead of the whole inventory */
  pasted: string;
}

export interface ExclusionRow {
  n: number;
  what: string;
  path: string;
}

export interface Expansion {
  names: string[];
  /** pasted names that are not in the inventory; excluded from names
   * (the leafref would reject them) */
  unknown: string[];
  byType: Record<string, number>;
  /** '' counts devices that have not reported a model */
  byModel: Record<string, number>;
  excluded: ExclusionRow[];
  sample: Device[];
}

export interface SelectionContext {
  /** device name -> owning campaign name, from every campaign's members */
  owners: Map<string, string>;
}

export function emptySelection(): Selection {
  return {
    types: [],
    models: [],
    versions: [],
    namePattern: '',
    addressContains: '',
    descriptionContains: '',
    schedule: '',
    pasted: ''
  };
}

/** A name test for `pattern`: a substring, or a glob when it contains *
 * or ?; case-insensitive, and empty matches every name. */
export function nameMatcher(pattern: string): (name: string) => boolean {
  if (!pattern) return () => true;
  if (pattern.includes('*') || pattern.includes('?')) {
    const rx = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')}$`,
      'i'
    );
    return (name) => rx.test(name);
  }
  const needle = pattern.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

/** Whether device's schedule binding matches filter: '' any, 'none' no
 * schedule, '=NAME' bound to NAME. */
export function scheduleMatches(device: Device, filter: string): boolean {
  if (filter === '') return true;
  if (filter === 'none') return device.schedule === '';
  return device.schedule === filter.slice(1);
}

/** Case-insensitive substring test; empty matches everything. */
function contains(text: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  return !n || text.toLowerCase().includes(n);
}

export function expandSelection(
  sel: Selection,
  inventory: Device[],
  context: SelectionContext
): Expansion {
  const byName = new Map(inventory.map((d) => [d.name, d]));
  const unknown: string[] = [];
  let candidates: Device[];

  const pastedNames = sel.pasted
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));
  if (pastedNames.length > 0) {
    const seen = new Set<string>();
    candidates = [];
    for (const name of pastedNames) {
      if (seen.has(name)) continue;
      seen.add(name);
      const device = byName.get(name);
      if (device) {
        candidates.push(device);
      } else {
        unknown.push(name);
      }
    }
  } else {
    candidates = [...inventory];
  }

  const matchName = nameMatcher(sel.namePattern.trim());
  candidates = candidates.filter(
    (d) =>
      (sel.types.length === 0 || sel.types.includes(d.type)) &&
      (sel.models.length === 0 || sel.models.includes(d.model)) &&
      (sel.versions.length === 0 || sel.versions.includes(d.version)) &&
      matchName(d.name) &&
      contains(d.address, sel.addressContains) &&
      contains(d.description, sel.descriptionContains) &&
      scheduleMatches(d, sel.schedule)
  );

  // A device another campaign owns is an exclusion worth accounting for,
  // not a silent filter: two campaigns would set it two targets.
  const selected: Device[] = [];
  let ownedOut = 0;
  const ownedBy = new Set<string>();
  for (const d of candidates) {
    const owner = context.owners.get(d.name);
    if (owner !== undefined) {
      ownedOut += 1;
      ownedBy.add(owner);
      continue;
    }
    selected.push(d);
  }
  selected.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const byType: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  for (const d of selected) {
    byType[d.type] = (byType[d.type] ?? 0) + 1;
    byModel[d.model] = (byModel[d.model] ?? 0) + 1;
  }

  const excluded: ExclusionRow[] = [];
  if (ownedOut > 0) {
    excluded.push({
      n: ownedOut,
      what: 'owned by another campaign',
      path: [...ownedBy].slice(0, 2).map((o) => `software/upgrade-campaign = ${o}`).join(' · ')
    });
  }
  if (unknown.length > 0) {
    excluded.push({
      n: unknown.length,
      what: 'not in the inventory',
      path: unknown.slice(0, 3).join(', ')
    });
  }

  return {
    names: selected.map((d) => d.name),
    unknown,
    byType,
    byModel,
    excluded,
    sample: selected.slice(0, 6)
  };
}

/** device name -> owning campaign, from every campaign's member list. */
export function campaignOwners(campaigns: { name: string; devices: string[] }[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const campaign of campaigns) {
    for (const device of campaign.devices) {
      if (!owners.has(device)) owners.set(device, campaign.name);
    }
  }
  return owners;
}
