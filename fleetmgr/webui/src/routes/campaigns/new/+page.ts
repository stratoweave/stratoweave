import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import {
  FLEET_ROOT,
  IMAGES_ROOT,
  SCHEDULES_ROOT,
  SOFTWARE_CONFIG,
  parseCampaigns,
  parseFleet,
  parseImages,
  parseSchedules
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  try {
    const [software, fleet, schedules, images] = await Promise.all([
      restconfGetOrNull<unknown>(SOFTWARE_CONFIG, fetch),
      restconfGetCachedOrNull<unknown>(FLEET_ROOT, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch),
      restconfGetOrNull<unknown>(IMAGES_ROOT, fetch)
    ]);
    return {
      devices: parseFleet(fleet).devices,
      campaigns: parseCampaigns(software),
      schedules: parseSchedules(schedules),
      images: parseImages(images),
      loadError: ''
    };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load inventory.');
    return { devices: [], campaigns: [], schedules: [], images: [], loadError: message };
  }
};
