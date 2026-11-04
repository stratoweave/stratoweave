import { errorText } from '#lib/core/errors.ts';
import { nextSeq } from '#lib/core/polling/poller.ts';
import { restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { fetchCounters, fetchPlanAlarms } from '#lib/software/counters.ts';
import { IMAGES_ROOT, SOFTWARE_CONFIG, parseCampaigns, parseImages, type Campaign } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

/** The list needs each campaign's config, counters and alarm lines, not
 * its device rows or plan: config in one GET, the rest in small GETs. */
async function withState(
  campaign: Campaign,
  fetch: typeof globalThis.fetch
): Promise<{ campaign: Campaign; alarms: string[] }> {
  const [counters, alarms] = await Promise.all([
    fetchCounters(campaign.name, fetch),
    fetchPlanAlarms(campaign.name, fetch)
  ]);
  return { campaign: { ...campaign, counters }, alarms };
}

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:software');
  // The page's live counters are newer than this load only if their read
  // started after this one did.
  const seq = nextSeq();

  try {
    const [software, images] = await Promise.all([
      restconfGetOrNull<unknown>(SOFTWARE_CONFIG, fetch),
      restconfGetOrNull<unknown>(IMAGES_ROOT, fetch)
    ]);
    const config = parseCampaigns(software);
    const loaded = await Promise.all(config.map((c) => withState(c, fetch)));
    const alarms: Record<string, string[]> = {};
    for (const { campaign, alarms: lines } of loaded) alarms[campaign.name] = lines;
    return { seq, campaigns: loaded.map((l) => l.campaign), alarms, images: parseImages(images), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load campaigns.');
    return { seq, campaigns: [], alarms: {} as Record<string, string[]>, images: [], loadError: message };
  }
};
