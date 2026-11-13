import { errorText } from '#lib/core/errors.ts';
import { nextSeq } from '#lib/core/polling/poller.ts';
import { restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { fetchCountersAndAlarms } from '#lib/software/counters.ts';
import { CAMPAIGN_LIST, parseCampaigns, type Campaign } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

/** The list needs each campaign's admin state, member count, counters
 * and alarm lines, not its device rows or plan: the campaigns in one GET,
 * then one small GET of each campaign's state. */
async function withState(
  campaign: Campaign,
  fetch: typeof globalThis.fetch
): Promise<{ campaign: Campaign; alarms: string[] }> {
  const { counters, alarms } = await fetchCountersAndAlarms(campaign.name, fetch);
  return { campaign: { ...campaign, counters }, alarms };
}

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:software');
  // The page's live counters are newer than this load only if their read
  // started after this one did.
  const seq = nextSeq();

  try {
    const config = parseCampaigns(await restconfGetOrNull<unknown>(CAMPAIGN_LIST, fetch));
    const loaded = await Promise.all(config.map((c) => withState(c, fetch)));
    const alarms: Record<string, string[]> = {};
    for (const { campaign, alarms: lines } of loaded) alarms[campaign.name] = lines;
    return { seq, campaigns: loaded.map((l) => l.campaign), alarms, loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load campaigns.');
    return { seq, campaigns: [], alarms: {} as Record<string, string[]>, loadError: message };
  }
};
