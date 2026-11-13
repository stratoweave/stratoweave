import { errorText } from '#lib/core/errors.ts';
import { restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { IMAGES_ROOT, parseImages } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

// ?folder= is the folder a new image's file goes into. ?file= is a file
// already in the image folder that the list lacks: the image gets that
// file, and starts with its file name as its name.
export const load: PageLoad = async ({ fetch, url }) => {
  const trim = (v: string | null) => (v ?? '').replace(/^\/+|\/+$/g, '');
  const folder = trim(url.searchParams.get('folder'));
  const file = trim(url.searchParams.get('file'));
  try {
    return { folder, file, images: parseImages(await restconfGetOrNull<unknown>(IMAGES_ROOT, fetch)), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load images.');
    return { folder, file, images: [], loadError: message };
  }
};
