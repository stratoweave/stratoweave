import type { ValidationResult } from '#lib/core/validation/types.ts';
import type { CatalogImage, Checksum } from '#lib/software/images.ts';

// RESTCONF paths. Writes always PATCH the datastore root: the backend
// rejects a PATCH whose target resource does not exist yet (RFC 8040),
// so creation merges into `data` under the module-qualified wrappers.
export const DATA_ROOT = 'data';
export const SOFTWARE_ROOT = 'data/software:software';
export const SCHEDULES_ROOT = 'data/maintenance:schedules';
export const SCHEDULE_LIST_ROOT = 'data/maintenance:schedules/schedule';
export const CAMPAIGN_LIST_ROOT = 'data/software:software/upgrade-campaign';
export const IMAGES_ROOT = 'data/stratoweave-images:images';
export const IMAGE_LIST_ROOT = `${IMAGES_ROOT}/image`;
export const FLEET_ROOT = 'data/fleetmgr:fleet';
export const FLEET_DEVICE_LIST_ROOT = 'data/fleetmgr:fleet/device';
export const REDUNDANCY_GROUPS_ROOT = 'data/fleetmgr:redundancy-groups';
export const REDUNDANCY_GROUP_LIST_ROOT = `${REDUNDANCY_GROUPS_ROOT}/redundancy-group`;

// Smaller reads with the RFC 8040 fields parameter. A list entry with
// nothing selected in it is left out, so a read that needs every entry
// selects its key. Pages that share one of these share its cached read.
/** A device entry as parseDevice reads it: no credentials or mock
 * settings, which are most of it, and of its state only the platform and
 * whether it can be reached. */
export const DEVICE_FIELDS =
  'name;type;description;schedule;address(address;port);redundancy-group;redundancy-priority;state(connected;platform(model;version;serial-number))';
/** The fleet as parseFleet reads it. */
export const FLEET_LIST = `${FLEET_ROOT}?fields=device(${DEVICE_FIELDS})`;
/** The devices bound to a schedule, with the binding. Config only: the
 * state of 100k devices doubles the time of the read. */
export const FLEET_SCHEDULES = `${FLEET_ROOT}?content=config&fields=device/schedule`;
/** The campaigns with their admin state, default schedule and
 * allow-staging only. */
export const CAMPAIGN_SETTINGS = `${SOFTWARE_ROOT}?content=config&fields=upgrade-campaign(name;admin-state;default-schedule;allow-staging)`;
/** The campaigns that have devices, with the names of their devices only. */
export const CAMPAIGN_MEMBERS = `${SOFTWARE_ROOT}?content=config&fields=upgrade-campaign/device/name`;
/** The campaigns with the names of their devices, and the devices that
 * each has freed: a complete campaign frees its members, and another
 * campaign can then take them. */
export const CAMPAIGN_OWNERS = `${SOFTWARE_ROOT}?fields=upgrade-campaign(name;device/name;state/device-status(device;freed))`;
/** The campaigns with their names and the images their devices use. */
export const CAMPAIGN_IMAGES = `${SOFTWARE_ROOT}?content=config&fields=upgrade-campaign(name;device/image)`;
/** Every campaign with its admin state and the names of its devices, not
 * their images. */
export const CAMPAIGN_LIST = `${SOFTWARE_ROOT}?content=config&fields=upgrade-campaign(name;admin-state;device/name)`;

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
  credentials?: { username?: string; password?: string; key?: { key: string; 'private-key'?: string }[] };
  /** Adapters beside the one of the device type, such as iosxe-cli. */
  'extra-adapter'?: { type: string; port?: number }[];
  mock?: { enabled?: boolean };
  state?: {
    platform?: { version?: string; model?: string; 'serial-number'?: string };
    connected?: string;
  };
}

