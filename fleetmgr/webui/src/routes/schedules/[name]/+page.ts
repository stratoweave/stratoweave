import { errorText } from '#lib/core/errors.ts';
import { restconfGetCachedOrNull, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import { scheduleUsage } from '#lib/maintenance/schedule-form.ts';
import {
  CAMPAIGN_SETTINGS,
  FLEET_SCHEDULES,
  SCHEDULES_ROOT,
  parseCampaigns,
  parseFleet,
  parseSchedules
} from '#lib/software/model.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends, params }) => {
  depends('data:schedules');

  try {
    const [schedules, fleet, software] = await Promise.all([
      restconfGetOrNull<unknown>(SCHEDULES_ROOT, fetch),
      restconfGetCachedOrNull<unknown>(FLEET_SCHEDULES, fetch),
      restconfGetOrNull<unknown>(CAMPAIGN_SETTINGS, fetch)
    ]);
    const all = parseSchedules(schedules);
    const schedule = all.find((s) => s.name === params.name) ?? null;
    return {
      name: params.name,
      schedule,
      existingNames: all.map((s) => s.name),
      usage: scheduleUsage(params.name, parseFleet(fleet).devices, parseCampaigns(software)),
      loadError: ''
    };
  } catch (loadError) {
    const message = errorText(loadError, 'Failed to load the schedule.');
    return {
      name: params.name,
      schedule: null,
      existingNames: [],
      usage: { boundDevices: 0, defaultOf: [] },
      loadError: message
    };
  }
};
