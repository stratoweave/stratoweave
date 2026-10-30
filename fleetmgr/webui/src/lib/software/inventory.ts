import type { ValidationResult } from '$lib/core/validation/types';
import type { DeviceJson, FleetPatchJson } from '$lib/software/model';

export interface NewDeviceInput {
  name: string;
  type: string;
  address: string;
  port: string;
  username: string;
  password: string;
}

/** What import gives every device it adds. */
export interface ImportShared {
  type: string;
  username: string;
  password: string;
}

/** Devices per PATCH when importing in bulk. */
export const IMPORT_BATCH = 100;

function validPort(text: string): boolean {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

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
  if (!input.username.trim()) {
    errors['username'] = 'A username is required.';
  }
  // The NETCONF adapter connects only with a password; mocks need none.
  if (input.address.trim() && !input.password) {
    errors['password'] = 'Required with an address.';
  }
  const port = input.port.trim();
  if (port) {
    if (!validPort(port)) {
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
  shared: ImportShared,
  existingNames: Set<string>
): ImportResult {
  const inputs: NewDeviceInput[] = [];
  const skippedExisting: string[] = [];
  const errors: string[] = [];
  if (!shared.username.trim()) errors.push('no username');
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
    if (port && !validPort(port)) {
      errors.push(`line ${index + 1}: bad port ${port}`);
      continue;
    }
    if (port && !address) {
      errors.push(`line ${index + 1}: a port needs an address`);
      continue;
    }
    inputs.push({ name, ...shared, address, port });
  }
  if (!shared.password && inputs.some((input) => input.address)) {
    errors.push('devices with an address need a password');
  }
  return { inputs, skippedExisting, errors };
}

/** The fleet entries for new devices. The top places each device on a
 * flotilla by its name, so the entries carry no placement. */
export function deviceEntries(inputs: NewDeviceInput[]): DeviceJson[] {
  return inputs.map((input) => {
    const credentials: { username: string; password?: string } = { username: input.username.trim() };
    if (input.password) credentials.password = input.password;
    const entry: DeviceJson = { name: input.name.trim(), type: input.type.trim(), credentials };
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
