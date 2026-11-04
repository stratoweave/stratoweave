import { restconfGetCachedOrNull } from '#lib/core/restconf/client.ts';
import {
  FLEET_ROOT,
  IMAGES_ROOT,
  SCHEDULES_ROOT,
  SOFTWARE_CONFIG,
  parseCampaigns,
  parseFleet,
  parseImages,
  parseSchedules
} from '#lib/software/model.ts';
import { nameMatcher } from '#lib/software/selection.ts';

import type { PaletteEntry } from './types';

/** Matches shown per group. Rendering every match freezes the page at 30k
 * devices; the rest is one "show all" row. */
export const GROUP_LIMIT = 8;

export const NAVIGATION: PaletteEntry[] = [
  { id: 'nav:campaigns', label: 'Campaigns', href: '/campaigns' },
  { id: 'nav:campaigns:new', label: 'New campaign', href: '/campaigns/new' },
  { id: 'nav:images', label: 'Images', href: '/images' },
  { id: 'nav:images:new', label: 'Add image', href: '/images/new' },
  { id: 'nav:devices', label: 'Devices', href: '/devices' },
  { id: 'nav:schedules', label: 'Schedules', href: '/schedules' },
  { id: 'nav:schedules:new', label: 'New schedule', href: '/schedules/new' }
];

export interface PaletteSource {
  category: string;
  /** The list page the "show all" row opens for a query. */
  listHref: (query: string) => string;
  load: () => Promise<PaletteEntry[]>;
}

function entries(route: string, items: { name: string; description?: string }[]): PaletteEntry[] {
  return items
    .map((item) => ({
      id: `${route}:${item.name}`,
      label: item.name,
      description: item.description || undefined,
      href: `/${route}/${encodeURIComponent(item.name)}`
    }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

// Reads go through the shared read cache, so the palette and the devices,
// schedules and new-campaign pages fetch the fleet once per 30 s between them.
export const SOURCES: PaletteSource[] = [
  {
    category: 'Campaigns',
    listHref: () => '/campaigns',
    load: async () => {
      const campaigns = parseCampaigns(await restconfGetCachedOrNull<unknown>(SOFTWARE_CONFIG));
      return entries('campaigns', campaigns.map((c) => ({ name: c.name, description: c.adminState })));
    }
  },
  {
    category: 'Images',
    listHref: () => '/images',
    load: async () => {
      const images = parseImages(await restconfGetCachedOrNull<unknown>(IMAGES_ROOT));
      return entries('images', images.map((i) => ({ name: i.name, description: i.version })));
    }
  },
  {
    category: 'Devices',
    listHref: (query) => (query ? `/devices?name=${encodeURIComponent(query)}` : '/devices'),
    load: async () => {
      const { devices } = parseFleet(await restconfGetCachedOrNull<unknown>(FLEET_ROOT));
      return entries('devices', devices.map((d) => ({ name: d.name, description: d.address })));
    }
  },
  {
    category: 'Schedules',
    listHref: () => '/schedules',
    load: async () => {
      const schedules = parseSchedules(await restconfGetCachedOrNull<unknown>(SCHEDULES_ROOT));
      return entries('schedules', schedules);
    }
  }
];

/** The first `limit` entries whose label matches the query the way the
 * devices page filters names (substring, or a glob with * and ?), exact
 * and prefix matches first, and the number of matches. */
export function searchEntries(
  all: PaletteEntry[],
  query: string,
  limit = GROUP_LIMIT
): { entries: PaletteEntry[]; total: number } {
  const q = query.trim();
  const match = nameMatcher(q);
  const needle = q.toLowerCase();
  const exact: PaletteEntry[] = [];
  const prefix: PaletteEntry[] = [];
  const rest: PaletteEntry[] = [];
  let total = 0;
  for (const entry of all) {
    if (!match(entry.label)) continue;
    total++;
    const label = entry.label.toLowerCase();
    const bucket = label === needle ? exact : label.startsWith(needle) ? prefix : rest;
    if (bucket.length < limit) bucket.push(entry);
  }
  return { entries: [...exact, ...prefix, ...rest].slice(0, limit), total };
}
