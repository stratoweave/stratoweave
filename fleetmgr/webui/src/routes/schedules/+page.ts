import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import {
  FLEET_ROOT,
  SCHEDULES_ROOT,
  SOFTWARE_CONFIG,
  parseCampaigns,
  parseFleet,
  parseSchedules
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

async function loadSchedules(fetch: typeof globalThis.fetch) {
  try {
    return { schedules: parseSchedules(await restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)), loadError: '' };
  } catch (loadError) {
    return { schedules: [], loadError: errorText(loadError, 'Failed to load schedules.') };
  }
}

// The fleet and the campaigns are for the usage columns: which devices are
// bound to a schedule and which campaigns default to it.
async function loadUsage(fetch: typeof globalThis.fetch) {
  try {
    const [software, fleet] = await Promise.all([
      restconfGetOrNull<unknown>(SOFTWARE_CONFIG, fetch),
      restconfGetCachedOrNull<unknown>(FLEET_ROOT, fetch)
    ]);
    return { devices: parseFleet(fleet).devices, campaigns: parseCampaigns(software), loadError: '' };
  } catch (loadError) {
    return { devices: [], campaigns: [], loadError: errorText(loadError, 'Failed to load the schedule usage.') };
  }
}

// Not awaited, and the schedules apart and first: the calendar shows
// before the fleet is in, which takes 4 s at 100k devices.
export const load: PageLoad = ({ fetch, depends }) => {
  depends('data:schedules');
  const schedules = loadSchedules(fetch);
  return { schedules, usage: loadUsage(fetch) };
};
