import { getListEntryPath, restconfGetJson } from '$lib/core/restconf/client';
import {
  CAMPAIGN_LIST_ROOT,
  SCHEDULES_ROOT,
  parseCampaignEntry,
  parseSchedules,
  type Schedule
} from '$lib/software/model';

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

  try {
    const [response, schedules] = await Promise.all([
      restconfGetJson<unknown>(getListEntryPath(CAMPAIGN_LIST_ROOT, params.name), fetch),
      loadSchedules(fetch)
    ]);
    return { name: params.name, campaign: parseCampaignEntry(response), schedules, loadError: '' };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load the campaign.';
    return {
      name: params.name,
      campaign: null,
      schedules: [] as Schedule[],
      loadError: message.includes('404') ? '' : message
    };
  }
};
