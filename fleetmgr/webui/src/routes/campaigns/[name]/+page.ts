import { errorText } from '$lib/core/errors';
import { nextSeq } from '$lib/core/polling/poller';
import { restconfGetJson } from '$lib/core/restconf/client';
import { fetchCampaignEntry } from '$lib/software/counters';
import { SCHEDULES_ROOT, parseSchedules, type Schedule } from '$lib/software/model';

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

export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:campaign');
  const seq = nextSeq();

  try {
    const [entry, schedules] = await Promise.all([fetchCampaignEntry(params.name, false, fetch), loadSchedules(fetch)]);
    return { name: params.name, seq, config: entry?.config ?? null, state: entry?.state ?? null, schedules, loadError: '' };
  } catch (loadError) {
    // config undefined: unknown, unlike null for no such campaign.
    const message = errorText(loadError, 'Failed to load the campaign.');
    return { name: params.name, seq, config: undefined, state: null, schedules: [] as Schedule[], loadError: message };
  }
};
