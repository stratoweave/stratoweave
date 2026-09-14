import type { ValidationResult } from '$lib/core/validation/types';

// RESTCONF paths. Writes always PATCH the datastore root: the backend
// rejects a PATCH whose target resource does not exist yet (RFC 8040),
// so creation merges into `data` under the module-qualified wrappers.
export const DATA_ROOT = 'data';
export const SOFTWARE_ROOT = 'data/software:software';
export const CAMPAIGN_LIST_ROOT = 'data/software:software/upgrade-campaign';
export const FLEET_ROOT = 'data/fleetmgr:fleet';
export const FLEET_DEVICE_LIST_ROOT = 'data/fleetmgr:fleet/device';

export type AdminState = 'plan' | 'run';

// ── Wire types: YANG-JSON exactly as it crosses /restconf/data ──

export interface AddressJson {
  name: string;
  address?: string;
  port?: number;
}

/** /fleetmgr:fleet/device entry (the fields this UI uses). */
export interface DeviceJson {
  name: string;
  type?: string;
  shard?: string;
  description?: string;
  'hardware-model'?: string;
  'hardware-revision'?: string;
  address?: AddressJson[];
  credentials?: { username?: string; password?: string };
  mock?: { enabled?: boolean };
}

export interface NodeJson {
  name: string;
  address?: AddressJson[];
}

export interface CampaignMemberJson {
  name: string;
}

export interface DeviceStatusJson {
  device: string;
  status?: string;
  'running-release'?: string;
}

/** Counters are optional and do not sum to total: pending, unknown and
 * up-to-date devices fall into no counter. */
export interface CampaignStateJson {
  total?: number;
  'in-progress'?: number;
  succeeded?: number;
  failed?: number;
  'device-status'?: DeviceStatusJson[];
}

export interface CampaignJson {
  name: string;
  'target-release'?: string;
  'image-url'?: string;
  'allow-staging'?: boolean;
  device?: CampaignMemberJson[];
  'admin-state'?: AdminState;
  state?: CampaignStateJson;
}

/** GET data merges every module; this UI reads two of them. */
export interface DataTreeJson {
  'fleetmgr:fleet'?: {
    node?: NodeJson[];
    device?: DeviceJson[];
  };
  'software:software'?: {
    'upgrade-campaign'?: CampaignJson[];
    catalog?: CatalogJson;
  };
}

/** GET data/software:software/upgrade-campaign={name} */
export interface CampaignEntryJson {
  'software:upgrade-campaign'?: CampaignJson[];
}

export interface FleetPatchJson {
  'fleetmgr:fleet': {
    node?: NodeJson[];
    device?: DeviceJson[];
  };
}

export interface MatrixEntryJson {
  model: string;
  revision: string;
  'target-version'?: string;
  'min-flash'?: number;
  'min-free'?: number;
  'install-mode-support'?: string;
  approval?: string;
  exclusion?: string;
}

export interface ImageRestrictionJson {
  id: string;
  description?: string;
}

export interface ImageJson {
  version: string;
  'file-name'?: string;
  'file-size'?: number;
  checksum?: string;
  url?: string;
  'rommon-min'?: string;
  'rollback-to'?: string;
  'storage-min-flash'?: number;
  'storage-min-free'?: number;
  approval?: { state?: string; by?: string; at?: string; 'change-ref'?: string };
  restriction?: ImageRestrictionJson[];
}

export interface CatalogJson {
  image?: ImageJson[];
  'hardware-matrix'?: { entry?: MatrixEntryJson[] };
}

export interface SoftwarePatchJson {
  'software:software': {
    'upgrade-campaign'?: (Partial<CampaignJson> & { name: string })[];
    catalog?: CatalogJson;
  };
}

// ── Status vocabulary ──

// The YANG types device-status/status as a plain string; these are the
// values the backend publishes today.
export const KNOWN_STATUSES = [
  'pending',
  'unknown',
  'up-to-date',
  'upgrade-needed',
  'in-progress',
  'succeeded',
  'failed',
  'rolled-back'
] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