interface CampaignMemberJson {
  name: string;
  image?: string;
  /** A GET omits the default 0. */
  'prepare-attempt'?: number;
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
  /** The release the job copies or installs. */
  release?: string;
  /** For the prepare: the member's prepare-attempt that it ran for. */
  'prepare-attempt'?: number;
  message?: string;
  progress?: number | string;
}

interface DeviceStatusJson {
  device: string;
  status?: string;
  /** The attempt the status is for. */
  attempt?: number | string;
  /** Why the member may not start now; absent when it may. */
  held?: string;
  /** The device or flotilla that holds it, when another one does. */
  'held-by'?: string;
  /** The target release of the intent the status is for. */
  'target-release'?: string;
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
  /** When the campaign freed the device: it shows its result then. */
  freed?: number | string;
  /** When a freed member was done. */
  finished?: number | string;
}

/** One recurrence rule of a schedule: a local time of day. */
interface WindowJson {
  id: number;
  description?: string;
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
  'prepare-start'?: number | string;
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
  'prepare-concurrency'?: number | string;
  /** Whether the members may prepare between windows: as set, or as the
   * plan decides when the campaign leaves it out. */
  'prepare-between-windows'?: boolean;
  /** The cap of the prepares' bandwidth in bits/s, the campaign's or the
   * image list's. */
  'prepare-max-bandwidth'?: number | string;
}

/** Counters are optional and do not sum to total: pending, unknown and
 * upgrade-needed devices fall into no counter. succeeded includes
 * up-to-date, which up-to-date counts again, and held overlaps the others:
 * it counts the members that device-status gives a held reason. */
interface CampaignStateJson {
  /** Seconds since the Unix epoch: when the campaign first went to run. */
  'run-since'?: number | string;
  /** When the campaign was complete and freed its members. */
  completed?: number | string;
  total?: number;
  'in-progress'?: number;
  succeeded?: number;
  'up-to-date'?: number;
  failed?: number;
  held?: number;
  plan?: PlanJson;
  'device-status'?: DeviceStatusJson[];
}

export interface CampaignJson {
  name: string;
  'allow-staging'?: boolean;
  'prepare-before-first-window'?: boolean;
  /** Absent: the plan decides. */
  'prepare-between-windows'?: boolean;
  'prepare-during-windows'?: boolean;
  /** Bits/s, a uint64, so a string in RFC 7951 JSON; absent for the image
   * list's. */
  'prepare-max-bandwidth'?: number | string;
  device?: CampaignMemberJson[];
  'admin-state'?: AdminState;
  'default-schedule'?: string;
  deadline?: number;
  'target-concurrency'?: number;
  'max-concurrency'?: number;
  /** Days; a GET omits the default 0. */
  'notification-period'?: number;
  /** decimal64 percent, a string in RFC 7951 JSON; absent for none. */
  'failure-budget'?: number | string;
  'close-margin'?: number;
  stagger?: number;
  state?: CampaignStateJson;
}

export type SeparationPolicy = 'spread' | 'pack';
export type FailurePolicy = 'continue' | 'hold';

/** /fleetmgr:redundancy-groups/redundancy-group entry: how far apart the
 * members of a group upgrade, and what a failed member does to the
 * others. */
export interface RedundancyGroupJson {
  name: string;
  'separation-policy'?: SeparationPolicy;
  'min-separation'?: number;
  'failure-policy'?: FailurePolicy;
}

/** /stratoweave-images:images/image entry. */
export interface ImageJson {
  name: string;
  /** Path of the file in the image folder; without it, the name. */
  file?: string;
  os?: string;
  version?: string;
  model?: string[];
  checksum?: Checksum[];
  // uint64: a number from StratoWeave, a string in RFC 7951 JSON.
  size?: string | number;
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
  'rolled-back',
  'not-started'
] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];

/** True for a status that ends an upgrade attempt, as the campaign takes
 * it: a member with one needs no window. not-started counts as a failed
 * rollback. */
export function isFinalStatus(status: KnownStatus): boolean {
  return (
    status === 'succeeded' ||
    status === 'up-to-date' ||
    status === 'failed' ||
    status === 'rolled-back' ||
    status === 'not-started'
  );
}

