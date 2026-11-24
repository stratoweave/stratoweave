import { errorText } from '#lib/core/errors.ts';
import { nextSeq } from '#lib/core/polling/poller.ts';
import { restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { fetchCampaignEntry } from '#lib/software/counters.ts';
import type { CatalogImage } from '#lib/software/images.ts';
import {
  IMAGES_ROOT,
  SCHEDULES_ROOT,
  parseImages,
  parseSchedules,
  type CampaignConfig,
  type Schedule,
  type StateParts
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

async function loadSchedules(fetch: typeof globalThis.fetch): Promise<{ schedules: Schedule[]; error: string }> {
  // The campaign renders without them; only its schedule field needs them.
  // None at all is a 404.
  try {
    return { schedules: parseSchedules(await restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch)), error: '' };
  } catch (error) {
    return { schedules: [], error: errorText(error, 'Failed to load the schedules.') };
  }
}

/** The image catalog, for the releases the members upgrade to. Without it
 * the page reads them from the image names. */
async function loadCatalog(fetch: typeof globalThis.fetch): Promise<CatalogImage[]> {
  try {
    return parseImages(await restconfGetOrNull<unknown>(IMAGES_ROOT, fetch));
  } catch {
    return [];
  }
}

/** config undefined: unknown, unlike null for no such campaign. */
async function loadEntry(
  name: string,
  fetch: typeof globalThis.fetch
): Promise<{ config: CampaignConfig | null | undefined; state: StateParts | null; loadError: string }> {
  try {
    const entry = await fetchCampaignEntry(name, false, fetch);
    return { config: entry?.config ?? null, state: entry?.state ?? null, loadError: '' };
  } catch (loadError) {
    return { config: undefined, state: null, loadError: errorText(loadError, 'Failed to load the campaign.') };
  }
}

// Not awaited: the page shows at once and fills in when the entry is in,
// 22 MB and 1 s at 100k members. The schedules go first, being small.
export const load: PageLoad = ({ fetch, depends, params }) => {
  depends('data:campaign');
  const seq = nextSeq();
  const schedules = loadSchedules(fetch);
  const catalog = loadCatalog(fetch);
  return { name: params.name, seq, entry: loadEntry(params.name, fetch), schedules, catalog };
};
