import type { Device } from '$lib/software/model';

// Campaign members are leafrefs into the fleet, so every selection ends
// as an explicit, inventory-verified name list ("no range expansion" is
// the model's stated philosophy — the UI does the expanding). Exclusions
// get the same weight as the match: they are where a selection surprises
// an operator.

export interface Selection {
  /** is any of; empty = all */
  types: string[];
  /** substring, or glob when it contains * or ? */
  namePattern: string;
  descriptionContains: string;
  /** '' = don't care */
  requiresApproval: '' | 'yes' | 'no';
  /** '' = don't care; 'no' excludes devices another campaign owns */
  ownedByCampaign: '' | 'yes' | 'no';
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
    namePattern: '',
    descriptionContains: '',
    requiresApproval: '',
    ownedByCampaign: 'no',
    pasted: ''
  };
}

export function nameMatches(name: string, pattern: string): boolean {
  if (!pattern) return true;
  if (pattern.includes('*') || pattern.includes('?')) {
    const rx = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')}$`,
      'i'
    );
    return rx.test(name);
  }
  return name.toLowerCase().includes(pattern.toLowerCase());
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

  const pattern = sel.namePattern.trim();
  const description = sel.descriptionContains.trim().toLowerCase();
  candidates = candidates.filter(
    (d) =>
      (sel.types.length === 0 || sel.types.includes(d.type)) &&
      nameMatches(d.name, pattern) &&
      (!description || d.description.toLowerCase().includes(description))
  );

  // The remaining criteria are exclusions worth accounting for, not
  // silent filters.
  const selected: Device[] = [];
  let ownedOut = 0;
  const ownedBy = new Set<string>();
  let approvalOut = 0;
  for (const d of candidates) {
    const owner = context.owners.get(d.name);
    if (sel.ownedByCampaign === 'no' && owner !== undefined) {
      ownedOut += 1;
      ownedBy.add(owner);
      continue;
    }
    if (sel.ownedByCampaign === 'yes' && owner === undefined) {
      continue;
    }
    if (sel.requiresApproval === 'no' && d.approvalRequired) {
      approvalOut += 1;
      continue;
    }
    if (sel.requiresApproval === 'yes' && !d.approvalRequired) {
      continue;
    }
    selected.push(d);
  }
  selected.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const byType: Record<string, number> = {};
  for (const d of selected) {
    byType[d.type] = (byType[d.type] ?? 0) + 1;
  }

  const excluded: ExclusionRow[] = [];
  if (ownedOut > 0) {
    excluded.push({
      n: ownedOut,
      what: 'owned by another campaign',
      path: [...ownedBy].slice(0, 2).map((o) => `software/upgrade-campaign = ${o}`).join(' · ')
    });
  }
  if (approvalOut > 0) {
    excluded.push({
      n: approvalOut,
      what: 'require per-change approval',
      path: 'approval-required = true'
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
