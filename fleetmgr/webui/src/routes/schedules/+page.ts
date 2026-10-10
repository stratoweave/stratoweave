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

// The fleet and the campaigns are loaded for the usage columns: which
// devices are bound to a schedule and which campaigns default to it.
export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:schedules');

  try {
    const [schedules, fleet, software] = await Promise.all([
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch),
      restconfGetOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(SOFTWARE_ROOT, fetch)
    ]);
    return {
      schedules: parseSchedules(schedules),
      devices: parseFleet(fleet).devices,
      campaigns: parseCampaigns(software),
      loadError: ''
    };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load schedules.');
    return { schedules: [], devices: [], campaigns: [], loadError: message };
  }
};
