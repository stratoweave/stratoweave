// A campaign's members split into disjoint shares for its progress bar.

import type { CampaignCounters } from './model';

export interface Progress {
  total: number;
  /** Upgraded by this campaign. */
  upgraded: number;
  /** On the target release before the campaign upgraded them. */
  upToDate: number;
  inProgress: number;
  /** Failed or rolled back. */
  failed: number;
  /** Held while waiting, except for not having answered. */
  held: number;
  /** Held because they have not said whether they need the upgrade. */
  notAnswered: number;
  /** Need the upgrade and wait for their turn. */
  waiting: number;
}

/** The shares from the counters, which stay live between reads of the
 * rows in a large campaign, and the not-answered count of the last rows
 * read. The held counter counts the not-answered members, and can count a
 * held member that is up to date, so held is cut to what the other
 * counters leave. */
export function progressOf(c: CampaignCounters, notAnswered: number): Progress {
  const upToDate = Math.min(c.upToDate, c.succeeded);
  const heldAll = Math.min(c.held, c.remainder);
  const unanswered = Math.min(notAnswered, heldAll);
  return {
    total: c.total,
    upgraded: c.succeeded - upToDate,
    upToDate,
    inProgress: c.inProgress,
    failed: c.failed,
    held: heldAll - unanswered,
    notAnswered: unanswered,
    waiting: c.remainder - heldAll
  };
}