function normalizeStatus(raw: unknown): KnownStatus {
  return typeof raw === 'string' && (KNOWN_STATUSES as readonly string[]).includes(raw)
    ? (raw as KnownStatus)
    : 'unknown';
}

export type StatusTone = 'accent' | 'success' | 'warning' | 'danger' | 'muted';

export const STATUS_TONE: Record<KnownStatus, StatusTone> = {
  pending: 'muted',
  unknown: 'muted',
  'up-to-date': 'success',
  'upgrade-needed': 'muted',
  'in-progress': 'accent',
  succeeded: 'success',
  failed: 'danger',
  'rolled-back': 'danger',
  'not-started': 'danger'
};

/** How a status reads, in the same words as the plan timeline and the
 * progress bar; the wire value goes in a tooltip. pending is a member whose
 * device has no status for the member's attempt: it has not answered the
 * campaign's target. */
export const STATUS_LABEL: Record<KnownStatus, string> = {
  pending: 'not answered',
  unknown: 'unknown',
  'up-to-date': 'up to date',
  'upgrade-needed': 'waiting',
  'in-progress': 'in progress',
  succeeded: 'upgraded',
  failed: 'failed',
  'rolled-back': 'rolled back',
  'not-started': 'not started'
};

/** How a campaign's admin-state reads: plan before it first ran is
 * planned, plan after it is paused. */
export function modeLabel(state: AdminState, runSince: number | null): string {
  if (state === 'run') return 'running';
  return runSince === null ? 'planned' : 'paused';
}

/** Why a campaign holds a member, as device-status/held names it. */
export const HELD_REASONS = [
  'down',
  'flotilla-down',
  'not-answered',
  'vetoed',
  'group-failed',
  'group-down',
  'group-not-answered',
  'group-vetoed',
  'failure-budget'
] as const;
export type HeldReason = (typeof HELD_REASONS)[number];

function parseHeld(raw: string | undefined): HeldReason | null {
  return (HELD_REASONS as readonly (string | undefined)[]).includes(raw) ? (raw as HeldReason) : null;
}

/** Whether a fleet device can be reached, as /fleet/device/state/connected
 * says; null while it has not connected since fleetmgr started. */
export type Connection = 'connected' | 'device-down' | 'flotilla-down';

function parseConnection(raw: string | undefined): Connection | null {
  return raw === 'connected' || raw === 'device-down' || raw === 'flotilla-down' ? raw : null;
}

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
  /** Whether it can be reached; null until it first connects. */
  connection: Connection | null;
  /** The redundancy groups it is a member of, as stored. */
  groups: string[];
  /** Where it comes in each of its groups: lower first. */
  priority: number;
}

export type Verdict = 'not-run' | 'pass' | 'fail';

/** The steps of an upgrade run in order, as software/state/attempt/stage names
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

/** null: the device has not run the job for its target. retrying: it
 * failed for a transient reason, and the device tries it again. */
export type JobState = 'running' | 'done' | 'retrying' | 'failed' | null;

/** The prepare or the install of a device, as its software manager
 * reports it. */
export interface Job {
  state: JobState;
  /** The release it copies or installs; '' when not reported. */
  release: string;
  /** For the prepare: the member's prepare-attempt that it ran for. */
  prepareAttempt: number;
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
  /** The target release of the intent the status is for; '' for none. */
  targetRelease: string;
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
  /** Why the campaign holds it; null when it may start, or has. */
  held: HeldReason | null;
  /** The device or flotilla that holds it; '' when none does. */
  heldBy: string;
  /** The attempt its status is for: the one in progress, or else the
   * member's attempt. */
  attempt: number;
  /** Seconds since the Unix epoch, when the campaign freed the device; it
   * then shows its result and nothing that the device reports. null while
   * the campaign has not freed it. */
  freed: number | null;
  /** Seconds since the Unix epoch, when a freed member was done. */
  finished: number | null;
}

