import { restconfGetJson, restconfGetOrNull } from '$lib/core/restconf/client';
import { FLEET_ROOT, SCHEDULES_ROOT, parseFleet, parseSchedules } from '$lib/software/model';

import type { PageLoad } from './$types';

// ?schedule=NAME opens the list filtered to the devices bound to NAME.
export const load: PageLoad = async ({ fetch, depends, url }) => {
  depends('data:software');
  const scheduleFilter = url.searchParams.get('schedule') ?? '';

  try {
    const [response, schedules] = await Promise.all([
      restconfGetJson<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    const { nodes, devices } = parseFleet(response);
    return { nodes, devices, schedules: parseSchedules(schedules), scheduleFilter, loadError: '' };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load devices.';
    return {
      nodes: [],
      devices: [],
      schedules: [],
      scheduleFilter,
      // 404 just means nothing has been configured yet.
      loadError: message.includes('404') ? '' : message
    };
  }
};
