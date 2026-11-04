import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { FLEET_ROOT, SCHEDULES_ROOT, parseFleet, parseSchedules } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// ?schedule=NAME opens the list filtered to the devices bound to NAME,
// ?name=TEXT with the name filter set to TEXT.
export const load: PageLoad = async ({ fetch, depends, url }) => {
  depends('data:software');
  const scheduleFilter = url.searchParams.get('schedule') ?? '';
  const nameFilter = url.searchParams.get('name') ?? '';

  try {
    const [response, schedules] = await Promise.all([
      restconfGetCachedOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    const { devices } = parseFleet(response);
    return { devices, schedules: parseSchedules(schedules), scheduleFilter, nameFilter, loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load devices.');
    return { devices: [], schedules: [], scheduleFilter, nameFilter, loadError: message };
  }
};
