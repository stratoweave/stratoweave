import { getListEntryPath, restconfGetJson } from '$lib/core/restconf/client';
import { CAMPAIGN_LIST_ROOT, parseCampaignEntry } from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:campaign');

  try {
    const response = await restconfGetJson<unknown>(
      getListEntryPath(CAMPAIGN_LIST_ROOT, params.name),
      fetch
    );
    return { name: params.name, campaign: parseCampaignEntry(response), loadError: '' };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load the campaign.';
    return {
      name: params.name,
      campaign: null,
      loadError: message.includes('404') ? '' : message
    };
  }
};
