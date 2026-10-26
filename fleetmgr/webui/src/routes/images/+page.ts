import { errorText } from '$lib/core/errors';
import { restconfGetOrNull } from '$lib/core/restconf/client';
import { IMAGES_ROOT, parseImages } from '$lib/software/model';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
  depends('data:images');

  try {
    return { images: parseImages(await restconfGetOrNull<unknown>(IMAGES_ROOT, fetch)), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load images.');
    return { images: [], loadError: message };
  }
};
