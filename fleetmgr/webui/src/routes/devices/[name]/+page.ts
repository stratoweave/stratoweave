import { errorText } from '#lib/core/errors.ts';
import { getListEntryPath, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { loadCampaigns } from '#lib/software/device-campaigns.ts';
import { parseDeviceRead } from '#lib/software/device-config.ts';
import {
  FLEET_DEVICE_LIST_ROOT,
  SCHEDULES_ROOT,
  parseSchedules,
  type DeviceCampaign
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// The settings come from the config entry alone, and what the device
// reports from its state, so the two are read apart.
async function loadDevice(name: string, fetch: typeof globalThis.fetch) {
  try {
    const entry = getListEntryPath(FLEET_DEVICE_LIST_ROOT, name);
    const [config, state, schedules] = await Promise.all([
      restconfGetOrNull<unknown>(`${entry}?content=config`, fetch),
      restconfGetOrNull<unknown>(`${entry}?content=nonconfig`, fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    return { ...parseDeviceRead(config, state), schedules: parseSchedules(schedules), loadError: '' };
  } catch (loadError) {
    return {
      device: null,
      config: null,
      lastBoot: null,
      schedules: [],
      loadError: errorText(loadError, 'Failed to load the device.')
    };
  }
}

// Not awaited: the page shows at once, the device in a few ms and its
// campaigns after it. A device read that failed still reads them: the
// page keeps showing a device that a poll failed to read.
export const load: PageLoad = ({ fetch, depends, params }) => {
  depends('data:device');
  const device = loadDevice(params.name, fetch);
  const campaigns = device.then((d) =>
    d.device === null && !d.loadError
      ? { campaigns: [] as DeviceCampaign[], loadError: '' }
      : loadCampaigns(params.name, fetch)
  );
  return { name: params.name, device, campaigns };
};
