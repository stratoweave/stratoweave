import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { byUpgradeOrder, defaultSeparation } from '#lib/software/groups.ts';
import {
  FLEET_ROOT,
  REDUNDANCY_GROUPS_ROOT,
  SOFTWARE_CONFIG,
  parseCampaigns,
  parseFleet,
  parseGroupSeparations
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// The fleet gives the members and the names a member can be picked from,
// the campaigns which of them each member is in.
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
      campaignsOf: new Map<string, string[]>(),
      separation: defaultSeparation(params.name),
      hasEntry: false,
      deviceNames: [],
      loadError: errorText(loadError, 'Failed to load the redundancy group.')
    };
  }
};
