import { restconfGetJson } from '$lib/core/restconf/client';
import { FLEET_ROOT, parseFleet } from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:software');

  try {
    const response = await restconfGetJson<unknown>(FLEET_ROOT, fetch);
    const { nodes, devices } = parseFleet(response);
    return { nodes, devices, loadError: '' };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load devices.';
    return {
      nodes: [],
      devices: [],
      // 404 just means nothing has been configured yet.
      loadError: message.includes('404') ? '' : message
    };
  }
};
