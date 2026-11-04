import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { groupRows } from '#lib/software/groups.ts';
import { FLEET_ROOT, REDUNDANCY_GROUPS_ROOT, parseFleet, parseGroupSeparations } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// The devices a member is picked from, and the groups whose names are taken.
export const load: PageLoad = async ({ fetch }) => {
  try {
    const [fleet, groups] = await Promise.all([
      restconfGetCachedOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(REDUNDANCY_GROUPS_ROOT, fetch)
    ]);
    const devices = parseFleet(fleet).devices;
    return {
      deviceNames: devices.map((d) => d.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      groupNames: groupRows(devices, parseGroupSeparations(groups)).map((r) => r.name),
      loadError: ''
    };
  } catch (loadError) {
    return { deviceNames: [], groupNames: [], loadError: errorText(loadError, 'Failed to load the fleet.') };
  }
};
