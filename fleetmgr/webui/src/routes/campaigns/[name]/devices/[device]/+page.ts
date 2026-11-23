import { errorText } from '#lib/core/errors.ts';
import { getListEntryPath, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { loadDeviceCampaign } from '#lib/software/device-campaigns.ts';
import { DEVICE_FIELDS, FLEET_DEVICE_LIST_ROOT, parseDeviceEntry } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

/** device null when the fleet has no such device. */
async function loadDevice(name: string, fetch: typeof globalThis.fetch) {
  try {
    const entry = await restconfGetOrNull<unknown>(
      `${getListEntryPath(FLEET_DEVICE_LIST_ROOT, name)}?fields=${DEVICE_FIELDS}`,
      fetch
    );
    return { device: parseDeviceEntry(entry), loadError: '' };
  } catch (loadError) {
    return { device: null, loadError: errorText(loadError, 'Failed to load the device.') };
  }
}

// Not awaited: the page shows at once and fills in when both are in, in a
// few ms.
export const load: PageLoad = ({ fetch, depends, params }) => {
  depends('data:campaign-device');
  return {
    campaignName: params.name,
    deviceName: params.device,
    device: loadDevice(params.device, fetch),
    campaign: loadDeviceCampaign(params.name, params.device, fetch)
  };
};
