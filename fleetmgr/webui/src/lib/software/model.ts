import type { ValidationResult } from '#lib/core/validation/types.ts';
import type { CatalogImage } from '#lib/software/images.ts';

// RESTCONF paths. Writes always PATCH the datastore root: the backend
// rejects a PATCH whose target resource does not exist yet (RFC 8040),
// so creation merges into `data` under the module-qualified wrappers.
export const DATA_ROOT = 'data';
export const SOFTWARE_ROOT = 'data/software:software';
/** The campaigns without their published state: RFC 8040 content=config. */
export const SOFTWARE_CONFIG = `${SOFTWARE_ROOT}?content=config`;
export const SCHEDULES_ROOT = 'data/maintenance:schedules';
export const SCHEDULE_LIST_ROOT = 'data/maintenance:schedules/schedule';
export const CAMPAIGN_LIST_ROOT = 'data/software:software/upgrade-campaign';
export const IMAGES_ROOT = 'data/stratoweave-images:images';
export const IMAGE_LIST_ROOT = `${IMAGES_ROOT}/image`;
export const FLEET_ROOT = 'data/fleetmgr:fleet';
export const FLEET_DEVICE_LIST_ROOT = 'data/fleetmgr:fleet/device';
export const REDUNDANCY_GROUPS_ROOT = 'data/fleetmgr:redundancy-groups';
export const REDUNDANCY_GROUP_LIST_ROOT = `${REDUNDANCY_GROUPS_ROOT}/redundancy-group`;

export type AdminState = 'plan' | 'run';

// ── Wire types: YANG-JSON exactly as it crosses /restconf/data ──

interface AddressJson {
  name: string;
  address?: string;
  port?: number;
}

/** /fleetmgr:fleet/device entry (the fields this UI uses). */
export interface DeviceJson {
  name: string;
  type?: string;
  description?: string;
  schedule?: string;
  'redundancy-group'?: string[];
  'redundancy-priority'?: number;
  'approval-required'?: boolean;
  address?: AddressJson[];
  credentials?: { username?: string; password?: string };
  mock?: { enabled?: boolean };
  state?: { platform?: { version?: string; model?: string; 'serial-number'?: string } };
}

interface CampaignMemberJson {
  name: string;
  image?: string;
}

/** A software upgrade check verdict, relayed from the device as strings. */
interface CheckResultJson {
  verdict?: string;
  detail?: string;
  /** yang:date-and-time */
  at?: string;
}

/** A job of the device's upgrade run, relayed as strings. */
interface JobJson {
  state?: string;
  release?: string;
  message?: string;
  progress?: number | string;
}

interface DeviceStatusJson {
  device: string;
  status?: string;
  /** What the device runs, from its platform. */
  version?: string;
  /** The chassis model, from its platform. */
  model?: string;
  stage?: string;
  reason?: string;
  prepare?: JobJson;
  install?: JobJson;
  precheck?: CheckResultJson;
  postcheck?: CheckResultJson;
}

/** One recurrence rule of a schedule: a local time of day. */
interface WindowJson {
  at: number;
  duration: number;
  day?: string[];
}

/** A shared /maintenance:schedules object; devices and campaign defaults
 * reference one by name. */
export interface ScheduleJson {
  name: string;
  'utc-offset'?: number;
  window?: WindowJson[];
}

interface PlanDeviceJson {
  name: string;
  'estimated-start'?: number | string;
  'estimated-duration'?: number | string;
  started?: number | string;
  finished?: number | string;
}

interface PlanWindowJson {
  start: number | string;
  end?: number | string;
  schedule?: string;
  device?: PlanDeviceJson[];
}

interface PlanJson {
  window?: PlanWindowJson[];
  alarm?: string[];
}

/** Counters are optional and do not sum to total: pending, unknown and
 * up-to-date devices fall into no counter. */
interface CampaignStateJson {
  total?: number;
  'in-progress'?: number;
  succeeded?: number;
  failed?: number;
  plan?: PlanJson;
  'device-status'?: DeviceStatusJson[];
}

export interface CampaignJson {
  name: string;
  'allow-staging'?: boolean;
  device?: CampaignMemberJson[];
  'admin-state'?: AdminState;
  'default-schedule'?: string;
  deadline?: number;
  'target-concurrency'?: number;
  'max-concurrency'?: number;
  state?: CampaignStateJson;
}

