// A device's settings as its page edits them. The page reads the device's
// config entry with content=config and puts SECRET_PLACEHOLDER in place of
// every password and private key at once, so that none is kept or shown.
// Each card saves only the leaves it changed, into the entry as stored at
// the save: the rest of the entry, secrets included, stays as it is.

import { errorText } from '#lib/core/errors.ts';
import { rewriteListEntry } from '#lib/core/restconf/client.ts';
import { keyError, validPort, type PrivateKey } from '#lib/software/inventory.ts';
import { FLEET_DEVICE_LIST_ROOT, parseDeviceEntry, type Device } from '#lib/software/model.ts';

type Json = Record<string, unknown>;

export type Errors = Record<string, string>;

/** What a card hands its fields. */
export interface CardFields<D> {
  draft: D;
  set: (next: D) => void;
  /** By field, once the card has been touched. */
  errors: Errors;
  /** A field was left: the card's errors show from then on. */
  touch: () => void;
  disabled: boolean;
}

interface KeyJson {
  key: string;
  'private-key'?: string;
}

/** A device's config entry as YANG JSON, typed for the lists and leaves
 * that are not plain leaves of a card; the rest goes through as read. */
export interface DeviceConfig {
  name: string;
  address?: { name: string; address?: string; port?: number | string }[];
  credentials?: { username?: string; password?: string; key?: KeyJson[] };
  'extra-adapter'?: { type: string; address?: string; port?: number | string }[];
  [leaf: string]: unknown;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── Secrets ──

/** Shows in place of a stored password or private key. */
export const SECRET_PLACEHOLDER = '••••••';
const SECRET_LEAVES = new Set(['password', 'private-key']);

/** `value` with every password and private key replaced by the placeholder. */
export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SECRET_LEAVES.has(k) && typeof v === 'string' ? SECRET_PLACEHOLDER : maskSecrets(v)
    ])
  );
}

// The keys a list entry of a device entry is told by: address and module by
// name, extra-adapter by type, a credentials key by key, and initial
// credentials by username and key, besides their password.
const ENTRY_KEYS = ['name', 'type', 'key', 'username'];

function entryKeys(entry: unknown): (string | null)[] {
  return ENTRY_KEYS.map((k) => (isObject(entry) && typeof entry[k] === 'string' ? entry[k] : null));
}

/** `edited` with the value `stored` has wherever `edited` still has the
 * placeholder, and the places where `stored` has none. A list entry finds
 * its stored one by its keys, not by its place in the list. */
export function restoreSecrets(edited: unknown, stored: unknown): { value: unknown; missing: string[] } {
  const missing: string[] = [];
  function walk(e: unknown, s: unknown, at: string): unknown {
    if (Array.isArray(e)) {
      const pool = Array.isArray(s) ? s : [];
      const seen = new Map<string, number>();
      return e.map((item) => {
        const keys = entryKeys(item);
        const id = JSON.stringify(keys);
        const nth = seen.get(id) ?? 0;
        seen.set(id, nth + 1);
        const match = pool.filter((p) => JSON.stringify(entryKeys(p)) === id)[nth];
        return walk(item, match, `${at}[${keys.find((k) => k !== null) ?? ''}]`);
      });
    }
    if (!isObject(e)) return e;
    const from = isObject(s) ? s : {};
    return Object.fromEntries(
      Object.entries(e).map(([k, v]) => {
        const here = at ? `${at}/${k}` : k;
        if (!SECRET_LEAVES.has(k) || v !== SECRET_PLACEHOLDER) return [k, walk(v, from[k], here)];
        if (typeof from[k] === 'string') return [k, from[k]];
        missing.push(here);
        return [k, v];
      })
    );
  }
  return { value: walk(edited, stored, ''), missing };
}

function missingText(missing: string[]): string {
  return `Nothing is stored for ${missing.join(', ')}: type the value in place of ${SECRET_PLACEHOLDER}.`;
}

// ── Reading and writing ──

export interface DeviceRead {
  /** null when there is no such device. */
  device: Device | null;
  /** Its config entry, secrets masked; null when there is no such device. */
  config: DeviceConfig | null;
  /** When it last booted, in seconds since the Unix epoch by its clock;
   * null when it does not say. */
  lastBoot: number | null;
}

