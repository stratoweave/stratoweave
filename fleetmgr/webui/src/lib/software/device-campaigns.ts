import { errorText } from '#lib/core/errors.ts';
import { getListEntryPath, restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import {
  CAMPAIGN_LIST_ROOT,
  CAMPAIGN_SETTINGS,
  parseCampaignConfigs,
  parseDeviceStatusEntry,
  parseMember,
  parseStateNode,
  planStartOf,
  planStartsPath,
  type CampaignConfig,
  type DeviceCampaign
} from '#lib/software/model.ts';

// The page polls every 5 s. Each poll reads this device's own status row
// in each of its campaigns. The rest comes through the 30 s read cache:
// the campaigns, this device's entry in each, and the start times of
// each plan.
async function inCampaign(
  config: CampaignConfig,
  member: { image: string; prepareAttempt: number },
  device: string,
  fetch: typeof globalThis.fetch
): Promise<DeviceCampaign> {
  const entry = getListEntryPath(CAMPAIGN_LIST_ROOT, config.name);
  const [status, plan, since] = await Promise.all([
    restconfGetOrNull<unknown>(getListEntryPath(`${entry}/state/device-status`, device), fetch),
    restconfGetCachedOrNull<unknown>(planStartsPath(entry), fetch),
    restconfGetCachedOrNull<unknown>(`${entry}/state?fields=run-since`, fetch)
  ]);
  return {
    name: config.name,
    adminState: config.adminState,
    runSince: parseStateNode(since)?.runSince ?? null,
    defaultSchedule: config.defaultSchedule,
    image: member.image,
    allowStaging: config.allowStaging,
    prepareAttempt: member.prepareAttempt,
    row: parseDeviceStatusEntry(status, device),
    start: planStartOf(plan, device)
  };
}

// A campaign's device list is 7 MB at 100k members, so each campaign is
// asked for this device's entry alone; a 404 means it is not a member.
export async function loadCampaigns(name: string, fetch: typeof globalThis.fetch) {
  try {
    const configs = parseCampaignConfigs(await restconfGetCachedOrNull<unknown>(CAMPAIGN_SETTINGS, fetch));
    const members = await Promise.all(
      configs.map(async (c) => {
        const entry = getListEntryPath(CAMPAIGN_LIST_ROOT, c.name);
        const path = `${getListEntryPath(`${entry}/device`, name)}?content=config`;
        return parseMember(await restconfGetCachedOrNull<unknown>(path, fetch));
      })
    );
    const memberOf: { config: CampaignConfig; member: { image: string; prepareAttempt: number } }[] = [];
    configs.forEach((config, i) => {
      const member = members[i];
      if (member !== null) memberOf.push({ config, member });
    });
    const campaigns = await Promise.all(memberOf.map((m) => inCampaign(m.config, m.member, name, fetch)));
    return { campaigns, loadError: '' };
  } catch (loadError) {
    return { campaigns: [] as DeviceCampaign[], loadError: errorText(loadError, 'Failed to load the campaigns.') };
  }
}

/** One campaign as it shows a member device; campaign null when there is no
 * such campaign or the device is not its member, which exists tells apart. */
export async function loadDeviceCampaign(
  campaign: string,
  device: string,
  fetch: typeof globalThis.fetch
): Promise<{ campaign: DeviceCampaign | null; exists: boolean; loadError: string }> {
  try {
    const config = parseCampaignConfigs(await restconfGetCachedOrNull<unknown>(CAMPAIGN_SETTINGS, fetch)).find(
      (c) => c.name === campaign
    );
    if (!config) return { campaign: null, exists: false, loadError: '' };
    const entry = getListEntryPath(CAMPAIGN_LIST_ROOT, campaign);
    const path = `${getListEntryPath(`${entry}/device`, device)}?content=config`;
    const member = parseMember(await restconfGetCachedOrNull<unknown>(path, fetch));
    if (member === null) return { campaign: null, exists: true, loadError: '' };
    return { campaign: await inCampaign(config, member, device, fetch), exists: true, loadError: '' };
  } catch (loadError) {
    return { campaign: null, exists: false, loadError: errorText(loadError, 'Failed to load the campaign.') };
  }
}