export type SeparationPolicy = 'spread' | 'pack';

/** /fleetmgr:redundancy-groups/redundancy-group entry: how far apart the
 * members of a group upgrade. */
export interface RedundancyGroupJson {
  name: string;
  'separation-policy'?: SeparationPolicy;
  'min-separation'?: number;
}

/** /stratoweave-images:images/image entry. */
export interface ImageJson {
  name: string;
  os?: string;
  version?: string;
  model?: string[];
  family?: string;
  default?: boolean;
}

/** GET data merges every module; this UI reads three of them. */
interface DataTreeJson {
  'fleetmgr:fleet'?: {
    device?: DeviceJson[];
  };
  'software:software'?: {
    'upgrade-campaign'?: CampaignJson[];
  };
  'maintenance:schedules'?: {
    schedule?: ScheduleJson[];
  };
}

/** GET data/software:software/upgrade-campaign={name} */
interface CampaignEntryJson {
  'software:upgrade-campaign'?: CampaignJson[];
}

/** GET data/stratoweave-images:images */
interface ImagesJson {
  'stratoweave-images:images'?: {
    'url-base'?: string;
    image?: ImageJson[];
  };
}

export interface FleetPatchJson {
  'fleetmgr:fleet': {
    device?: DeviceJson[];
  };
}

export interface RedundancyGroupsPatchJson {
  'fleetmgr:redundancy-groups': { 'redundancy-group': RedundancyGroupJson[] };
}

interface ImagesPatchJson {
  'stratoweave-images:images': { 'url-base'?: string; image?: ImageJson[] };
}

