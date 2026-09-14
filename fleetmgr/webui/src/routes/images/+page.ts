import { restconfGetJson } from '$lib/core/restconf/client';
import { SOFTWARE_ROOT, parseCatalog } from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:catalog');

  try {
    const response = await restconfGetJson<unknown>(SOFTWARE_ROOT, fetch);
    const { images, matrix } = parseCatalog(response);
    return { images, matrix, loadError: '' };
  } catch (loadError) {
    const message = loadError instanceof Error ? loadError.message : 'Failed to load the catalogue.';
    return {
      images: [],
      matrix: [],
      // 404 just means nothing has been configured yet.
      loadError: message.includes('404') ? '' : message
    };
  }
};