export interface CampaignCounters {
  total: number;
  inProgress: number;
  /** Includes upToDate. */
  succeeded: number;
  /** Members that ran the target release already. */
  upToDate: number;
  failed: number;
  /** Members with a held reason, whatever their status. */
  held: number;
  /** total - (inProgress + succeeded + failed), floored at 0: members that
   * wait, upgrade-needed, pending or unknown. Not an error. */
  remainder: number;
  /** Seconds since the Unix epoch, when the campaign was complete: every
   * member done, and freed. null while it is not. */
  completed: number | null;
}

/** YANG defaults; a GET omits leaves left at their default. */
export const DEFAULT_TARGET_CONCURRENCY = 10;
export const DEFAULT_MAX_CONCURRENCY = 50;
export const DEFAULT_CLOSE_MARGIN = 150;
export const DEFAULT_STAGGER = 25;
export const DEFAULT_PRIORITY = 100;

/** A group's entry under /redundancy-groups, or the defaults of a group
 * that has none. */
export interface GroupPolicy {
  name: string;
  separationPolicy: SeparationPolicy;
  /** Seconds from when one member is done until the next may start. */
  minSeparation: number;
  /** continue: a failed member holds the others until it is done and up
   * again, unless its rollback failed. hold: until an operator acts. */
  failurePolicy: FailurePolicy;
}

export interface MaintenanceWindow {
  /** The key within the schedule. */
  id: number;
  /** Optional label; '' for none. */
  description: string;
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
  /** Seconds since the Unix epoch: when the campaign let the device
   * prepare its image ahead of its window in this run, or, for one that
   * waits to prepare, when it will. null when it does not prepare ahead. */
  prepareStart: number | null;
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
  /** The most members that prepare at once in the plan; null when none
   * prepares ahead. */
  prepareConcurrency: number | null;
  /** Whether the members may prepare between windows, as the plan has it;
   * null without prepare ahead. */
  prepareBetween: boolean | null;
  /** The cap of the prepares' bandwidth in bits/s that the plan keeps
   * under; null without prepare ahead. */
  prepareMaxBandwidth: number | null;
  /** The planner's alarms, which also name the members that need a window
   * and have none (unplaced). */
  alarms: string[];
  /** The members in no window yet, by name. */
  unplaced: string[];
  /** Members in no window because their status is final before their
   * release: up to date, or done in an earlier run. They need no window. */
  done: string[];
}

export interface Campaign {
  name: string;
  /** Whether members prepare their image ahead of their window. */
  allowStaging: boolean;
  /** When they may: before the first window, between windows (null: as
   * the plan decides) and during windows. */
  prepareFirst: boolean;
  prepareBetween: boolean | null;
  prepareDuring: boolean;
  /** Bits/s; null for the image list's. */
  prepareMaxBandwidth: number | null;
  devices: string[];
  /** The image of each member, in the order of devices. */
  images: string[];
  /** The prepare-attempt of each member, in the order of devices. */
  prepareAttempts: number[];
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
  /** Days of notice before the first window the campaign uses. */
  notificationPeriod: number;
  /** Percent of the members that may fail; null for no budget. */
  failureBudget: number | null;
  /** Percent of a slow upgrade that a device needs left in its window to
   * start there. */
  closeMargin: number;
  /** Percent of an upgrade that the starts of a full window spread over. */
  stagger: number;
  /** Seconds since the Unix epoch: when it first went to run. */
  runSince: number | null;
  counters: CampaignCounters | null;
  plan: CampaignPlan | null;
  deviceStatus: DeviceStatusRow[];
}

/** One campaign as a member device's page shows it. */
export interface DeviceCampaign {
  name: string;
  adminState: AdminState;
  /** When the campaign first ran, which tells paused from planned. */
  runSince: number | null;
  defaultSchedule: string;
  /** The image the device installs; '' for none. */
  image: string;
  /** Whether the campaign lets its members prepare ahead. */
  allowStaging: boolean;
  /** The member's prepare-attempt. */
  prepareAttempt: number;
  row: DeviceStatusRow;
  /** See planStartOf. */
  start: number | 'unplaced' | null;
}

