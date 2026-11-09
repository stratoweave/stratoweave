import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { FLEET_LIST, SCHEDULES_ROOT, parseFleet, parseSchedules, type Device, type Schedule } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

async function loadFleet(
  fetch: typeof globalThis.fetch
): Promise<{ devices: Device[]; schedules: Schedule[]; loadError: string }> {
  try {
    // The small read first: the top answers GETs one at a time, and the
    // fleet list takes over 3 s at 100k devices.
    const [schedules, fleet] = await Promise.all([
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch),
      restconfGetCachedOrNull<unknown>(FLEET_LIST, fetch)
    ]);
    return { devices: parseFleet(fleet).devices, schedules: parseSchedules(schedules), loadError: '' };
  } catch (loadError) {
    return { devices: [], schedules: [], loadError: errorText(loadError, 'Failed to load devices.') };
  }
}

// ?schedule=NAME opens the list filtered to the devices bound to NAME,
// ?group=NAME to the members of redundancy group NAME, ?name=TEXT with the
// name filter set to TEXT. The fleet is not awaited: the page shows at once
// and fills in when it arrives.
export const load: PageLoad = ({ fetch, depends, url }) => {
  depends('data:software');
  return {
    scheduleFilter: url.searchParams.get('schedule') ?? '',
    groupFilter: url.searchParams.get('group') ?? '',
    nameFilter: url.searchParams.get('name') ?? '',
    fleet: loadFleet(fetch)
  };
};
