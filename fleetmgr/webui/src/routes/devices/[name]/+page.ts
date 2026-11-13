import { errorText } from '#lib/core/errors.ts';
import { getListEntryPath, restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import {
  CAMPAIGN_LIST_ROOT,
  CAMPAIGN_SETTINGS,
  FLEET_DEVICE_LIST_ROOT,
  SCHEDULES_ROOT,
  parseCampaignConfigs,
  parseDeviceEntry,
  parseDeviceStatusEntry,
  parseMemberImage,
  parseSchedules,
  planStartOf,
  planStartsPath,
  type CampaignConfig,
  type DeviceCampaign
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// The page polls every 5 s. Each poll reads this device's own status row
// in each of its campaigns. The rest comes through the 30 s read cache:
// the campaigns, this device's entry in each, and the start times of
// each plan.
async function inCampaign(
  config: CampaignConfig,
  image: string,
  device: string,
  fetch: typeof globalThis.fetch
): Promise<DeviceCampaign> {
  const entry = getListEntryPath(CAMPAIGN_LIST_ROOT, config.name);
  const [status, plan] = await Promise.all([
    restconfGetOrNull<unknown>(getListEntryPath(`${entry}/state/device-status`, device), fetch),
    restconfGetCachedOrNull<unknown>(planStartsPath(entry), fetch)
  ]);
  return {
    name: config.name,
    adminState: config.adminState,
    defaultSchedule: config.defaultSchedule,
    image,
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

// A campaign's device list is 7 MB at 100k members, so each campaign is
// asked for this device's entry alone; a 404 means it is not a member.
async function loadCampaigns(name: string, fetch: typeof globalThis.fetch) {
  try {
    const configs = parseCampaignConfigs(await restconfGetCachedOrNull<unknown>(CAMPAIGN_SETTINGS, fetch));
    const images = await Promise.all(
      configs.map(async (c) => {
        const entry = getListEntryPath(CAMPAIGN_LIST_ROOT, c.name);
        const path = `${getListEntryPath(`${entry}/device`, name)}?content=config`;
        return parseMemberImage(await restconfGetCachedOrNull<unknown>(path, fetch));
      })
    );
    const memberOf: { config: CampaignConfig; image: string }[] = [];
    configs.forEach((config, i) => {
      const image = images[i];
      if (image !== null) memberOf.push({ config, image });
    });
    const campaigns = await Promise.all(memberOf.map((m) => inCampaign(m.config, m.image, name, fetch)));
    return { campaigns, loadError: '' };
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
