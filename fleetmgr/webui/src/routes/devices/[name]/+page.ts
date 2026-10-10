import { errorText } from '$lib/core/errors';
import { getListEntryPath, restconfGetOrNull } from '$lib/core/restconf/client';
import {
  FLEET_DEVICE_LIST_ROOT,
  SCHEDULES_ROOT,
  SOFTWARE_ROOT,
  parseCampaigns,
  parseDeviceEntry,
  parseSchedules
} from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:device');

  try {
    const [entry, software, schedules] = await Promise.all([
      restconfGetOrNull<unknown>(getListEntryPath(FLEET_DEVICE_LIST_ROOT, params.name), fetch),
      restconfGetOrNull<unknown>(SOFTWARE_ROOT, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    const device = parseDeviceEntry(entry);
    const campaigns = parseCampaigns(software).filter((c) => c.devices.includes(params.name));
    return { name: params.name, device, campaigns, schedules: parseSchedules(schedules), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load the device.');
    return { name: params.name, device: null, campaigns: [], schedules: [], loadError: message };
  }
};
