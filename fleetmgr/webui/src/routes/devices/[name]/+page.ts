import { errorText } from '#lib/core/errors.ts';
import { getListEntryPath, restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import {
  CAMPAIGN_LIST_ROOT,
  FLEET_DEVICE_LIST_ROOT,
  SCHEDULES_ROOT,
  SOFTWARE_CONFIG,
  parseCampaignConfigs,
  parseDeviceEntry,
  parseDeviceStatusEntry,
  parseSchedules,
  planStartOf,
  type CampaignConfig,
  type DeviceCampaign
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// The page polls every 5 s. Each poll reads this device's own status row
// in each of its campaigns. The campaigns' config and plans are big (7 MB
// each at 100k members), so they come through the 30 s read cache.
async function inCampaign(config: CampaignConfig, device: string, fetch: typeof globalThis.fetch): Promise<DeviceCampaign> {
  const entry = getListEntryPath(CAMPAIGN_LIST_ROOT, config.name);
  const [status, plan] = await Promise.all([
    restconfGetOrNull<unknown>(getListEntryPath(`${entry}/state/device-status`, device), fetch),
    restconfGetCachedOrNull<unknown>(`${entry}/state/plan`, fetch)
  ]);
  return {
    name: config.name,
    adminState: config.adminState,
    defaultSchedule: config.defaultSchedule,
    image: config.images[config.devices.indexOf(device)] ?? '',
    row: parseDeviceStatusEntry(status, device),
    start: planStartOf(plan, device)
  };
}

async function loadDevice(name: string, fetch: typeof globalThis.fetch) {
  try {
    const [entry, schedules] = await Promise.all([
      restconfGetOrNull<unknown>(getListEntryPath(FLEET_DEVICE_LIST_ROOT, name), fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    return { device: parseDeviceEntry(entry), schedules: parseSchedules(schedules), loadError: '' };
  } catch (loadError) {
    return { device: null, schedules: [], loadError: errorText(loadError, 'Failed to load the device.') };
  }
}

async function loadCampaigns(name: string, fetch: typeof globalThis.fetch) {
  try {
    const configs = parseCampaignConfigs(await restconfGetCachedOrNull<unknown>(SOFTWARE_CONFIG, fetch));
    const member = configs.filter((c) => c.devices.includes(name));
    return { campaigns: await Promise.all(member.map((c) => inCampaign(c, name, fetch))), loadError: '' };
  } catch (loadError) {
    return { campaigns: [] as DeviceCampaign[], loadError: errorText(loadError, 'Failed to load the campaigns.') };
  }
}

// Not awaited: the page shows at once, the device in a few ms and its
// campaigns after it.
export const load: PageLoad = ({ fetch, depends, params }) => {
  depends('data:device');
  const device = loadDevice(params.name, fetch);
  const campaigns = device.then((d) =>
    d.device === null ? { campaigns: [] as DeviceCampaign[], loadError: '' } : loadCampaigns(params.name, fetch)
  );
  return { name: params.name, device, campaigns };
};
