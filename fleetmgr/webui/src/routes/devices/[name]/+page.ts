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

export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:device');

  try {
    const [fleet, software, schedules] = await Promise.all([
      restconfGetOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(SOFTWARE_ROOT, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    const device = parseFleet(fleet).devices.find((d) => d.name === params.name) ?? null;
    const campaigns = parseCampaigns(software).filter((c) => c.devices.includes(params.name));
    return { name: params.name, device, campaigns, schedules: parseSchedules(schedules), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load the device.');
    return { name: params.name, device: null, campaigns: [], schedules: [], loadError: message };
  }
};
