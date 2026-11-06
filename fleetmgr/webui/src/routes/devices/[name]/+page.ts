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

export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:device');

  try {
    const [entry, schedules] = await Promise.all([
      restconfGetOrNull<unknown>(getListEntryPath(FLEET_DEVICE_LIST_ROOT, params.name), fetch),
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)
    ]);
    const device = parseDeviceEntry(entry);
    let campaigns: DeviceCampaign[] = [];
    if (device !== null) {
      const configs = parseCampaignConfigs(await restconfGetCachedOrNull<unknown>(SOFTWARE_CONFIG, fetch));
      const member = configs.filter((c) => c.devices.includes(params.name));
      campaigns = await Promise.all(member.map((c) => inCampaign(c, params.name, fetch)));
    }
    return { name: params.name, device, campaigns, schedules: parseSchedules(schedules), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load the device.');
    return {
      name: params.name,
      device: null,
      campaigns: [] as DeviceCampaign[],
      schedules: [],
      loadError: message
    };
  }
};
