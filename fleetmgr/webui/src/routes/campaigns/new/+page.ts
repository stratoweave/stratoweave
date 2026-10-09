import { errorText } from '$lib/core/errors';
import { restconfGetOrNull } from '$lib/core/restconf/client';
import {
  FLEET_ROOT,
  SCHEDULES_ROOT,
  SOFTWARE_ROOT,
  parseCampaigns,
  parseFleet,
  parseSchedules
} from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  try {
    const [software, fleet, schedules] = await Promise.all([
      restconfGetOrNull<unknown>(SOFTWARE_ROOT, fetch),
      restconfGetOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    return {
      devices: parseFleet(fleet).devices,
      campaigns: parseCampaigns(software),
      schedules: parseSchedules(schedules),
      loadError: ''
    };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load inventory.');
    return { devices: [], campaigns: [], schedules: [], loadError: message };
  }
};