/** The device from a read of its config entry and one of its state. */
export function parseDeviceRead(configJson: unknown, stateJson: unknown): DeviceRead {
  const entry = (configJson as { 'fleetmgr:device'?: unknown[] } | null)?.['fleetmgr:device']?.[0];
  if (!isObject(entry) || typeof entry.name !== 'string') return { device: null, config: null, lastBoot: null };
  const config = maskSecrets(entry) as DeviceConfig;
  const state = (stateJson as { 'fleetmgr:device'?: { state?: Json }[] } | null)?.['fleetmgr:device']?.[0]?.state;
  const device = parseDeviceEntry({ 'fleetmgr:device': [{ ...config, state }] });
  const platform = state?.platform;
  // uint64: a number from StratoWeave, a string in RFC 7951 JSON.
  const boot = Number(isObject(platform) ? platform['last-boot'] : undefined);
  return { device, config, lastBoot: Number.isFinite(boot) && boot > 0 ? boot : null };
}

/** Rewrites the entry of device `name` as `edit` changes it; `edit` gets
 * the entry as stored now, secrets included. */
export function rewriteDevice(name: string, edit: (entry: Json) => Json): Promise<void> {
  return rewriteListEntry(FLEET_DEVICE_LIST_ROOT, name, (entry) => {
    const next = { ...edit(entry) };
    // The read has the state too, which is not config.
    delete next.state;
    return next;
  });
}

// ── Cards of plain leaves ──

interface LeafSpec {
  /** From the device entry, e.g. ['mock', 'software', 'failure']. */
  path: readonly string[];
  kind: 'text' | 'uint' | 'bool' | 'enum';
  /** What an absent bool or enum leaf is: its YANG default. */
  fallback?: boolean | string;
  /** The range of a uint. */
  min?: number;
  max?: number;
  /** The error for an empty field; without it, emptying removes the leaf. */
  required?: string;
}

type LeafSpecs = Record<string, LeafSpec>;

/** A card's leaves as its fields show them: a bool as a checkbox, the rest
 * as text, '' for an absent leaf. */
export type LeafDraft<S extends LeafSpecs> = { [F in keyof S]: S[F] extends { kind: 'bool' } ? boolean : string };

export interface LeafCard<S extends LeafSpecs> {
  read: (entry: DeviceConfig) => LeafDraft<S>;
  same: (a: LeafDraft<S>, b: LeafDraft<S>) => boolean;
  validate: (draft: LeafDraft<S>) => Errors;
  /** `entry` with the leaves that `draft` changed from `base`. */
  apply: (entry: Json, base: LeafDraft<S>, draft: LeafDraft<S>) => Json;
}

/** What a field stores: undefined for nothing. A whole number goes as a
 * number, other text as typed, for its error. */
function leafValue(spec: LeafSpec, shown: string | boolean): unknown {
  if (typeof shown === 'boolean') return shown;
  const text = shown.trim();
  if (!text) return undefined;
  return spec.kind === 'uint' && /^\d+$/.test(text) ? Number(text) : text;
}

function getPath(entry: Json, path: readonly string[]): unknown {
  let at: unknown = entry;
  for (const key of path) at = isObject(at) ? at[key] : undefined;
  return at;
}

/** A copy of `obj` with the leaf at `path` set, or removed for undefined
 * together with the containers that leaves empty. */
function setPath(obj: Json, path: readonly string[], value: unknown): Json {
  const [key, ...rest] = path;
  const inner = obj[key];
  const child = rest.length === 0 ? value : setPath(isObject(inner) ? inner : {}, rest, value);
  const next = { ...obj };
  if (child === undefined || (isObject(child) && Object.keys(child).length === 0)) delete next[key];
  else next[key] = child;
  return next;
}

function leafCard<S extends LeafSpecs>(specs: S): LeafCard<S> {
  const fields = Object.entries(specs);
  const shown = (draft: LeafDraft<S>, field: string) => (draft as Record<string, string | boolean>)[field];
  const changed = (a: LeafDraft<S>, b: LeafDraft<S>) =>
    fields.filter(([f, spec]) => leafValue(spec, shown(a, f)) !== leafValue(spec, shown(b, f)));
  return {
    read(entry) {
      const draft: Record<string, string | boolean> = {};
      for (const [f, spec] of fields) {
        const value = getPath(entry, spec.path);
        if (spec.kind === 'bool') draft[f] = typeof value === 'boolean' ? value : spec.fallback === true;
        else draft[f] = value === undefined || value === null ? String(spec.fallback ?? '') : String(value);
      }
      return draft as LeafDraft<S>;
    },
    same: (a, b) => changed(a, b).length === 0,
    validate(draft) {
      const errors: Errors = {};
      for (const [f, spec] of fields) {
        const value = shown(draft, f);
        if (typeof value === 'boolean') continue;
        const text = value.trim();
        if (!text) {
          if (spec.required) errors[f] = spec.required;
        } else if (spec.kind === 'uint') {
          const min = spec.min ?? 0;
          const max = spec.max ?? 65535;
          if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) {
            errors[f] = `Must be a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}.`;
          }
        }
      }
      return errors;
    },
    apply: (entry, base, draft) =>
      changed(base, draft).reduce((next, [f, spec]) => setPath(next, spec.path, leafValue(spec, shown(draft, f))), entry)
  };
}

