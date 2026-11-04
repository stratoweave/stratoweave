import { errorText } from '#lib/core/errors.ts';
import { fetchLayer, parseContent, parseFormat } from '#lib/core/layer-config.ts';

import type { PageLoad } from './$types';

// Layer 0 holds what operators write (images, schedules, the fleet,
// campaigns) and the state its transforms publish (campaign progress).
// The choice lives in the URL, so Refresh and links keep it.
export const load: PageLoad = async ({ fetch, url }) => {
  const content = parseContent(url.searchParams.get('content'));
  const format = parseFormat(url.searchParams.get('format'));

  try {
    return { content, format, text: await fetchLayer(0, content, format, fetch), loadError: '' };
  } catch (loadError) {
    return { content, format, text: '', loadError: errorText(loadError, 'Failed to load the config.') };
  }
};
