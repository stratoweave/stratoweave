// A campaign's schedule and pace: the default schedule, the deadline and
// the two rates, as the wizard and the campaign page edit them.
//
// The pace comes from a deadline or from a target rate, not both. The
// model takes both, with target-rate as a floor under the deadline's pace
// and a default of 100, so pacing by the deadline sends target-rate 0 and
// pacing by the rate sends no deadline.

import {
  getListEntryPath,
  restconfGetJson,
  restconfPatchJson,
  restconfPutJson,
  wrapListEntryBody
} from '$lib/core/restconf/client';
import {
  CAMPAIGN_LIST_ROOT,
  DATA_ROOT,
  DEFAULT_MAX_RATE,
  DEFAULT_TARGET_RATE,
  type Campaign,
  type CampaignEntryJson,
  type CampaignJson,
  type CampaignPlan
} from './model';
import { formatDuration } from './time';

export type PaceBy = 'deadline' | 'rate';

export interface PlanningDraft {
  /** Schedule name; '' for none. */
  defaultSchedule: string;
  paceBy: PaceBy;
  /** `datetime-local` text on the viewer's clock; '' for none. */
  deadline: string;
  /** Devices per hour as typed; '' for the model default. */
  targetRate: string;
  maxRate: string;
}

export interface Planning {
  defaultSchedule: string;
  /** Seconds since the Unix epoch. */
  deadline: number | null;
  targetRate: number;
  maxRate: number;
}

const UINT32_MAX = 4294967295;

export function emptyPlanningDraft(): PlanningDraft {
  return { defaultSchedule: '', paceBy: 'rate', deadline: '', targetRate: '', maxRate: '' };
}

export function planningOf(c: Campaign): Planning {
  return { defaultSchedule: c.defaultSchedule, deadline: c.deadline, targetRate: c.targetRate, maxRate: c.maxRate };
}