export const generalLeaves = leafCard({
  type: { path: ['type'], kind: 'text', required: 'A device type is required.' },
  description: { path: ['description'], kind: 'text' }
});

// An absent wait keeps the flotilla's own: 45 s and 600 s.
export const checkLeaves = leafCard({
  enabled: { path: ['upgrade-checks', 'enabled'], kind: 'bool', fallback: true },
  precheckWait: { path: ['upgrade-checks', 'precheck-wait'], kind: 'uint', min: 1, max: 65535 },
  postcheckWait: { path: ['upgrade-checks', 'postcheck-wait'], kind: 'uint', min: 1, max: 65535 }
});

export const changeLeaves = leafCard({
  approvalRequired: { path: ['approval-required'], kind: 'bool', fallback: false },
  syncCheck: { path: ['sync-check'], kind: 'bool', fallback: true }
});

// No log level: the log.device.level setting's.
export const loggingLeaves = leafCard({
  logLevel: { path: ['debug', 'log-level'], kind: 'enum' },
  connection: { path: ['debug', 'connection'], kind: 'bool', fallback: false }
});

export const mockLeaves = leafCard({
  enabled: { path: ['mock', 'enabled'], kind: 'bool', fallback: false },
  duration: { path: ['mock', 'software', 'upgrade-duration'], kind: 'uint', min: 0, max: 65535 },
  variance: { path: ['mock', 'software', 'upgrade-duration-variance'], kind: 'uint', min: 0, max: 100 },
  failure: { path: ['mock', 'software', 'failure'], kind: 'enum', fallback: 'none' },
  version: { path: ['mock', 'platform', 'version'], kind: 'text' },
  model: { path: ['mock', 'platform', 'model'], kind: 'text' },
  serialNumber: { path: ['mock', 'platform', 'serial-number'], kind: 'text' }
});

export const LOG_LEVELS = ['off', 'error', 'warning', 'info', 'debug', 'trace'];

/** The IOS XE failures a mock reproduces during an upgrade. */
export const MOCK_FAILURES: { value: string; label: string; title: string }[] = [
  { value: 'none', label: 'None', title: 'The upgrade goes through.' },
  { value: 'download-failed', label: 'Download failed', title: 'The download fails after xcopy was accepted.' },
  { value: 'add-failed', label: 'Add failed', title: 'The verify stage fails after install add was accepted.' },
  { value: 'activate-refused', label: 'Activate refused', title: 'activate is rejected, as when the image was not added.' },
  { value: 'commit-failed', label: 'Commit failed', title: 'The commit stage fails after install-commit was accepted.' },
  { value: 'reverts', label: 'Reverts', title: 'The abort timer runs out before the commit.' },
  { value: 'bgp-down', label: 'BGP down', title: 'The BGP session is idle from the start.' },
  { value: 'bgp-lost', label: 'BGP lost', title: 'The BGP session is idle while the activated release runs, until a commit or an abort.' },
  {
    value: 'interface-lost',
    label: 'Interface lost',
    title: 'Interfaces that were up have their line protocol down while the activated release runs, until a commit or an abort.'
  },
  { value: 'ospf-lost', label: 'OSPF lost', title: 'An OSPF neighbor is stuck in init while the activated release runs, until a commit or an abort.' }
];

// ── Connection ──

// Each row keeps the key it was read with in `original`, which finds what
// the card does not edit in the stored entry: an address's initial
// credentials, a stored private key, an adapter's own credentials and SSH
// settings. A new row has null. A row's id is its place in the read, so
// that a poll does not make new rows of the same ones.

export interface AddressRow {
  id: string;
  name: string;
  address: string;
  /** As typed; '' for the adapter's own. */
  port: string;
  original: string | null;
}

