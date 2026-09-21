import { restconfGetJson } from '$lib/core/restconf/client';
import {
  FLEET_ROOT,
  SCHEDULES_ROOT,
  SOFTWARE_ROOT,
  parseCampaigns,
  parseFleet,
  parseSchedules
} from '$lib/software/model';

import type { PageLoad } from './$types';

// 404 just means nothing has been configured yet.
async function getOrNull(path: string, fetchFn: typeof fetch): Promise<unknown> {
  try {
    return await restconfGetJson<unknown>(path, fetchFn);
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

export const load: PageLoad = async ({ fetch }) => {
  try {
    const [software, fleet, schedules] = await Promise.all([
      getOrNull(SOFTWARE_ROOT, fetch),
      getOrNull(FLEET_ROOT, fetch),
      getOrNull(SCHEDULES_ROOT, fetch)
    ]);
    return {
      devices: parseFleet(fleet).devices,
      campaigns: parseCampaigns(software),
      schedules: parseSchedules(schedules),
      loadError: ''
    };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load inventory.';
    return { devices: [], campaigns: [], schedules: [], loadError: message };
  }
};