/** The published half of a campaign: counters, plan and one row per
 * member. */
type CampaignState = Pick<Campaign, 'counters' | 'plan' | 'deviceStatus' | 'runSince'>;

/** A campaign without its published state. */
export type CampaignConfig = Omit<Campaign, keyof CampaignState>;

/** A campaign's published state as read, before it is joined with the
 * member list: what the plan places, and one row per device it reports. */
export interface StateParts {
  counters: CampaignCounters | null;
  runSince: number | null;
  windows: PlanWindow[];
  prepareConcurrency: number | null;
  prepareBetween: boolean | null;
  prepareMaxBandwidth: number | null;
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
    connection: parseConnection(entry.state?.connected),
    groups: entry['redundancy-group'] ?? [],
    priority: entry['redundancy-priority'] === undefined ? DEFAULT_PRIORITY : num(entry['redundancy-priority'])
  };
}

function countersOf(c: Omit<CampaignCounters, 'remainder'>): CampaignCounters {
  return { ...c, remainder: Math.max(0, c.total - c.inProgress - c.succeeded - c.failed) };
}

function parseCounters(state: CampaignStateJson | undefined): CampaignCounters | null {
  if (!state || typeof state.total !== 'number') {
    return null;
  }
  return countersOf({
    total: state.total,
    inProgress: state['in-progress'] ?? 0,
    succeeded: state.succeeded ?? 0,
    upToDate: state['up-to-date'] ?? 0,
    failed: state.failed ?? 0,
    held: state.held ?? 0,
    completed: state.completed == null ? null : num(state.completed)
  });
}

/** An absent check has not run. */
function parseCheck(json: CheckResultJson | undefined): CheckResult {
  const verdict = json?.verdict === 'pass' || json?.verdict === 'fail' ? json.verdict : 'not-run';
  const at = json?.at ? Date.parse(json.at) : NaN;
  return { verdict, detail: json?.detail ?? '', at: Number.isFinite(at) ? at / 1000 : null };
}

const JOB_STATES: readonly string[] = ['running', 'done', 'retrying', 'failed'];

function parseJob(json: JobJson | undefined): Job {
  const state = JOB_STATES.includes(json?.state ?? '') ? (json?.state as JobState) : null;
  return {
    state,
    release: json?.release ?? '',
    prepareAttempt: num(json?.['prepare-attempt'] ?? 0),
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
    targetRelease: row['target-release'] ?? '',
    version: row.version ?? '',
    model: row.model ?? '',
    stage: parseStage(row.stage),
    reason: row.reason ?? '',
    prepare: parseJob(row.prepare),
    install: parseJob(row.install),
    precheck: parseCheck(row.precheck),
    postcheck: parseCheck(row.postcheck),
    held: parseHeld(row.held),
    heldBy: row['held-by'] ?? '',
    attempt: num(row.attempt),
    freed: row.freed == null ? null : num(row.freed),
    finished: row.finished == null ? null : num(row.finished)
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
      finished: d.finished == null ? null : num(d.finished),
      prepareStart: d['prepare-start'] == null ? null : num(d['prepare-start'])
    }))
  }));
  windows.sort((a, b) => a.start - b.start);
  const rows = new Map<string, DeviceStatusRow>();
  for (const row of state['device-status'] ?? []) {
    rows.set(row.device, parseRow(row));
  }
  return {
    counters: parseCounters(state),
    runSince: state['run-since'] == null ? null : num(state['run-since']),
    windows,
    prepareConcurrency: state.plan?.['prepare-concurrency'] == null ? null : num(state.plan['prepare-concurrency']),
    prepareBetween: state.plan?.['prepare-between-windows'] ?? null,
    prepareMaxBandwidth:
      state.plan?.['prepare-max-bandwidth'] == null ? null : num(state.plan['prepare-max-bandwidth']),
    alarms: state.plan?.alarm ?? [],
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
  const done = (m: string) => {
    const row = parts?.rows.get(m);
    return row !== undefined && isFinalStatus(row.status);
  };
  const byName = (a: string, b: string) => a.localeCompare(b);
  return {
    counters: parts?.counters ?? null,
    runSince: parts?.runSince ?? null,
    plan:
      parts === null
        ? null
        : {
            windows: parts.windows,
            prepareConcurrency: parts.prepareConcurrency,
            prepareBetween: parts.prepareBetween,
            prepareMaxBandwidth: parts.prepareMaxBandwidth,
            alarms: parts.alarms,
            unplaced: members.filter((m) => !parts.placed.has(m) && !done(m)).sort(byName),
            done: members.filter((m) => !parts.placed.has(m) && done(m)).sort(byName)
          },
    deviceStatus: [...members, ...extra].map((device) => parts?.rows.get(device) ?? parseRow({ device }))
  };
}

