import { errorText } from '$lib/core/errors';
import { getListEntryPath, restconfGetOrNull } from '$lib/core/restconf/client';
import { IMAGES_ROOT, IMAGE_LIST_ROOT, parseImageEntry, parseImages } from '$lib/software/model';

import type { PageLoad } from './$types';

// The list feeds the form's OS and model suggestions.
export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:images');

  try {
    const [entry, list] = await Promise.all([
      restconfGetOrNull<unknown>(getListEntryPath(IMAGE_LIST_ROOT, params.name), fetch),
      restconfGetOrNull<unknown>(IMAGES_ROOT, fetch)
    ]);
    return { name: params.name, image: parseImageEntry(entry), images: parseImages(list), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load the image.');
    return { name: params.name, image: null, images: [], loadError: message };
  }
};
