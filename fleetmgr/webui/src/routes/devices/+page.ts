import { errorText } from '$lib/core/errors';
import { restconfGetOrNull } from '$lib/core/restconf/client';
import { FLEET_ROOT, SCHEDULES_ROOT, parseFleet, parseSchedules } from '$lib/software/model';

import type { PageLoad } from './$types';

// ?schedule=NAME opens the list filtered to the devices bound to NAME.
export const load: PageLoad = async ({ fetch, depends, url }) => {
  depends('data:software');
  const scheduleFilter = url.searchParams.get('schedule') ?? '';

  try {
    const [response, schedules] = await Promise.all([
      restconfGetOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    const { nodes, devices } = parseFleet(response);
    return { nodes, devices, schedules: parseSchedules(schedules), scheduleFilter, loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load devices.');
    return { nodes: [], devices: [], schedules: [], scheduleFilter, loadError: message };
  }
};
