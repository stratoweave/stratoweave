import { restconfGetJson } from '$lib/core/restconf/client';
import { FLEET_ROOT, SOFTWARE_ROOT, parseCampaigns, parseFleet } from '$lib/software/model';

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

export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:device');

  try {
    const [fleet, software] = await Promise.all([
      getOrNull(FLEET_ROOT, fetch),
      getOrNull(SOFTWARE_ROOT, fetch)
    ]);
    const device = parseFleet(fleet).devices.find((d) => d.name === params.name) ?? null;
    const campaigns = parseCampaigns(software).filter((c) => c.devices.includes(params.name));
    return { name: params.name, device, campaigns, loadError: '' };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load the device.';
    return { name: params.name, device: null, campaigns: [], loadError: message };
  }
};