interface SoftwarePatchJson {
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

function normalizeStatus(raw: unknown): KnownStatus {
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
  description: string;
  /** Maintenance schedule binding, by name; empty when unbound. */
  schedule: string;
  /** First address entry as `host[:port]`; empty for a mock. */
  address: string;
  /** What the device reports when it connects; empty until then. */
  model: string;
  version: string;
  serialNumber: string;
  /** The redundancy groups it is a member of, as stored. */
  groups: string[];
  /** Where it comes in each of its groups: lower first. */
  priority: number;
}

export type Verdict = 'not-run' | 'pass' | 'fail';

/** The steps of an upgrade run in order, as software/state/stage names
 * them. A rollback is not one of them: it follows a failed post-check or
 * commit. */
export const STEPS = ['prepare', 'precheck', 'install', 'postcheck', 'commit'] as const;
export type Step = (typeof STEPS)[number];
export type Stage = Step | 'rollback';

export const STEP_LABEL: Record<Step, string> = {
  prepare: 'prepare',
  precheck: 'pre-check',
  install: 'install',
  postcheck: 'post-check',
  commit: 'commit'
};

export interface CheckResult {
  verdict: Verdict;
  detail: string;
  /** Seconds since the Unix epoch; null when there is no time. */
  at: number | null;
}

/** null: the device has not run the job for its target. */
export type JobState = 'running' | 'done' | 'failed' | null;

/** The prepare or the install of a device, as its software manager
 * reports it. */
export interface Job {
  state: JobState;
  /** While it runs, what the device does: "add: extract". When it failed,
   * why. After the install, when the commit window ends. '' for none. */
  message: string;
  /** Percent of the image transferred, while the prepare runs; null
   * otherwise. */
  progress: number | null;
}

export interface DeviceStatusRow {
  device: string;
  status: KnownStatus;
  raw: string;
  version: string;
  model: string;
  /** The step the run is in or ended in; null before any run. */
  stage: Stage | null;
  /** Why the run failed or rolled back; '' otherwise. */
  reason: string;
  prepare: Job;
  install: Job;
  precheck: CheckResult;
  postcheck: CheckResult;
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
export const DEFAULT_TARGET_CONCURRENCY = 10;
export const DEFAULT_MAX_CONCURRENCY = 50;
export const DEFAULT_PRIORITY = 100;

/** A group's entry under /redundancy-groups, or the defaults of a group
 * that has none. */
export interface GroupSeparation {
  name: string;
  policy: SeparationPolicy;
  /** Seconds from when one member is done until the next may start. */
  minSeparation: number;
}

export interface MaintenanceWindow {
  /** Local time of day the window opens, seconds after midnight. */
  at: number;
  duration: number;
  /** Weekday names; empty means every day. */
  days: string[];
}

/** A parsed shared schedule object. */
export interface Schedule {
  name: string;
  /** Minutes east of UTC. */
  utcOffset: number;
  windows: MaintenanceWindow[];
}

export interface PlanDevice {
  name: string;
  /** Seconds since the Unix epoch; an estimate, 0 once released. */
  estimatedStart: number;
  estimatedDuration: number;
  /** Seconds since the Unix epoch, when the controller released the
   * device and saw it done; null until then. */
  started: number | null;
  finished: number | null;
}

/** When a device starts: its real start once released, else the estimate. */
export function deviceStart(d: PlanDevice): number {
  return d.started ?? d.estimatedStart;
}

/** How long it takes: the real duration once done, else the estimate. */
export function deviceDuration(d: PlanDevice): number {
  return d.started !== null && d.finished !== null ? d.finished - d.started : d.estimatedDuration;
}

export interface PlanWindow {
  start: number;
  /** null: the window never closes (a campaign without schedules runs
   * through one synthetic always-open window, unless a deadline closes
   * it). */
  end: number | null;
  schedule: string;
  devices: PlanDevice[];
}

/** The planner's layout, published under state in plan and in run alike.
 * Members in no window are not actuated. */
export interface CampaignPlan {
  windows: PlanWindow[];
  /** The planner's alarms without its one alarm per device that fits no
   * window: those devices are `unplaced`. */
  alarms: string[];
  unplaced: string[];
}

/** "3 devices do not fit their windows". */
export function unplacedText(count: number): string {
  return count === 1
    ? '1 device does not fit its windows'
    : `${count.toLocaleString()} devices do not fit their windows`;
}

/** The plan's alarms one per line, the unplaced devices as one line. */
export function planAlarmLines(plan: CampaignPlan): string[] {
  return plan.unplaced.length > 0 ? [...plan.alarms, unplacedText(plan.unplaced.length)] : plan.alarms;
}

export interface Campaign {
  name: string;
  devices: string[];
  /** The image of each member, in the order of devices. */
  images: string[];
  adminState: AdminState;
  /** Name of the shared schedule for members whose device has no binding
   * of its own; empty when the campaign runs through its one synthetic
   * open-ended window. */
  defaultSchedule: string;
  /** Seconds since the Unix epoch; null when the campaign has none. */
  deadline: number | null;
  /** Devices upgrading at the same time. */
  targetConcurrency: number;
  maxConcurrency: number;
  counters: CampaignCounters | null;
  plan: CampaignPlan | null;
  deviceStatus: DeviceStatusRow[];
}

/** One campaign as a member device's page shows it. */
export interface DeviceCampaign {
  name: string;
  adminState: AdminState;
  defaultSchedule: string;
  /** The image the device installs; '' for none. */
  image: string;
  row: DeviceStatusRow;
  /** See planStartOf. */
  start: number | 'unplaced' | null;
}

/** The published half of a campaign: counters, plan and one row per
 * member. */
type CampaignState = Pick<Campaign, 'counters' | 'plan' | 'deviceStatus'>;

/** A campaign without its published state. */
export type CampaignConfig = Omit<Campaign, keyof CampaignState>;

/** A campaign's published state as read, before it is joined with the
 * member list: what the plan places, and one row per device it reports. */
export interface StateParts {
  counters: CampaignCounters | null;
  windows: PlanWindow[];
  alarms: string[];
  placed: Set<string>;
  rows: Map<string, DeviceStatusRow>;
}

// ── Parsing ──

function firstAddress(entry: { address?: AddressJson[] }): string {
  const first = entry.address?.[0];
  if (!first || !first.address) {
    return '';
  }
  return typeof first.port === 'number' ? `${first.address}:${first.port}` : first.address;
}

function parseDevice(entry: DeviceJson): Device {
  return {
    name: entry.name,
    type: entry.type ?? '',
    description: entry.description ?? '',
    schedule: entry.schedule ?? '',
    address: firstAddress(entry),
    model: entry.state?.platform?.model ?? '',
    version: entry.state?.platform?.version ?? '',
    serialNumber: entry.state?.platform?.['serial-number'] ?? '',
    groups: entry['redundancy-group'] ?? [],
    priority: entry['redundancy-priority'] === undefined ? DEFAULT_PRIORITY : num(entry['redundancy-priority'])
  };
}

export function countersOf(total: number, inProgress: number, succeeded: number, failed: number): CampaignCounters {
  return {
    total,
    inProgress,
    succeeded,
    failed,
    remainder: Math.max(0, total - inProgress - succeeded - failed)
  };
}

function parseCounters(state: CampaignStateJson | undefined): CampaignCounters | null {
  if (!state || typeof state.total !== 'number') {
    return null;
  }
  return countersOf(state.total, state['in-progress'] ?? 0, state.succeeded ?? 0, state.failed ?? 0);
}

/** An absent check has not run. */
function parseCheck(json: CheckResultJson | undefined): CheckResult {
  const verdict = json?.verdict === 'pass' || json?.verdict === 'fail' ? json.verdict : 'not-run';
  const at = json?.at ? Date.parse(json.at) : NaN;
  return { verdict, detail: json?.detail ?? '', at: Number.isFinite(at) ? at / 1000 : null };
}

function parseJob(json: JobJson | undefined): Job {
  const state = json?.state === 'running' || json?.state === 'done' || json?.state === 'failed' ? json.state : null;
  return {
    state,
    message: json?.message ?? '',
    progress: json?.progress == null ? null : num(json.progress)
  };
}

function parseStage(raw: string | undefined): Stage | null {
  return raw === 'rollback' || (STEPS as readonly (string | undefined)[]).includes(raw)
    ? (raw as Stage)
    : null;
}

/** RFC 7951 encodes uint64 as a string; this backend sends numbers. */
function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function parseRow(row: DeviceStatusJson): DeviceStatusRow {
  const raw = row.status ?? 'unknown';
  return {
    device: row.device,
    status: normalizeStatus(raw),
    raw,
    version: row.version ?? '',
    model: row.model ?? '',
    stage: parseStage(row.stage),
    reason: row.reason ?? '',
    prepare: parseJob(row.prepare),
    install: parseJob(row.install),
    precheck: parseCheck(row.precheck),
    postcheck: parseCheck(row.postcheck)
  };
}

function parseStateParts(state: CampaignStateJson): StateParts {
  const windows = (state.plan?.window ?? []).map((w) => ({
    start: num(w.start),
    end: w.end == null ? null : num(w.end),
    schedule: w.schedule ?? '',
    devices: (w.device ?? []).map((d) => ({
      name: d.name,
      estimatedStart: num(d['estimated-start']),
      estimatedDuration: num(d['estimated-duration']),
      started: d.started == null ? null : num(d.started),
      finished: d.finished == null ? null : num(d.finished)
    }))
  }));
  windows.sort((a, b) => a.start - b.start);
  const rows = new Map<string, DeviceStatusRow>();
  for (const row of state['device-status'] ?? []) {
    rows.set(row.device, parseRow(row));
  }
  return {
    counters: parseCounters(state),
    windows,
    alarms: (state.plan?.alarm ?? []).filter((a) => !a.startsWith('unplannable: ')),
    placed: new Set(windows.flatMap((w) => w.devices.map((d) => d.name))),
    rows
  };
}

/** The state joined with the members: one row per member, then the
 * devices it reports that are not members; a member it does not mention
 * yet renders as unknown. No state, no plan and no counters. */
export function joinState(parts: StateParts | null, members: string[]): CampaignState {
  const memberSet = new Set(members);
  const extra = parts === null ? [] : [...parts.rows.keys()].filter((device) => !memberSet.has(device));
  return {
    counters: parts?.counters ?? null,
    plan:
      parts === null
        ? null
        : {
            windows: parts.windows,
            alarms: parts.alarms,
            unplaced: members.filter((m) => !parts.placed.has(m)).sort((a, b) => a.localeCompare(b))
          },
    deviceStatus: [...members, ...extra].map((device) => parts?.rows.get(device) ?? parseRow({ device }))
  };
}

function parseCampaignConfig(entry: CampaignJson): CampaignConfig {
  return {
    name: entry.name,
    devices: (entry.device ?? []).map((m) => m.name),
    images: (entry.device ?? []).map((m) => m.image ?? ''),
    adminState: entry['admin-state'] === 'run' ? 'run' : 'plan',
    defaultSchedule: entry['default-schedule'] ?? '',
    deadline: typeof entry.deadline === 'number' ? entry.deadline : null,
    targetConcurrency: entry['target-concurrency'] ?? DEFAULT_TARGET_CONCURRENCY,
    maxConcurrency: entry['max-concurrency'] ?? DEFAULT_MAX_CONCURRENCY
  };
}

function parseCampaign(entry: CampaignJson): Campaign {
  const config = parseCampaignConfig(entry);
  return { ...config, ...joinState(entry.state ? parseStateParts(entry.state) : null, config.devices) };
}

/** Parse a GET of one campaign's state node; null when there is none. */
export function parseStateNode(json: unknown): StateParts | null {
  const state = (json as { 'software:state'?: CampaignStateJson })?.['software:state'];
  return state ? parseStateParts(state) : null;
}

/** Parse a GET of data/fleetmgr:fleet (never poll data/ itself: it also
 * hauls the full yang-library). */
export function parseFleet(json: unknown): { devices: Device[] } {
  const fleet = (json as DataTreeJson)?.['fleetmgr:fleet'];
  return { devices: (fleet?.device ?? []).map(parseDevice) };
}

/** Parse a GET of data/software:software. */
export function parseCampaigns(json: unknown): Campaign[] {
  const tree = (json as DataTreeJson)?.['software:software'];
  return (tree?.['upgrade-campaign'] ?? []).map(parseCampaign);
}

/** Parse a GET of data/software:software?content=config: the campaigns
 * without their state. */
export function parseCampaignConfigs(json: unknown): CampaignConfig[] {
  const tree = (json as DataTreeJson)?.['software:software'];
  return (tree?.['upgrade-campaign'] ?? []).map(parseCampaignConfig);
}

/** Parse a GET of one campaign's state/device-status={device}; a device
 * the campaign does not report (404) is unknown. */
export function parseDeviceStatusEntry(json: unknown, device: string): DeviceStatusRow {
  const rows = (json as { 'software:device-status'?: DeviceStatusJson[] })?.['software:device-status'];
  return parseRow(rows?.[0] ?? { device });
}

/** A device's start in a GET of one campaign's state/plan: real once
 * released, else the estimate. 'unplaced' when the plan has no window for
 * the device, null when there is no plan (404). */
export function planStartOf(json: unknown, device: string): number | 'unplaced' | null {
  const plan = (json as { 'software:plan'?: PlanJson })?.['software:plan'];
  if (!plan) return null;
  for (const w of plan.window ?? []) {
    const d = (w.device ?? []).find((x) => x.name === device);
    if (d) return d.started == null ? num(d['estimated-start']) : num(d.started);
  }
  return 'unplaced';
}

/** Parse a GET of data/maintenance:schedules. */
export function parseSchedules(json: unknown): Schedule[] {
  const tree = (json as DataTreeJson)?.['maintenance:schedules'];
  const schedules = (tree?.schedule ?? []).map((s) => {
    const windows = (s.window ?? []).map((w) => ({
      at: num(w.at),
      duration: num(w.duration),
      days: w.day ?? []
    }));
    windows.sort((a, b) => a.at - b.at);
    return { name: s.name, utcOffset: num(s['utc-offset'] ?? 0), windows };
  });
  schedules.sort((a, b) => a.name.localeCompare(b.name));
  return schedules;
}

/** Parse a GET of data/fleetmgr:redundancy-groups. */
export function parseGroupSeparations(json: unknown): GroupSeparation[] {
  const tree = (json as { 'fleetmgr:redundancy-groups'?: { 'redundancy-group'?: RedundancyGroupJson[] } })?.[
    'fleetmgr:redundancy-groups'
  ];
  return (tree?.['redundancy-group'] ?? []).map((g) => ({
    name: g.name,
    policy: g['separation-policy'] === 'pack' ? 'pack' : 'spread',
    minSeparation: num(g['min-separation'] ?? 0)
  }));
}

/** Parse a GET of data/fleetmgr:fleet/device={name}. */
export function parseDeviceEntry(json: unknown): Device | null {
  const entries = (json as { 'fleetmgr:device'?: DeviceJson[] })?.['fleetmgr:device'];
  return entries && entries.length > 0 ? parseDevice(entries[0]) : null;
}

function parseImage(entry: ImageJson): CatalogImage {
  return {
    name: entry.name,
    os: entry.os ?? '',
    models: entry.model ?? [],
    version: entry.version ?? '',
    family: entry.family ?? '',
    isDefault: entry.default ?? false
  };
}

/** Parse a GET of data/stratoweave-images:images. */
export function parseImages(json: unknown): CatalogImage[] {
  return ((json as ImagesJson)?.['stratoweave-images:images']?.image ?? []).map(parseImage);
}

/** The url-base of a GET of data/stratoweave-images:images: where devices
 * fetch images from; empty when unset. */
export function parseUrlBase(json: unknown): string {
  return (json as ImagesJson)?.['stratoweave-images:images']?.['url-base'] ?? '';
}

export function urlBasePatch(urlBase: string): ImagesPatchJson {
  return { 'stratoweave-images:images': { 'url-base': urlBase } };
}

/** Parse a GET of data/stratoweave-images:images/image={name}. */
export function parseImageEntry(json: unknown): CatalogImage | null {
  const entries = (json as { 'stratoweave-images:image'?: ImageJson[] })?.['stratoweave-images:image'];
  return entries && entries.length > 0 ? parseImage(entries[0]) : null;
}

/** Parse a GET of one campaign entry: its config, and its state when the
 * GET asked for it and the campaign has published one. */
export function parseCampaignEntry(json: unknown): { config: CampaignConfig; state: StateParts | null } | null {
  const entry = (json as CampaignEntryJson)?.['software:upgrade-campaign']?.[0];
  return entry ? { config: parseCampaignConfig(entry), state: entry.state ? parseStateParts(entry.state) : null } : null;
}

// ── Patch builders ──

export interface NewCampaign {
  name: string;
  /** Each member with the image it installs. */
  devices: { name: string; image: string }[];
  allowStaging?: boolean;
}

/** A new campaign, in plan: schedule and pace are set on its page. */
export function campaignCreatePatch(input: NewCampaign): SoftwarePatchJson {
  const entry: Partial<CampaignJson> & { name: string } = {
    name: input.name.trim(),
    device: input.devices.map((d) => ({ name: d.name, image: d.image })),
    'admin-state': 'plan'
  };
  if (input.allowStaging) entry['allow-staging'] = true;
  return { 'software:software': { 'upgrade-campaign': [entry] } };
}

/** PATCH merges: sending only {name, admin-state} flips one leaf and
 * leaves the rest of the campaign intact. */
export function adminStatePatch(name: string, state: AdminState): SoftwarePatchJson {
  return { 'software:software': { 'upgrade-campaign': [{ name, 'admin-state': state }] } };
}

/** Every leaf, since a PUT replaces the whole entry. */
export function imageToJson(image: CatalogImage): ImageJson {
  const json: ImageJson = {
    name: image.name,
    os: image.os,
    version: image.version,
    model: [...image.models],
    default: image.isDefault
  };
  if (image.family) json.family = image.family;
  return json;
}

/** Adds `images` and clears the default of the images named in `clear`, in
 * one write, so that a family never has two defaults. */
export function imageCreatePatch(images: CatalogImage[], clear: string[] = []): ImagesPatchJson {
  const cleared: ImageJson[] = clear.map((name) => ({ name, default: false }));
  return { 'stratoweave-images:images': { image: [...images.map(imageToJson), ...cleared] } };
}

/** Clears the default of the images named. */
export function defaultsClearPatch(names: string[]): ImagesPatchJson {
  return imageCreatePatch([], names);
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
  if (input.devices.length === 0) {
    errors['device'] = 'Select at least one device.';
  } else if (input.devices.some((d) => !d.image)) {
    errors['image'] = 'Pick an image for every model.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
