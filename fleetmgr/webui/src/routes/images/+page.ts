import { errorText } from '#lib/core/errors.ts';
import { restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { IMAGES_ROOT, parseImages, parseUrlBase } from '#lib/software/model.ts';

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
