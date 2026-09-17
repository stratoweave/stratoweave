import { restconfGetJson } from '$lib/core/restconf/client';
import { SOFTWARE_ROOT, parseCampaigns } from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:software');

  try {
    const response = await restconfGetJson<unknown>(SOFTWARE_ROOT, fetch);
    return { campaigns: parseCampaigns(response), loadError: '' };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load campaigns.';
    return {
      campaigns: [],
      // 404 just means nothing has been configured yet.
      loadError: message.includes('404') ? '' : message
    };
  }
};
