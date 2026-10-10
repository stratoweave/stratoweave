import { errorText } from '$lib/core/errors';
import { restconfGetOrNull } from '$lib/core/restconf/client';
import { SOFTWARE_ROOT, parseCampaigns } from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:software');

  try {
    const response = await restconfGetOrNull<unknown>(SOFTWARE_ROOT, fetch);
    return { campaigns: parseCampaigns(response), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load campaigns.');
    return { campaigns: [], loadError: message };
  }
};