export interface KeyRow {
  id: string;
  name: string;
  /** A private key file chosen in place of the stored one. */
  file: PrivateKey | null;
  /** Whether the stored private key stays. */
  stored: boolean;
  /** A new key needs a private key, and so does one that had one. */
  needsKey: boolean;
  original: string | null;
}

export interface AdapterRow {
  id: string;
  type: string;
  /** An address name; '' for the first address. */
  address: string;
  port: string;
  original: string | null;
}

export interface ConnectionDraft {
  addresses: AddressRow[];
  username: string;
  /** A new password; '' keeps the stored one. */
  password: string;
  /** Whether a stored password stays: false when none is stored, and once
   * it is cleared. */
  passwordSet: boolean;
  keys: KeyRow[];
  adapters: AdapterRow[];
}

let rowSeq = 0;

/** The id of a row the operator adds. */
export function newRowId(): string {
  rowSeq += 1;
  return `new-${rowSeq}`;
}

function portText(port: number | string | undefined): string {
  return port === undefined || port === null ? '' : String(port);
}

export function connectionOf(entry: DeviceConfig): ConnectionDraft {
  const credentials = entry.credentials ?? {};
  return {
    addresses: (entry.address ?? []).map((a, i) => ({
      id: `address-${i}`,
      name: a.name,
      address: a.address ?? '',
      port: portText(a.port),
      original: a.name
    })),
    username: credentials.username ?? '',
    password: '',
    passwordSet: typeof credentials.password === 'string',
    keys: (credentials.key ?? []).map((k, i) => {
      const stored = typeof k['private-key'] === 'string';
      return { id: `key-${i}`, name: k.key, file: null, stored, needsKey: stored, original: k.key };
    }),
    adapters: (entry['extra-adapter'] ?? []).map((a, i) => ({
      id: `adapter-${i}`,
      type: a.type,
      address: a.address ?? '',
      port: portText(a.port),
      original: a.type
    }))
  };
}

function portKey(text: string): number | string {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : t;
}

function addressesKey(rows: AddressRow[]): string {
  return JSON.stringify(rows.map((r) => [r.name.trim(), r.address.trim(), portKey(r.port), r.original]));
}

function keysKey(rows: KeyRow[]): string {
  return JSON.stringify(rows.map((r) => [r.name.trim(), r.file?.name ?? null, r.file?.text ?? null, r.stored, r.original]));
}

function adaptersKey(rows: AdapterRow[]): string {
  return JSON.stringify(rows.map((r) => [r.type.trim(), r.address, portKey(r.port), r.original]));
}

export function sameConnection(a: ConnectionDraft, b: ConnectionDraft): boolean {
  return (
    a.username.trim() === b.username.trim() &&
    a.password === b.password &&
    a.passwordSet === b.passwordSet &&
    addressesKey(a.addresses) === addressesKey(b.addresses) &&
    keysKey(a.keys) === keysKey(b.keys) &&
    adaptersKey(a.adapters) === adaptersKey(b.adapters)
  );
}

/** Marks the rows whose name an earlier row has, with `error`. */
function markRepeats<R extends { id: string }>(rows: R[], name: (r: R) => string, field: string, error: string, errors: Errors): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const n = name(row).trim();
    if (n && seen.has(n)) errors[`${field}.${row.id}`] = error;
    seen.add(n);
  }
}

export function connectionErrors(draft: ConnectionDraft): Errors {
  const errors: Errors = {};
  const portError = (port: string) => (port.trim() && !validPort(port.trim()) ? 'Port must be 1-65535.' : '');
  for (const row of draft.addresses) {
    if (!row.name.trim()) errors[`address.name.${row.id}`] = 'A name is required.';
    if (!row.address.trim()) errors[`address.address.${row.id}`] = 'An address is required.';
    const port = portError(row.port);
    if (port) errors[`address.port.${row.id}`] = port;
  }
  markRepeats(draft.addresses, (r) => r.name, 'address.name', 'Another address has this name.', errors);
  if (!draft.username.trim()) errors['username'] = 'A username is required.';
  for (const row of draft.keys) {
    if (!row.name.trim()) errors[`key.name.${row.id}`] = 'A name is required.';
    const bad = row.file ? keyError(row.file.text) : '';
    if (bad) errors[`key.file.${row.id}`] = bad;
    else if (!row.file && !row.stored && row.needsKey) errors[`key.file.${row.id}`] = 'Choose a private key file.';
  }
  markRepeats(draft.keys, (r) => r.name, 'key.name', 'Another key has this name.', errors);
  const names = new Set(draft.addresses.map((r) => r.name.trim()));
  for (const row of draft.adapters) {
    if (!row.type.trim()) errors[`adapter.type.${row.id}`] = 'A type is required.';
    if (row.address && !names.has(row.address)) errors[`adapter.address.${row.id}`] = `No address named ${row.address}.`;
    const port = portError(row.port);
    if (port) errors[`adapter.port.${row.id}`] = port;
  }
  markRepeats(draft.adapters, (r) => r.type, 'adapter.type', 'Another adapter has this type.', errors);
  return errors;
}

