// A campaign's schedule and pace: the default schedule, the deadline and
// how many devices upgrade at the same time, as the wizard and the campaign
// page edit them.
//
// The pace comes from a deadline or from a number of devices at once, not
// both. The model takes both, with target-concurrency as a floor under the
// deadline's pace and a default of 10, so pacing by the deadline sends
// target-concurrency 1, the slowest pace, and pacing by concurrency sends
// no deadline. The controller then goes above one device at once only as
// far as the deadline needs, up to max-concurrency.

import { restconfPatchJson, rewriteListEntry } from '$lib/core/restconf/client';
import {
  CAMPAIGN_LIST_ROOT,
  DATA_ROOT,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_TARGET_CONCURRENCY,
  type Campaign,
  type CampaignJson,
  type CampaignPlan
} from './model';
import { formatDuration, toLocalInput } from '$lib/core/time';

export type PaceBy = 'deadline' | 'concurrency';

export interface PlanningDraft {
  /** Schedule name; '' for none. */
  defaultSchedule: string;
  paceBy: PaceBy;
  /** `datetime-local` text on the viewer's clock; '' for none. */
  deadline: string;
  /** Devices at once as typed; '' for the model default. */
  targetConcurrency: string;
  maxConcurrency: string;
}

export interface Planning {
  defaultSchedule: string;
  /** Seconds since the Unix epoch. */
  deadline: number | null;
  targetConcurrency: number;
  maxConcurrency: number;
}

const UINT32_MAX = 4294967295;

export function emptyPlanningDraft(): PlanningDraft {
  return { defaultSchedule: '', paceBy: 'concurrency', deadline: '', targetConcurrency: '', maxConcurrency: '' };
}

export function planningOf(c: Campaign): Planning {
  return {
    defaultSchedule: c.defaultSchedule,
    deadline: c.deadline,
    targetConcurrency: c.targetConcurrency,
    maxConcurrency: c.maxConcurrency
  };
}

export function planningDraft(p: Planning): PlanningDraft {
  const paceBy: PaceBy = p.deadline === null ? 'concurrency' : 'deadline';
  return {
    defaultSchedule: p.defaultSchedule,
    paceBy,
    deadline: p.deadline === null ? '' : toLocalInput(p.deadline),
    // Switching to concurrency starts from the default, not from the 1 that
    // pacing by the deadline stores.
    targetConcurrency:
      paceBy === 'deadline' || p.targetConcurrency === DEFAULT_TARGET_CONCURRENCY ? '' : String(p.targetConcurrency),
    maxConcurrency: p.maxConcurrency === DEFAULT_MAX_CONCURRENCY ? '' : String(p.maxConcurrency)
  };
}

/** Errors by field: deadline, target-concurrency, max-concurrency; only
 * the pace field in use is checked. A deadline must lie ahead of `now`,
 * unless it is the one `saved` already holds. */
export function validatePlanningDraft(
  draft: PlanningDraft,
  now: number,
  saved?: PlanningDraft
): Record<string, string> {
  const errors: Record<string, string> = {};
  const counts: ['target-concurrency' | 'max-concurrency', string][] = [['max-concurrency', draft.maxConcurrency]];
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
    counts.push(['target-concurrency', draft.targetConcurrency]);
  }
  for (const [key, text] of counts) {
    const t = text.trim();
    if (t && (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > UINT32_MAX)) {
      errors[key] = 'A whole number of devices, 1 or more.';
    }
  }
  return errors;
}

/** A valid draft as values; a '' number is the model default. Only the
 * pace field in use counts. */
export function planningFromDraft(draft: PlanningDraft): Planning {
  const byDeadline = draft.paceBy === 'deadline';
  return {
    defaultSchedule: draft.defaultSchedule,
    deadline: byDeadline && draft.deadline ? Math.floor(Date.parse(draft.deadline) / 1000) : null,
    targetConcurrency: byDeadline ? 1 : draft.targetConcurrency.trim() ? Number(draft.targetConcurrency) : DEFAULT_TARGET_CONCURRENCY,
    maxConcurrency: draft.maxConcurrency.trim() ? Number(draft.maxConcurrency) : DEFAULT_MAX_CONCURRENCY
  };
}

/** The plan's mean install estimate in seconds, rounded up like the
 * planner's; null when nothing is placed. */
export function planInstallSeconds(plan: CampaignPlan | null): number | null {
  const estimates = (plan?.windows ?? []).flatMap((w) => w.devices.map((d) => d.estimatedDuration));
  if (estimates.length === 0) return null;
  return Math.ceil(estimates.reduce((a, b) => a + b, 0) / estimates.length);
}

/** The draft's devices at once as devices per hour, at the plan's install
 * estimate. A max below the target counts as the target. '' while a
 * number does not parse. */
export function perHourText(draft: PlanningDraft, installSeconds: number): string {
  const count = (text: string, fallback: number): number | null => {
    const t = text.trim();
    if (!t) return fallback;
    return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) : null;
  };
  const max = count(draft.maxConcurrency, DEFAULT_MAX_CONCURRENCY);
  if (max === null) return '';
  const hourly = (n: number) => Math.round((n * 3600) / installSeconds);
  const devices = (n: number) => `${n.toLocaleString()} device${n === 1 ? '' : 's'}`;
  const install = `an estimated ${formatDuration(installSeconds)} per install`;
  if (draft.paceBy === 'deadline') {
    return `At most ${max.toLocaleString()} at once, about ${devices(hourly(max))} per hour at ${install}.`;
  }
  const target = count(draft.targetConcurrency, DEFAULT_TARGET_CONCURRENCY);
  if (target === null) return '';
  const head = `At ${install}, ${target.toLocaleString()} at once is about ${devices(hourly(target))} per hour`;
  if (max <= target) return `${head}.`;
  return `${head}, up to ${hourly(max).toLocaleString()} per hour at ${max.toLocaleString()} when a window falls behind.`;
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
  if (next.targetConcurrency !== saved.targetConcurrency) set['target-concurrency'] = next.targetConcurrency;
  if (next.maxConcurrency !== saved.maxConcurrency) set['max-concurrency'] = next.maxConcurrency;
  return { set, remove };
}

/** Setting leaves is a merge. Removing one rewrites the entry as read,
 * minus its state. */
export async function saveCampaignPlanning(name: string, saved: Planning, next: Planning): Promise<void> {
  const { set, remove } = planningChanges(saved, next);
  if (remove.length === 0) {
    await restconfPatchJson(DATA_ROOT, { 'software:software': { 'upgrade-campaign': [{ name, ...set }] } });
    return;
  }
  await rewriteListEntry(CAMPAIGN_LIST_ROOT, name, (entry) => {
    const config: Record<string, unknown> = { ...entry, ...set };
    delete config.state;
    for (const leaf of remove) delete config[leaf];
    return config;
  });
}
