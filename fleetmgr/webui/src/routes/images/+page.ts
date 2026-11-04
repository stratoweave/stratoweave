import { errorText } from '$lib/core/errors';
import { restconfGetOrNull } from '$lib/core/restconf/client';
import { IMAGES_ROOT, parseImages, parseUrlBase } from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:images');

  try {
    const json = await restconfGetOrNull<unknown>(IMAGES_ROOT, fetch);
    return { images: parseImages(json), urlBase: parseUrlBase(json), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load images.');
    return { images: [], urlBase: '', loadError: message };
  }
};