function parseCampaignConfig(entry: CampaignJson): CampaignConfig {
  return {
    name: entry.name,
    allowStaging: entry['allow-staging'] === true,
    prepareFirst: entry['prepare-before-first-window'] !== false,
    prepareBetween: entry['prepare-between-windows'] ?? null,
    prepareDuring: entry['prepare-during-windows'] === true,
    prepareMaxBandwidth: entry['prepare-max-bandwidth'] == null ? null : num(entry['prepare-max-bandwidth']),
    devices: (entry.device ?? []).map((m) => m.name),
    images: (entry.device ?? []).map((m) => m.image ?? ''),
    prepareAttempts: (entry.device ?? []).map((m) => num(m['prepare-attempt'] ?? 0)),
    adminState: entry['admin-state'] === 'run' ? 'run' : 'plan',
    defaultSchedule: entry['default-schedule'] ?? '',
    deadline: typeof entry.deadline === 'number' ? entry.deadline : null,
    targetConcurrency: entry['target-concurrency'] ?? DEFAULT_TARGET_CONCURRENCY,
    maxConcurrency: entry['max-concurrency'] ?? DEFAULT_MAX_CONCURRENCY,
    notificationPeriod: num(entry['notification-period'] ?? 0),
    failureBudget: entry['failure-budget'] == null ? null : num(entry['failure-budget']),
    closeMargin: num(entry['close-margin'] ?? DEFAULT_CLOSE_MARGIN),
    stagger: num(entry.stagger ?? DEFAULT_STAGGER)
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

/** The image, '' for none, and the prepare-attempt in a GET of one
 * campaign's device={device}; null when the device is not a member (404). */
export function parseMember(json: unknown): { image: string; prepareAttempt: number } | null {
  const entries = (json as { 'software:device'?: CampaignMemberJson[] })?.['software:device'];
  if (!entries || entries.length === 0) return null;
  return { image: entries[0].image ?? '', prepareAttempt: num(entries[0]['prepare-attempt'] ?? 0) };
}

/** A campaign's state/plan with only what planStartOf reads. */
export function planStartsPath(campaignEntry: string): string {
  return `${campaignEntry}/state/plan?fields=window/device(name;started;estimated-start)`;
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
      id: num(w.id),
      description: w.description ?? '',
      at: num(w.at),
      duration: num(w.duration),
      days: w.day ?? []
    }));
    windows.sort((a, b) => a.at - b.at || a.id - b.id);
    return { name: s.name, utcOffset: num(s['utc-offset'] ?? 0), windows };
  });
  schedules.sort((a, b) => a.name.localeCompare(b.name));
  return schedules;
}

/** Parse a GET of data/fleetmgr:redundancy-groups. A GET omits the leaves
 * left at their defaults. */
