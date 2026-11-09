// A campaign's plan as CSV: the maintenance window each member device is
// upgraded in. One row per device in the order the plan upgrades them, then
// the devices that fit no window. Times are on the local clock, the zone
// named in the header; a released device has its real start, and its finish
// once it is done.

import { formatCsv } from '#lib/core/csv.ts';
import { formatDateTime } from '#lib/core/time.ts';
import { deviceStart, type Campaign, type PlanDevice, type PlanWindow } from '#lib/software/model.ts';

/** The browser's time zone, e.g. Europe/Ljubljana. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
}

function at(epochSeconds: number | null): string {
  return epochSeconds === null ? '' : formatDateTime(epochSeconds);
}

/** The CSV of the campaign's plan; only the header when it has none. */
export function planToCsv(campaign: Campaign, zone: string = localZone()): string {
  const image = new Map(campaign.devices.map((name, i) => [name, campaign.images[i] ?? '']));
  const status = new Map(campaign.deviceStatus.map((r) => [r.device, r]));
  const header = [
    'device',
    'model',
    'image',
    'status',
    'schedule',
    `maintenance window start (${zone})`,
    `maintenance window end (${zone})`,
    `started (${zone})`,
    `finished (${zone})`
  ];

  const placed: { window: PlanWindow; device: PlanDevice }[] = [];
  for (const window of campaign.plan?.windows ?? []) {
    for (const device of window.devices) placed.push({ window, device });
  }
  placed.sort((a, b) => deviceStart(a.device) - deviceStart(b.device) || a.device.name.localeCompare(b.device.name));

  function common(name: string): string[] {
    const row = status.get(name);
    return [name, row?.model ?? '', image.get(name) ?? '', row?.status ?? ''];
  }

  const rows = placed.map(({ window, device: d }) => [
    ...common(d.name),
    window.schedule,
    at(window.start),
    at(window.end),
    at(d.started),
    at(d.finished)
  ]);
  for (const name of campaign.plan?.unplaced ?? []) {
    rows.push([...common(name), 'not placed', '', '', '', '']);
  }
  return formatCsv([header, ...rows]);
}
