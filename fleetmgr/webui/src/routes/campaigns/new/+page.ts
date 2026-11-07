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

async function loadInventory(fetch: typeof globalThis.fetch) {
  try {
    // Small reads first: the top answers GETs one at a time, and the fleet
    // takes 4 s at 100k devices.
    const [images, schedules, software, fleet] = await Promise.all([
      restconfGetOrNull<unknown>(IMAGES_ROOT, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch),
      restconfGetOrNull<unknown>(SOFTWARE_CONFIG, fetch),
      restconfGetCachedOrNull<unknown>(FLEET_ROOT, fetch)
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
}

// Not awaited: the page shows at once and fills in when the reads are in.
export const load: PageLoad = ({ fetch }) => ({ inventory: loadInventory(fetch) });
