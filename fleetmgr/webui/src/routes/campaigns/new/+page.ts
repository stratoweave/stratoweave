import { restconfGetJson } from '$lib/core/restconf/client';
import { FLEET_ROOT, SOFTWARE_ROOT, parseCampaigns, parseCatalog, parseFleet } from '$lib/software/model';

import type { PageLoad } from './$types';

// 404 just means nothing has been configured yet.
async function getOrNull(path: string, fetchFn: typeof fetch): Promise<unknown> {
  try {
    return await restconfGetJson<unknown>(path, fetchFn);
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

export const load: PageLoad = async ({ fetch }) => {
  try {
    const [software, fleet] = await Promise.all([
      getOrNull(SOFTWARE_ROOT, fetch),
      getOrNull(FLEET_ROOT, fetch)
    ]);
    const { images, matrix } = parseCatalog(software);
    return {
      devices: parseFleet(fleet).devices,
      campaigns: parseCampaigns(software),
      images,
      matrix,
      loadError: ''
    };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load inventory.';
    return { devices: [], campaigns: [], images: [], matrix: [], loadError: message };
  }
};
