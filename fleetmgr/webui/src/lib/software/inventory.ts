import type { ValidationResult } from '#lib/core/validation/types.ts';
import type { DeviceJson, FleetPatchJson } from '#lib/software/model.ts';

/** The extra adapter that connects to the CLI of an IOS XE device over
 * SSH. */
export const CLI_ADAPTER = 'iosxe-cli';

/** A private key file as read in the browser. */
export interface PrivateKey {
  /** The file name, which names the key in the device's credentials. */
  name: string;
  text: string;
}

export interface NewDeviceInput {
  name: string;
  type: string;
  address: string;
  port: string;
  username: string;
  password: string;
  /** null for none. */
  key: PrivateKey | null;
  /** Whether the device also connects to its CLI, as the CLI_ADAPTER
   * extra adapter. */
  cli: boolean;
  /** The CLI's port as typed; '' for the adapter's own, 22. */
  cliPort: string;
}

/** What import gives every device it adds. The CLI goes only to devices
 * with an address. */
export type ImportShared = Pick<NewDeviceInput, 'type' | 'username' | 'password' | 'key' | 'cli' | 'cliPort'>;

/** Devices per PATCH when importing in bulk. At 100k devices a PATCH costs
 * 0.6 s however small, so batches are big. Each flotilla gets about a
 * tenth of a batch in one edit; its SSH write buffer (8 MiB) takes 1k
 * devices but not 10k. */
export const IMPORT_BATCH = 5000;

export function validPort(text: string): boolean {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/** The cipher an OpenSSH private key is encrypted with, 'none' without a
 * passphrase; null when the text is no OpenSSH key. */
function openSSHCipher(text: string): string | null {
  const m = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(text);
  if (!m) return null;
  let bytes: string;
  try {
    bytes = atob(m[1].replace(/\s+/g, ''));
  } catch {
    return null;
  }
  // The magic, then the cipher name as a 4-byte length and its bytes.
  const magic = 'openssh-key-v1\0';
  if (!bytes.startsWith(magic)) return null;
  const at = magic.length;
  const length = [0, 1, 2, 3].reduce((n, i) => n * 256 + bytes.charCodeAt(at + i), 0);
  return bytes.slice(at + 4, at + 4 + length);
}

/** Why the adapters cannot log in with a key file; '' when they can. They
 * take no passphrase. */
export function keyError(text: string): string {
  if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return 'Not a private key file.';
  const cipher = openSSHCipher(text);
  if (text.includes('ENCRYPTED') || (cipher !== null && cipher !== 'none')) {
    return 'Use a key without a passphrase.';
  }
  return '';
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
  // The adapters log in with a password or a key; mocks need neither.
  if (input.address.trim() && !input.password && !input.key) {
    errors['password'] = 'A password or a key is required.';
  }
  const port = input.port.trim();
  if (port) {
    if (!validPort(port)) {
      errors['port'] = 'Port must be 1-65535.';
    } else if (!input.address.trim()) {
      errors['port'] = 'A port needs an address.';
    }
  }
  if (input.key) {
    const bad = keyError(input.key.text);
    if (bad) errors['key'] = bad;
  }
  if (input.cli) {
    const cliPort = input.cliPort.trim();
    if (!input.address.trim()) {
      errors['cli'] = 'The CLI needs an address.';
    } else if (cliPort && !validPort(cliPort)) {
      errors['cli'] = 'Port must be 1-65535.';
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
  if (shared.key && keyError(shared.key.text)) errors.push('the key file cannot be used');
  const cliPort = shared.cliPort.trim();
  if (shared.cli && cliPort && !validPort(cliPort)) errors.push(`bad CLI port ${cliPort}`);
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
    inputs.push({ name, ...shared, address, port, cli: shared.cli && address !== '' });
  }
  if (!shared.password && !shared.key && inputs.some((input) => input.address)) {
    errors.push('devices with an address need a password or a key');
  }
  return { inputs, skippedExisting, errors };
}

/** The fleet entries for new devices. The top places each device on a
 * flotilla by its name, so the entries carry no placement. */
export function deviceEntries(inputs: NewDeviceInput[]): DeviceJson[] {
  return inputs.map((input) => {
    const credentials: NonNullable<DeviceJson['credentials']> = { username: input.username.trim() };
    if (input.password) credentials.password = input.password;
    if (input.key) credentials.key = [{ key: input.key.name, 'private-key': input.key.text }];
    const entry: DeviceJson = { name: input.name.trim(), type: input.type.trim(), credentials };
    const address = input.address.trim();
    if (address) {
      const oob: { name: string; address: string; port?: number } = { name: 'oob', address };
      const port = input.port.trim();
      if (port) oob.port = Number(port);
      entry.address = [oob];
      if (input.cli) {
        const cli: { type: string; port?: number } = { type: CLI_ADAPTER };
        const cliPort = input.cliPort.trim();
        if (cliPort) cli.port = Number(cliPort);
        entry['extra-adapter'] = [cli];
      }
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