export function normalizeStatus(raw: unknown): KnownStatus {
  return typeof raw === 'string' && (KNOWN_STATUSES as readonly string[]).includes(raw)
    ? (raw as KnownStatus)
    : 'unknown';
}

export type StatusTone = 'accent' | 'success' | 'warning' | 'danger' | 'muted';

export const STATUS_TONE: Record<KnownStatus, StatusTone> = {
  pending: 'warning',
  unknown: 'muted',
  'up-to-date': 'success',
  'upgrade-needed': 'warning',
  'in-progress': 'accent',
  succeeded: 'success',
  failed: 'danger',
  'rolled-back': 'danger'
};

// ── Parsed view types ──

export interface Device {
  name: string;
  type: string;
  shard: string;
  hardwareModel: string;
  hardwareRevision: string;
  description: string;
  approvalRequired: boolean;
  /** First address entry as `host[:port]`; empty for a mock. */
  address: string;
}

export interface DeviceStatusRow {
  device: string;
  status: KnownStatus;
  raw: string;
  runningRelease: string;
}

export interface CampaignCounters {
  total: number;
  inProgress: number;
  succeeded: number;
  failed: number;
  /** total - (inProgress + succeeded + failed), floored at 0: members that
   * are pending or unknown (up-to-date counts into succeeded). Not an error. */
  remainder: number;
}

export interface Campaign {
  name: string;
  targetRelease: string;
  devices: string[];
  imageUrl: string;
  adminState: AdminState;
  counters: CampaignCounters | null;
  deviceStatus: DeviceStatusRow[];
}

// ── Parsing ──

function firstAddress(entry: { address?: AddressJson[] }): string {
  const first = entry.address?.[0];
  if (!first || !first.address) {
    return '';
  }
  return typeof first.port === 'number' ? `${first.address}:${first.port}` : first.address;
}

function parseDevice(entry: DeviceJson & { 'approval-required'?: boolean }): Device {
  return {
    name: entry.name,
    type: entry.type ?? '',
    shard: entry.shard ?? '',
    hardwareModel: entry['hardware-model'] ?? '',
    hardwareRevision: entry['hardware-revision'] ?? '',
    description: entry.description ?? '',
    approvalRequired: entry['approval-required'] === true,
    address: firstAddress(entry)
  };
}

function parseCounters(state: CampaignStateJson | undefined): CampaignCounters | null {
  if (!state || typeof state.total !== 'number') {
    return null;
  }
  const total = state.total;
  const inProgress = state['in-progress'] ?? 0;
  const succeeded = state.succeeded ?? 0;
  const failed = state.failed ?? 0;
  return {
    total,
    inProgress,
    succeeded,
    failed,
    remainder: Math.max(0, total - inProgress - succeeded - failed)
  };
}

function parseCampaign(entry: CampaignJson): Campaign {
  const members = (entry.device ?? []).map((m) => m.name);
  const reported = new Map<string, DeviceStatusJson>();
  for (const row of entry.state?.['device-status'] ?? []) {
    reported.set(row.device, row);
  }
  // Configured members joined with reported rows; a member the state does
  // not mention yet renders as unknown.
  const names = [...members];
  for (const device of reported.keys()) {
    if (!names.includes(device)) names.push(device);
  }
  return {
    name: entry.name,
    targetRelease: entry['target-release'] ?? '',
    devices: members,
    imageUrl: entry['image-url'] ?? '',
    adminState: entry['admin-state'] === 'run' ? 'run' : 'plan',
    counters: parseCounters(entry.state),
    deviceStatus: names.map((device) => {
      const row = reported.get(device);
      const raw = row?.status ?? 'unknown';
      return {
        device,
        status: normalizeStatus(raw),
        raw,
        runningRelease: row?.['running-release'] ?? ''
      };
    })
  };
}

/** Parse a GET of data/fleetmgr:fleet (never poll data/ itself: it also
 * hauls the full yang-library). */
