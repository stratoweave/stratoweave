import type { ValidationResult } from '$lib/core/validation/types';
import type { Device, DeviceJson, FleetPatchJson } from '$lib/software/model';

export interface NewDeviceInput {
  name: string;
  type: string;
  address: string;
  port: string;
}

/** Devices per PATCH when importing in bulk. */
export const IMPORT_BATCH = 100;

export function validateNewDevice(
  input: NewDeviceInput,
  existingNames: string[]
): ValidationResult {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) {
    errors['name'] = 'A name is required.';
  } else if (existingNames.includes(name)) {
    errors['name'] = `Device ${name} already exists.`;
  }
  if (!input.type.trim()) {
    errors['type'] = 'A device type is required.';
  }
  const port = input.port.trim();
  if (port) {
    const value = Number(port);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      errors['port'] = 'Port must be 1-65535.';
    } else if (!input.address.trim()) {
      errors['port'] = 'A port needs an address.';
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export interface ImportResult {
  inputs: NewDeviceInput[];
  skippedExisting: string[];
  errors: string[];
}

/** One device per line: name[,address[,port]]. Blank lines and lines
 * starting with # are ignored. */
export function parseImport(
  text: string,
  defaultType: string,
  existingNames: Set<string>
): ImportResult {
  const inputs: NewDeviceInput[] = [];
  const skippedExisting: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [name = '', address = '', port = ''] = line.split(',').map((p) => p.trim());
    if (!name) {
      errors.push(`line ${index + 1}: no name`);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    if (existingNames.has(name)) {
      skippedExisting.push(name);
      continue;
    }
    if (port && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) {
      errors.push(`line ${index + 1}: bad port ${port}`);
      continue;
    }
    if (port && !address) {
      errors.push(`line ${index + 1}: a port needs an address`);
      continue;
    }
    inputs.push({ name, type: defaultType, address, port });
  }
  return { inputs, skippedExisting, errors };
}

/** Place each new device on the least-loaded internal worker node
 * (lexical tie-break). Deterministic within a batch; existing devices
 * never move. The placement is not shown anywhere in the UI. */
export function assignNodes(
  inputs: NewDeviceInput[],
  devices: Device[],
  nodes: string[]
): DeviceJson[] {
  if (nodes.length === 0) {
    throw new Error('No flotilla nodes declared; onboard nodes via the API first.');
  }
  const load = new Map<string, number>(nodes.map((n) => [n, 0]));
  for (const device of devices) {
    const count = load.get(device.shard);
    if (count !== undefined) load.set(device.shard, count + 1);
  }
  const pick = (): string => {
    let best = nodes[0];
    let bestLoad = load.get(best) ?? 0;
    for (const node of nodes) {
      const l = load.get(node) ?? 0;
      if (l < bestLoad || (l === bestLoad && node < best)) {
        best = node;
        bestLoad = l;
      }
    }
    return best;
  };
  return inputs.map((input) => {
    const node = pick();
    load.set(node, (load.get(node) ?? 0) + 1);
    const entry: DeviceJson = {
      name: input.name.trim(),
      type: input.type.trim(),
      shard: node,
      // Lab default; the inventory model requires credentials per entry.
      credentials: { username: 'admin', password: 'admin' }
    };
    const address = input.address.trim();
    if (address) {
      const oob: { name: string; address: string; port?: number } = { name: 'oob', address };
      const port = input.port.trim();
      if (port) oob.port = Number(port);
      entry.address = [oob];
    } else {
      // No address means there is nothing to connect to: a mock.
      entry.mock = { enabled: true };
    }
    return entry;
  });
}

export function devicesPatch(entries: DeviceJson[]): FleetPatchJson {
  return { 'fleetmgr:fleet': { device: entries } };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
