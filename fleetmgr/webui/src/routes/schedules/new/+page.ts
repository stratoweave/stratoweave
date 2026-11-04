import { errorText } from '#lib/core/errors.ts';
import { restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { SCHEDULES_ROOT, parseSchedules } from '#lib/software/model.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  try {
    const schedules = parseSchedules(await restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch));
    return { existingNames: schedules.map((s) => s.name), loadError: '' };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load schedules.');
    return { existingNames: [], loadError: message };
  }
};
