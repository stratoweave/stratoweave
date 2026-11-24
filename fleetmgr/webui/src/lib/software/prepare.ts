// Preparing ahead: with allow-staging, a member copies its image to the
// device before its window, while the campaign holds the install. The plan
// gives each such member a prepare-start; while the member waits for its
// window, its device-status row carries the prepare job. Once its window
// run starts, that run fills the same prepare entry, so how the prepare
// ahead went is no longer published: the member is then only released.

import type { CampaignPlan, DeviceStatusRow, KnownStatus } from './model';

export type PrepareState = 'scheduled' | 'preparing' | 'retrying' | 'prepared' | 'failed' | 'released';

export interface PrepareView {
  state: PrepareState;
  /** prepare-start, seconds since the Unix epoch. */
  start: number;
  /** Percent of the image copied while it prepares; null otherwise. */
  progress: number | null;
  /** Why the prepare failed, or why it is retrying; '' otherwise. */
  message: string;
}

/** Statuses of a member whose window run has started or ended. */
const RELEASED = new Set<KnownStatus>(['in-progress', 'succeeded', 'failed', 'rolled-back', 'up-to-date']);

/** The prepare of each member that has a prepare-start, from the plan and
 * the member's row. A prepare job counts only when it is for the member's
 * target release and its prepare-attempt, in prepareAttempts (absent is
 * 0): a job left from another intent says nothing about this one, and one
 * from an earlier prepare-attempt is an ask to prepare again on its way. A
 * member that has not reported its prepare yet is scheduled. */
export function prepareViews(
  plan: CampaignPlan | null,
  rows: DeviceStatusRow[],
  prepareAttempts: Map<string, number> = new Map()
): Map<string, PrepareView> {
  const out = new Map<string, PrepareView>();
  if (plan === null) return out;
  const byName = new Map(rows.map((r) => [r.device, r]));
  for (const w of plan.windows) {
    for (const d of w.devices) {
      if (d.prepareStart === null) continue;
      const row = byName.get(d.name);
      const view: PrepareView = { state: 'scheduled', start: d.prepareStart, progress: null, message: '' };
      if (row && RELEASED.has(row.status)) {
        view.state = 'released';
      } else if (row && row.status === 'upgrade-needed') {
        const job = row.prepare;
        const current =
          (!job.release || !row.targetRelease || job.release === row.targetRelease) &&
          job.prepareAttempt >= (prepareAttempts.get(d.name) ?? 0);
        if (current && job.state === 'running') {
          view.state = 'preparing';
          view.progress = job.progress;
        } else if (current && job.state === 'done') {
          view.state = 'prepared';
        } else if (current && (job.state === 'failed' || job.state === 'retrying')) {
          view.state = job.state;
          view.message = job.message;
        }
      }
      out.set(d.name, view);
    }
  }
  return out;
}

export interface PrepareTally {
  /** Members that prepare ahead and still wait for their window. */
  waiting: number;
  scheduled: number;
  preparing: number;
  /** Failed for a transient reason, and tried again. */
  retrying: number;
  prepared: number;
  failed: number;
  released: number;
  /** The first and last prepare-start still to come; null for none. */
  next: number | null;
  last: number | null;
}

export function prepareTally(views: Map<string, PrepareView>): PrepareTally {
  const t: PrepareTally = {
    waiting: 0,
    scheduled: 0,
    preparing: 0,
    retrying: 0,
    prepared: 0,
    failed: 0,
    released: 0,
    next: null,
    last: null
  };
  for (const v of views.values()) {
    t[v.state]++;
    if (v.state !== 'released') t.waiting++;
    if (v.state === 'scheduled') {
      t.next = t.next === null ? v.start : Math.min(t.next, v.start);
      t.last = t.last === null ? v.start : Math.max(t.last, v.start);
    }
  }
  return t;
}

/** Whether a plan alarm is about preparing ahead: the members that cannot
 * prepare before their window opens, or that failed to. */
export function isPrepareAlarm(alarm: string): boolean {
  return / device\(s\) (cannot prepare before|failed to prepare)/.test(alarm);
}

/** Whether any prepare is still to start, running or retrying. */
export function preparesLeft(t: PrepareTally): boolean {
  return t.scheduled + t.preparing + t.retrying > 0;
}