export function parseFleet(json: unknown): { nodes: string[]; devices: Device[] } {
  const fleet = (json as DataTreeJson)?.['fleetmgr:fleet'];
  return {
    nodes: (fleet?.node ?? []).map((n) => n.name),
    devices: (fleet?.device ?? []).map(parseDevice)
  };
}

/** Parse a GET of data/software:software. */
export function parseCampaigns(json: unknown): Campaign[] {
  const tree = (json as DataTreeJson)?.['software:software'];
  return (tree?.['upgrade-campaign'] ?? []).map(parseCampaign);
}

// ── Catalogue view types ──

export interface CatalogImage {
  version: string;
  fileName: string;
  fileSize: number | null;
  checksum: string;
  url: string;
  rommonMin: string;
  rollbackTo: string;
  storageMinFlash: number | null;
  storageMinFree: number | null;
  approvalState: string;
  approvedBy: string;
  approvedAt: string;
  changeRef: string;
  restrictions: { id: string; description: string }[];
}

export interface MatrixEntry {
  model: string;
  revision: string;
  targetVersion: string;
  minFlash: number | null;
  minFree: number | null;
  installModeSupport: string;
  approval: string;
  exclusion: string;
}

/** Parse the catalog subtree out of a software:software GET. */
export function parseCatalog(json: unknown): { images: CatalogImage[]; matrix: MatrixEntry[] } {
  const catalog = (json as DataTreeJson)?.['software:software']?.catalog;
  return {
    images: (catalog?.image ?? []).map((i) => ({
      version: i.version,
      fileName: i['file-name'] ?? '',
      fileSize: typeof i['file-size'] === 'number' ? i['file-size'] : null,
      checksum: i.checksum ?? '',
      url: i.url ?? '',
      rommonMin: i['rommon-min'] ?? '',
      rollbackTo: i['rollback-to'] ?? '',
      storageMinFlash: typeof i['storage-min-flash'] === 'number' ? i['storage-min-flash'] : null,
      storageMinFree: typeof i['storage-min-free'] === 'number' ? i['storage-min-free'] : null,
      // GET does not materialize the YANG default (draft).
      approvalState: i.approval?.state ?? 'draft',
      approvedBy: i.approval?.by ?? '',
      approvedAt: i.approval?.at ?? '',
      changeRef: i.approval?.['change-ref'] ?? '',
      restrictions: (i.restriction ?? []).map((r) => ({ id: r.id, description: r.description ?? '' }))
    })),
    matrix: (catalog?.['hardware-matrix']?.entry ?? []).map((e) => ({
      model: e.model,
      revision: e.revision,
      targetVersion: e['target-version'] ?? '',
      minFlash: typeof e['min-flash'] === 'number' ? e['min-flash'] : null,
      minFree: typeof e['min-free'] === 'number' ? e['min-free'] : null,
      installModeSupport: e['install-mode-support'] ?? '',
      // GET does not materialize the YANG default (conditional).
      approval: e.approval ?? 'conditional',
      exclusion: e.exclusion ?? ''
    }))
  };
}

export function parseCampaignEntry(json: unknown): Campaign | null {
  const entries = (json as CampaignEntryJson)?.['software:upgrade-campaign'];
  return entries && entries.length > 0 ? parseCampaign(entries[0]) : null;
}

// ── Patch builders ──

export interface NewCampaign {
  name: string;
  targetRelease: string;
  imageUrl: string;
  devices: string[];
  allowStaging?: boolean;
}

export function campaignCreatePatch(input: NewCampaign): SoftwarePatchJson {
  const entry: Partial<CampaignJson> & { name: string } = {
    name: input.name.trim(),
    'target-release': input.targetRelease.trim(),
    device: input.devices.map((name) => ({ name })),
    'admin-state': 'plan'
  };
  const imageUrl = input.imageUrl.trim();
  if (imageUrl) entry['image-url'] = imageUrl;
  if (input.allowStaging) entry['allow-staging'] = true;
  return { 'software:software': { 'upgrade-campaign': [entry] } };
}

