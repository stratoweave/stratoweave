import { errorText } from '#lib/core/errors.ts';
import { nextSeq } from '#lib/core/polling/poller.ts';
import { restconfGetJson } from '#lib/core/restconf/client.ts';
import { fetchCampaignEntry } from '#lib/software/counters.ts';
import { SCHEDULES_ROOT, parseSchedules, type CampaignConfig, type Schedule, type StateParts } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

async function loadSchedules(fetch: typeof globalThis.fetch): Promise<Schedule[]> {
  // The campaign renders without them; a failure only blanks the
  // default-schedule windows line.
  try {
    return parseSchedules(await restconfGetJson<unknown>(SCHEDULES_ROOT, fetch));
  } catch {
    return [];
  }
}

/** config undefined: unknown, unlike null for no such campaign. */
async function loadEntry(
  name: string,
  fetch: typeof globalThis.fetch
): Promise<{ config: CampaignConfig | null | undefined; state: StateParts | null; loadError: string }> {
  try {
    const entry = await fetchCampaignEntry(name, false, fetch);
    return { config: entry?.config ?? null, state: entry?.state ?? null, loadError: '' };
  } catch (loadError) {
    return { config: undefined, state: null, loadError: errorText(loadError, 'Failed to load the campaign.') };
  }
}

// Not awaited: the page shows at once and fills in when the entry is in,
// 22 MB and 1 s at 100k members. The schedules go first, being small.
export const load: PageLoad = ({ fetch, depends, params }) => {
  depends('data:campaign');
  const seq = nextSeq();
  const schedules = loadSchedules(fetch);
  return { name: params.name, seq, entry: loadEntry(params.name, fetch), schedules };
};
