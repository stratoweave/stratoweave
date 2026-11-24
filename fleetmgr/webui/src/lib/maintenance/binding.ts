// A device binds to a schedule with the `schedule` leaf on its fleet entry.

import { rewriteListEntry } from '#lib/core/restconf/client.ts';
import { FLEET_DEVICE_LIST_ROOT, type FleetPatchJson } from '#lib/software/model.ts';

/** A merge, so one PATCH binds any number of devices. */
export function bindPatch(names: string[], schedule: string): FleetPatchJson {
  return { 'fleetmgr:fleet': { device: names.map((name) => ({ name, schedule })) } };
}

/** The entry goes back as read, without the leaf. */
export function unbindDevice(name: string): Promise<void> {
  return rewriteListEntry(FLEET_DEVICE_LIST_ROOT, name, (entry) => {
    if (entry.schedule === undefined) return null;
    const rest = { ...entry };
    delete rest.schedule;
    return rest;
  });
}