export function parseGroupPolicies(json: unknown): GroupPolicy[] {
  const tree = (json as { 'fleetmgr:redundancy-groups'?: { 'redundancy-group'?: RedundancyGroupJson[] } })?.[
    'fleetmgr:redundancy-groups'
  ];
  return (tree?.['redundancy-group'] ?? []).map((g) => ({
    name: g.name,
    separationPolicy: g['separation-policy'] === 'pack' ? 'pack' : 'spread',
    minSeparation: num(g['min-separation'] ?? 0),
    failurePolicy: g['failure-policy'] === 'hold' ? 'hold' : 'continue'
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
    file: entry.file || entry.name,
    os: entry.os ?? '',
    models: entry.model ?? [],
    version: entry.version ?? '',
    family: entry.family ?? '',
    isDefault: entry.default ?? false,
    checksums: (entry.checksum ?? []).map((c) => ({ algorithm: c.algorithm, digest: c.digest })),
    size: entry.size === undefined ? null : Number(entry.size)
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
  /** Only with allowStaging; absent leaves the model defaults: before
   * the first window, between windows as the plan decides, not during
   * windows, and the image list's cap. */
  prepareFirst?: boolean;
  prepareBetween?: boolean | null;
  prepareDuring?: boolean;
  /** Bits/s. */
  prepareMaxBandwidth?: number | null;
  /** Days; 0 or absent leaves the model default, no notice. */
  notificationPeriod?: number;
}

/** A new campaign, in plan: schedule and pace are set on its page. */
export function campaignCreatePatch(input: NewCampaign): SoftwarePatchJson {
  const entry: Partial<CampaignJson> & { name: string } = {
    name: input.name.trim(),
    device: input.devices.map((d) => ({ name: d.name, image: d.image })),
    'admin-state': 'plan'
  };
  if (input.allowStaging) {
    entry['allow-staging'] = true;
    if (input.prepareFirst === false) entry['prepare-before-first-window'] = false;
    if (input.prepareBetween != null) entry['prepare-between-windows'] = input.prepareBetween;
    if (input.prepareDuring) entry['prepare-during-windows'] = true;
    if (input.prepareMaxBandwidth != null) entry['prepare-max-bandwidth'] = String(input.prepareMaxBandwidth);
  }
  if (input.notificationPeriod) entry['notification-period'] = input.notificationPeriod;
  return { 'software:software': { 'upgrade-campaign': [entry] } };
}

/** PATCH merges: sending only {name, admin-state} flips one leaf and
 * leaves the rest of the campaign intact. */
export function adminStatePatch(name: string, state: AdminState): SoftwarePatchJson {
  return { 'software:software': { 'upgrade-campaign': [{ name, 'admin-state': state }] } };
}

/** A PATCH merge that raises one member's prepare-attempt, which makes the
 * campaign let it prepare again at once. */
export function prepareAgainPatch(campaign: string, member: string, prepareAttempt: number): SoftwarePatchJson {
  return {
    'software:software': {
      'upgrade-campaign': [{ name: campaign, device: [{ name: member, 'prepare-attempt': prepareAttempt + 1 }] }]
    }
  };
}

/** Every leaf, since a PUT replaces the whole entry. A file at the name
 * needs no file leaf. */
export function imageToJson(image: CatalogImage): ImageJson {
  const json: ImageJson = {
    name: image.name,
    ...(image.file && image.file !== image.name ? { file: image.file } : {}),
    os: image.os,
    version: image.version,
    model: [...image.models],
    default: image.isDefault
  };
  if (image.family) json.family = image.family;
  if (image.checksums.length > 0) json.checksum = image.checksums.map((c) => ({ ...c }));
  if (image.size !== null) json.size = image.size;
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

/** Points each image named at its file's new path, in one write. The
 * images keep their names, so the campaigns that name them follow. */
export function imageFilesPatch(moved: { name: string; file: string }[]): ImagesPatchJson {
  return { 'stratoweave-images:images': { image: moved.map(({ name, file }) => ({ name, file })) } };
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