function entriesOf(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/** The stored entry of `list` whose `key` is `value`, to build on. */
function storedEntry(list: Json[], key: string, value: string | null): Json {
  return { ...(value === null ? undefined : list.find((e) => e[key] === value)) };
}

/** Sets `key` of `obj`, or removes it for undefined or an empty list. */
function put(obj: Json, key: string, value: unknown): void {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) delete obj[key];
  else obj[key] = value;
}

function portValue(text: string): number | undefined {
  return text.trim() ? Number(text.trim()) : undefined;
}

/** `entry` with what `draft` changed from `base`. A list that changed goes
 * back whole, each entry with what the card does not edit as stored. */
export function applyConnection(entry: Json, base: ConnectionDraft, draft: ConnectionDraft): Json {
  const next = { ...entry };
  if (addressesKey(draft.addresses) !== addressesKey(base.addresses)) {
    const stored = entriesOf(entry.address);
    const list = draft.addresses.map((row) => {
      const out = { ...storedEntry(stored, 'name', row.original), name: row.name.trim(), address: row.address.trim() };
      put(out, 'port', portValue(row.port));
      return out;
    });
    put(next, 'address', list);
  }

  const credentials: Json = isObject(entry.credentials) ? { ...entry.credentials } : {};
  let credentialsChanged = false;
  if (draft.username.trim() !== base.username.trim()) {
    credentials.username = draft.username.trim();
    credentialsChanged = true;
  }
  if (draft.password) {
    credentials.password = draft.password;
    credentialsChanged = true;
  } else if (base.passwordSet && !draft.passwordSet) {
    delete credentials.password;
    credentialsChanged = true;
  }
  if (keysKey(draft.keys) !== keysKey(base.keys)) {
    const stored = entriesOf(credentials.key);
    const list = draft.keys.map((row) => {
      const out: Json = { ...storedEntry(stored, 'key', row.original), key: row.name.trim() };
      if (row.file) out['private-key'] = row.file.text;
      else if (!row.stored) delete out['private-key'];
      else if (typeof out['private-key'] !== 'string') {
        throw new Error(`The private key of ${row.original} is no longer stored. Choose its file again.`);
      }
      return out;
    });
    put(credentials, 'key', list);
    credentialsChanged = true;
  }
  if (credentialsChanged) next.credentials = credentials;

  if (adaptersKey(draft.adapters) !== adaptersKey(base.adapters)) {
    const stored = entriesOf(entry['extra-adapter']);
    const list = draft.adapters.map((row) => {
      const out: Json = { ...storedEntry(stored, 'type', row.original), type: row.type.trim() };
      put(out, 'address', row.address || undefined);
      put(out, 'port', portValue(row.port));
      return out;
    });
    put(next, 'extra-adapter', list);
  }
  return next;
}

// ── The whole entry as JSON ──

export function configText(config: DeviceConfig): string {
  return JSON.stringify(config, null, 2);
}

/** Why `text` cannot replace the entry of device `name`. `config` is the
 * entry as read: its placeholders show where a secret is stored. */
export function configTextErrors(text: string, name: string, config: DeviceConfig): Errors {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (parseError) {
    return { json: `Not valid JSON: ${errorText(parseError, 'it does not parse')}` };
  }
  if (!isObject(value)) return { json: 'Must be the device entry, a JSON object.' };
  if (value.name !== name) return { json: `The name must stay ${name}.` };
  if (typeof value.type !== 'string' || !value.type.trim()) return { json: 'A device type is required.' };
  const { missing } = restoreSecrets(value, config);
  return missing.length > 0 ? { json: missingText(missing) } : {};
}

/** The entry `text` stores, with the values `stored` has where the text
 * still has the placeholder. */
export function applyConfigText(text: string, stored: Json): Json {
  const { value, missing } = restoreSecrets(JSON.parse(text), stored);
  if (missing.length > 0) throw new Error(missingText(missing));
  return value as Json;
}