export const CATALOG_IMAGE_ROOT = 'data/software:software/catalog/image';
export const CATALOG_MATRIX_ROOT = 'data/software:software/catalog/hardware-matrix/entry';

export interface NewImage {
  version: string;
  fileName: string;
  fileSize: string;
  checksum: string;
  url: string;
  rommonMin: string;
  rollbackTo: string;
  storageMinFlash: string;
  storageMinFree: string;
  /** one per line: `id: description` */
  restrictions: string;
}

export function imagePatch(input: NewImage): SoftwarePatchJson {
  const entry: ImageJson = { version: input.version.trim() };
  const set = (key: keyof ImageJson, value: string): void => {
    if (value.trim()) (entry as unknown as Record<string, unknown>)[key] = value.trim();
  };
  set('file-name', input.fileName);
  set('checksum', input.checksum);
  set('url', input.url);
  set('rommon-min', input.rommonMin);
  set('rollback-to', input.rollbackTo);
  if (input.fileSize.trim()) entry['file-size'] = Number(input.fileSize);
  if (input.storageMinFlash.trim()) entry['storage-min-flash'] = Number(input.storageMinFlash);
  if (input.storageMinFree.trim()) entry['storage-min-free'] = Number(input.storageMinFree);
  const restrictions = input.restrictions
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const i = line.indexOf(':');
      return i > 0
        ? { id: line.slice(0, i).trim(), description: line.slice(i + 1).trim() }
        : { id: line, description: '' };
    });
  if (restrictions.length > 0) entry.restriction = restrictions;
  return { 'software:software': { catalog: { image: [entry] } } };
}

export function imageApprovalPatch(
  version: string,
  state: 'approved' | 'withdrawn' | 'draft',
  by: string,
  changeRef: string
): SoftwarePatchJson {
  const approval: NonNullable<ImageJson['approval']> = { state, at: new Date().toISOString() };
  if (by.trim()) approval.by = by.trim();
  if (changeRef.trim()) approval['change-ref'] = changeRef.trim();
  return { 'software:software': { catalog: { image: [{ version, approval }] } } };
}

export interface NewMatrixEntry {
  model: string;
  revision: string;
  targetVersion: string;
  minFlash: string;
  minFree: string;
  installModeSupport: string;
  approval: string;
  exclusion: string;
}

export function matrixEntryPatch(input: NewMatrixEntry): SoftwarePatchJson {
  const entry: MatrixEntryJson = {
    model: input.model.trim(),
    revision: input.revision.trim()
  };
  if (input.targetVersion.trim()) entry['target-version'] = input.targetVersion.trim();
  if (input.minFlash.trim()) entry['min-flash'] = Number(input.minFlash);
  if (input.minFree.trim()) entry['min-free'] = Number(input.minFree);
  if (input.installModeSupport.trim()) entry['install-mode-support'] = input.installModeSupport.trim();
  if (input.approval.trim()) entry.approval = input.approval.trim();
  if (input.exclusion.trim()) entry.exclusion = input.exclusion.trim();
  return { 'software:software': { catalog: { 'hardware-matrix': { entry: [entry] } } } };
}

export function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${n} B`;
}

/** PATCH merges: sending only {name, admin-state} flips one leaf and
 * leaves the rest of the campaign intact. */
export function adminStatePatch(name: string, state: AdminState): SoftwarePatchJson {
  return { 'software:software': { 'upgrade-campaign': [{ name, 'admin-state': state }] } };
}

// ── Validation ──

export function validateNewCampaign(input: NewCampaign, existingNames: string[]): ValidationResult {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) {
    errors['name'] = 'A name is required.';
  } else if (existingNames.includes(name)) {
    errors['name'] = `Campaign ${name} already exists.`;
  }
  if (!input.targetRelease.trim()) {
    errors['target-release'] = 'A target release is required.';
  }
  if (input.devices.length === 0) {
    errors['device'] = 'Select at least one device.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** scp://user:pw@host:/path -> scp://***@host:/path, for display only. */
export function maskUrlCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1***@');
}
