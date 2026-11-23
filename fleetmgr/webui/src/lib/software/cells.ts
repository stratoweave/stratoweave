// The palette of the plan timeline's device cells, which the progress bar
// shares for the states it has in common.

import type { DeviceStatusRow } from './model';

/** What a cell shows of its device: its status, or why the campaign holds
 * it when it waits. */
export type CellKind =
  | 'upgraded'
  | 'up-to-date'
  | 'in-progress'
  | 'failed'
  | 'rolled-back'
  | 'waiting'
  | 'not-answered'
  | 'held'
  | 'down';

/** Each kind's cell fill. The design tokens go by var(), so they follow
 * app.css and must be set through CSS, not an SVG presentation attribute;
 * the rest are the cells' own. Waiting and not answered stay dim: most
 * members wait before a run, and brighter they would read as one heavy
 * block. */
export const CELL_COLOR: Record<CellKind, string> = {
  upgraded: 'var(--sw-success)',
  // Done like upgraded, but dimmer: the device was on the target release
  // already.
  'up-to-date': '#15803d',
  'in-progress': 'var(--sw-accent)',
  failed: 'var(--sw-danger)',
  // Dimmer than failed.
  'rolled-back': '#c53030',
  // A device that needs the upgrade and waits for its turn.
  waiting: '#1d2c49',
  // A device that has not said whether it needs the upgrade.
  'not-answered': '#2e3f63',
  // Held behind a member of its groups, or by the failure budget.
  held: '#b45309',
  // Held because it, or its flotilla, cannot be reached.
  down: '#64748b'
};

export const CELL_LABEL: Record<CellKind, string> = {
  upgraded: 'upgraded',
  'up-to-date': 'up to date',
  'in-progress': 'in progress',
  failed: 'failed',
  'rolled-back': 'rolled back',
  waiting: 'waiting',
  'not-answered': 'not answered',
  held: 'held',
  down: 'down'
};

/** The legend's order. */
export const CELL_KINDS = Object.keys(CELL_COLOR) as CellKind[];

/** A member's cell: down or held when the campaign holds it for that, its
 * status otherwise. A member the state does not mention yet has not
 * answered. */
export function cellKind(row: DeviceStatusRow | undefined): CellKind {
  if (row === undefined) return 'not-answered';
  if (row.held === 'down' || row.held === 'flotilla-down') return 'down';
  if (row.held !== null && row.held !== 'not-answered') return 'held';
  switch (row.status) {
    case 'succeeded':
      return 'upgraded';
    case 'up-to-date':
    case 'in-progress':
    case 'failed':
    case 'rolled-back':
      return row.status;
    // Counted as failed: an earlier attempt failed its rollback.
    case 'not-started':
      return 'failed';
    case 'upgrade-needed':
      return 'waiting';
    default:
      return 'not-answered';
  }
}

/** Gutter width for a cell size: 1 px up to 8 px cells, then an eighth. */
export function gutter(size: number): number {
  return Math.max(1, Math.round(size / 8));
}
