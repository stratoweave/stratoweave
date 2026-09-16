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

/** A maintenance window occurrence, as offsets in seconds from launch. */
export interface WindowJson {
  start: number;
  duration: number;
}

export interface PlanDeviceJson {
  name: string;
  'estimated-start'?: number | string;
  'estimated-duration'?: number | string;
}

export interface PlanWindowJson {
  start: number | string;
  end?: number | string;
  schedule?: string;
  device?: PlanDeviceJson[];
}

export interface PlanJson {
  window?: PlanWindowJson[];
  alarm?: string[];
}

/** Counters are optional and do not sum to total: pending, unknown and
 * up-to-date devices fall into no counter. */
export interface CampaignStateJson {
  total?: number;
  'in-progress'?: number;
  succeeded?: number;
  failed?: number;
  plan?: PlanJson;
  'device-status'?: DeviceStatusJson[];
}

export interface CampaignJson {
  name: string;
  'target-release'?: string;
  'image-url'?: string;
  'allow-staging'?: boolean;
  device?: CampaignMemberJson[];
  'admin-state'?: AdminState;
  window?: WindowJson[];
  deadline?: number;
  'target-rate'?: number;
  'max-rate'?: number;
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

export interface SoftwarePatchJson {
  'software:software': {
    'upgrade-campaign'?: (Partial<CampaignJson> & { name: string })[];
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

/** YANG defaults; a GET omits leaves left at their default. */
export const DEFAULT_TARGET_RATE = 100;
export const DEFAULT_MAX_RATE = 500;

export interface MaintenanceWindow {
  /** Seconds after launch. */
  start: number;
  duration: number;
}

export interface PlanDevice {
  name: string;
  /** Seconds since the Unix epoch; an estimate. */
  estimatedStart: number;
  estimatedDuration: number;
}

export interface PlanWindow {
  start: number;
  end: number;
  schedule: string;
  devices: PlanDevice[];
}

/** The planner's layout, published under state in plan and in run alike.
 * Members in no window are not actuated. */
export interface CampaignPlan {
  windows: PlanWindow[];
  alarms: string[];
  unplaced: string[];
}

export interface Campaign {
  name: string;
  targetRelease: string;
  devices: string[];
  imageUrl: string;
  adminState: AdminState;
  windows: MaintenanceWindow[];
  /** Seconds after launch; null when the campaign has none. */
  deadline: number | null;
  /** Devices per hour; 0 means no preference / no cap. */
  targetRate: number;
  maxRate: number;
  counters: CampaignCounters | null;
  plan: CampaignPlan | null;
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

/** RFC 7951 encodes uint64 as a string; this backend sends numbers. */
function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function parsePlan(state: CampaignStateJson | undefined, members: string[]): CampaignPlan | null {
  if (!state) {
    return null;
  }
  const windows = (state.plan?.window ?? []).map((w) => ({
    start: num(w.start),
    end: num(w.end),
    schedule: w.schedule ?? '',
    devices: (w.device ?? []).map((d) => ({
      name: d.name,
      estimatedStart: num(d['estimated-start']),
      estimatedDuration: num(d['estimated-duration'])
    }))
  }));
  windows.sort((a, b) => a.start - b.start);
  const placed = new Set(windows.flatMap((w) => w.devices.map((d) => d.name)));
  return {
    windows,
    alarms: state.plan?.alarm ?? [],
    unplaced: members.filter((m) => !placed.has(m))
  };
}

function parseCampaign(entry: CampaignJson): Campaign {
  const members = (entry.device ?? []).map((m) => m.name);
  const windows = (entry.window ?? []).map((w) => ({
    start: num(w.start),
    duration: num(w.duration)
  }));
  windows.sort((a, b) => a.start - b.start);
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
    windows,
    deadline: typeof entry.deadline === 'number' ? entry.deadline : null,
    targetRate: entry['target-rate'] ?? DEFAULT_TARGET_RATE,
    maxRate: entry['max-rate'] ?? DEFAULT_MAX_RATE,
    counters: parseCounters(entry.state),
    plan: parsePlan(entry.state, members),
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
  windows?: MaintenanceWindow[];
  /** Seconds after launch. */
  deadline?: number | null;
  /** Devices per hour; null leaves the model default. */
  targetRate?: number | null;
  maxRate?: number | null;
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
  if (input.windows && input.windows.length > 0) {
    entry.window = input.windows.map((w) => ({ start: w.start, duration: w.duration }));
  }
  if (input.deadline != null) entry.deadline = input.deadline;
  if (input.targetRate != null) entry['target-rate'] = input.targetRate;
  if (input.maxRate != null) entry['max-rate'] = input.maxRate;
  return { 'software:software': { 'upgrade-campaign': [entry] } };
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