export function planningDraft(p: Planning): PlanningDraft {
  const paceBy: PaceBy = p.deadline === null ? 'rate' : 'deadline';
  return {
    defaultSchedule: p.defaultSchedule,
    paceBy,
    deadline: p.deadline === null ? '' : toLocalInput(p.deadline),
    // Switching to the rate starts from the default, not from the 0 that
    // pacing by the deadline stores.
    targetRate: paceBy === 'deadline' || p.targetRate === DEFAULT_TARGET_RATE ? '' : String(p.targetRate),
    maxRate: p.maxRate === DEFAULT_MAX_RATE ? '' : String(p.maxRate)
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Epoch seconds -> "2026-10-05T14:30" on the viewer's clock. */
export function toLocalInput(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Errors by field: deadline, target-rate, max-rate; only the pace field
 * in use is checked. A deadline must lie ahead of `now`, unless it is the
 * one `saved` already holds. */
export function validatePlanningDraft(
  draft: PlanningDraft,
  now: number,
  saved?: PlanningDraft
): Record<string, string> {
  const errors: Record<string, string> = {};
  const rates: ['target-rate' | 'max-rate', string][] = [['max-rate', draft.maxRate]];
  if (draft.paceBy === 'deadline') {
    const t = Date.parse(draft.deadline);
    if (!draft.deadline) {
      errors['deadline'] = 'A deadline is required.';
    } else if (Number.isNaN(t)) {
      errors['deadline'] = 'A date and time.';
    } else if (t / 1000 <= now && draft.deadline !== saved?.deadline) {
      errors['deadline'] = 'The deadline is in the past.';
    }
  } else {
    rates.push(['target-rate', draft.targetRate]);
  }
  for (const [key, text] of rates) {
    const t = text.trim();
    if (t && (!/^\d+$/.test(t) || Number(t) > UINT32_MAX)) {
      errors[key] = 'A whole number of devices per hour.';
    }
  }
  return errors;
}

/** A valid draft as values; '' rates are the model defaults. Only the
 * pace field in use counts. */
export function planningFromDraft(draft: PlanningDraft): Planning {
  const byDeadline = draft.paceBy === 'deadline';
  return {
    defaultSchedule: draft.defaultSchedule,
    deadline: byDeadline && draft.deadline ? Math.floor(Date.parse(draft.deadline) / 1000) : null,
    targetRate: byDeadline ? 0 : draft.targetRate.trim() ? Number(draft.targetRate) : DEFAULT_TARGET_RATE,
    maxRate: draft.maxRate.trim() ? Number(draft.maxRate) : DEFAULT_MAX_RATE
  };
}

/** Devices in flight for a rate, the way the controller converts it on
 * every decision: rate × install time, rounded up, at least one. */
export function inFlight(ratePerHour: number, installSeconds: number): number {
  return Math.max(1, Math.ceil((ratePerHour * installSeconds) / 3600));
}

/** The plan's mean install estimate in seconds, rounded up like the
 * planner's; null when nothing is placed. */
export function planInstallSeconds(plan: CampaignPlan | null): number | null {
  const estimates = (plan?.windows ?? []).flatMap((w) => w.devices.map((d) => d.estimatedDuration));
  if (estimates.length === 0) return null;
  return Math.ceil(estimates.reduce((a, b) => a + b, 0) / estimates.length);
}

/** The draft's rates as devices upgrading at once, the way the controller
 * runs them: at the target number, up to the max number when a window
 * falls behind. '' while a rate does not parse. */
export function atOnceText(draft: PlanningDraft, installSeconds: number): string {
  const rate = (text: string, fallback: number): number | null => {
    const t = text.trim();
    if (!t) return fallback;
    return /^\d+$/.test(t) ? Number(t) : null;
  };
  const target = draft.paceBy === 'rate' ? rate(draft.targetRate, DEFAULT_TARGET_RATE) : 0;
  const max = rate(draft.maxRate, DEFAULT_MAX_RATE);
  if (target === null || max === null) return '';
  const t = target > 0 ? inFlight(target, installSeconds) : 0;
  const m = max > 0 ? Math.max(t, inFlight(max, installSeconds)) : null;
  const devices = (n: number) => `${n.toLocaleString()} device${n === 1 ? '' : 's'}`;
  // Below one device per install the controller still keeps one in
  // flight, which is faster than the rate.
  const pace = (r: number) => (r * installSeconds < 3600 ? ` (≈ ${Math.round(3600 / installSeconds)}/h)` : '');
  const head = `At an estimated ${formatDuration(installSeconds)} per install, that is`;
  if (t > 0) {
    const at = `${head} about ${devices(t)} at once${pace(target)}`;
    if (m === null) return `${at}, with no cap when a window falls behind.`;
    return m > t ? `${at}, up to ${m.toLocaleString()} when a window falls behind.` : `${at}.`;
  }
  return m === null ? 'No cap on devices at once.' : `${head} up to ${devices(m)} at once${pace(max)}.`;
}

type RemovableLeaf = 'default-schedule' | 'deadline';

/** The leaves a save sets and the ones it removes. */
export function planningChanges(saved: Planning, next: Planning): { set: Partial<CampaignJson>; remove: RemovableLeaf[] } {
  const set: Partial<CampaignJson> = {};
  const remove: RemovableLeaf[] = [];
  if (next.defaultSchedule !== saved.defaultSchedule) {
    if (next.defaultSchedule) set['default-schedule'] = next.defaultSchedule;
    else remove.push('default-schedule');
  }
  // The input holds whole minutes, so an untouched deadline compares equal.
  const minute = (t: number | null) => (t === null ? null : Math.floor(t / 60));
  if (minute(next.deadline) !== minute(saved.deadline)) {
    if (next.deadline !== null) set.deadline = next.deadline;
    else remove.push('deadline');
  }
  if (next.targetRate !== saved.targetRate) set['target-rate'] = next.targetRate;
  if (next.maxRate !== saved.maxRate) set['max-rate'] = next.maxRate;
  return { set, remove };
}

/** Setting leaves is a merge. Removing one takes a PUT of the whole entry
 * without it, since DELETE on a leaf returns 500 upstream; the entry is
 * read right before the write and sent back as read, minus its state. */
export async function saveCampaignPlanning(name: string, saved: Planning, next: Planning): Promise<void> {
  const { set, remove } = planningChanges(saved, next);
  if (remove.length === 0) {
    await restconfPatchJson(DATA_ROOT, { 'software:software': { 'upgrade-campaign': [{ name, ...set }] } });
    return;
  }
  const path = getListEntryPath(CAMPAIGN_LIST_ROOT, name);
  const entry = (await restconfGetJson<CampaignEntryJson>(path))?.['software:upgrade-campaign']?.[0];
  if (!entry) throw new Error(`Campaign ${name} no longer exists.`);
  const config: Partial<CampaignJson> = { ...entry, ...set };
  delete config.state;
  for (const leaf of remove) delete config[leaf];
  await restconfPutJson(path, wrapListEntryBody(CAMPAIGN_LIST_ROOT, config));
}
