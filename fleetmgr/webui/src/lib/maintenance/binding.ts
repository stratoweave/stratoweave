// A device binds to a schedule with the `schedule` leaf on its fleet entry.

import {
  getListEntryPath,
  restconfGetJson,
  restconfPatchJson,
  restconfPutJson,
  wrapListEntryBody
} from '$lib/core/restconf/client';
import { DATA_ROOT, FLEET_DEVICE_LIST_ROOT, type FleetPatchJson } from '$lib/software/model';

/** A merge, so one PATCH binds any number of devices. */
export function bindPatch(names: string[], schedule: string): FleetPatchJson {
  return { 'fleetmgr:fleet': { device: names.map((name) => ({ name, schedule })) } };
}

/** Removing the leaf takes a PUT of the whole entry without it: DELETE on
 * a leaf returns 500 upstream and a PATCH only merges. The entry is read
 * right before the write and sent back as read, so nothing else on it
 * changes. */
export async function unbindDevice(name: string): Promise<void> {
  const path = getListEntryPath(FLEET_DEVICE_LIST_ROOT, name);
  const got = await restconfGetJson<{ 'fleetmgr:device'?: Record<string, unknown>[] }>(path);
  const entry = got?.['fleetmgr:device']?.[0];
  if (!entry) throw new Error(`Device ${name} is not in the fleet.`);
  if (entry.schedule === undefined) return;
  const rest = { ...entry };
  delete rest.schedule;
  await restconfPutJson(path, wrapListEntryBody(FLEET_DEVICE_LIST_ROOT, rest));
}

/** '' unbinds. */
export async function setDeviceSchedule(name: string, schedule: string): Promise<void> {
  if (schedule) {
    await restconfPatchJson(DATA_ROOT, bindPatch([name], schedule));
  } else {
    await unbindDevice(name);
  }
}
