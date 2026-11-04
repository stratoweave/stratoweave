import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { groupRows } from '#lib/software/groups.ts';
import { FLEET_ROOT, REDUNDANCY_GROUPS_ROOT, parseFleet, parseGroupSeparations } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// The groups come from the fleet, where devices name them, and from their
// entries under /redundancy-groups.
export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:groups');

  try {
    const [fleet, groups] = await Promise.all([
      restconfGetCachedOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(REDUNDANCY_GROUPS_ROOT, fetch)
    ]);
    return { rows: groupRows(parseFleet(fleet).devices, parseGroupSeparations(groups)), loadError: '' };
  } catch (loadError) {
    return { rows: [], loadError: errorText(loadError, 'Failed to load the redundancy groups.') };
  }
};
