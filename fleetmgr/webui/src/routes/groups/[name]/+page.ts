import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { byUpgradeOrder, defaultSeparation, groupMembers } from '#lib/software/groups.ts';
import {
  FLEET_ROOT,
  REDUNDANCY_GROUPS_ROOT,
  SOFTWARE_CONFIG,
  parseCampaigns,
  parseFleet,
  parseGroupSeparations,
  type Device
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// The fleet gives the members, the other groups they are in (a priority
// counts in all of a device's groups) and the names a member can be picked
// from, the campaigns which of them each member is in.
export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:group');

  try {
    const [fleet, groups, software] = await Promise.all([
      restconfGetCachedOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(REDUNDANCY_GROUPS_ROOT, fetch),
      restconfGetCachedOrNull<unknown>(SOFTWARE_CONFIG, fetch)
    ]);
    const devices = parseFleet(fleet).devices;
    const members = devices.filter((d) => d.groups.includes(params.name)).sort(byUpgradeOrder);
    const memberNames = new Set(members.map((d) => d.name));
    const shared = new Set(members.flatMap((d) => d.groups).filter((g) => g !== params.name));
    const otherGroups = new Map(
      [...groupMembers(devices.filter((d) => d.groups.some((g) => shared.has(g))))].filter(([g]) => shared.has(g))
    );
    const campaignsOf = new Map<string, string[]>();
    for (const c of parseCampaigns(software)) {
      for (const name of c.devices) {
        if (memberNames.has(name)) campaignsOf.set(name, [...(campaignsOf.get(name) ?? []), c.name]);
      }
    }
    const entry = parseGroupSeparations(groups).find((s) => s.name === params.name) ?? null;
    return {
      name: params.name,
      members,
      otherGroups,
      campaignsOf,
      separation: entry ?? defaultSeparation(params.name),
      hasEntry: entry !== null,
      deviceNames: devices.map((d) => d.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      loadError: ''
    };
  } catch (loadError) {
    return {
      name: params.name,
      members: [],
      otherGroups: new Map<string, Device[]>(),
      campaignsOf: new Map<string, string[]>(),
      separation: defaultSeparation(params.name),
      hasEntry: false,
      deviceNames: [],
      loadError: errorText(loadError, 'Failed to load the redundancy group.')
    };
  }
};
