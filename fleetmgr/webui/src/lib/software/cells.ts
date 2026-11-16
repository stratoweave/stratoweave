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

export const CELL_COLOR: Record<CellKind, string> = {
  upgraded: '#16a34a',
  // Done like upgraded, but dimmer: the device was on the target release
  // already.
  'up-to-date': '#166534',
  'in-progress': '#22d3ee',
  failed: '#ef4444',
  'rolled-back': '#991b1b',
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
  'up-to-date': 'already up to date',
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

/** The gutter between cells; also the grid background. */
export const CELL_BG = '#0f1a30';

/** Gutter width for a cell size: 1 px up to 8 px cells, then an eighth. */
export function gutter(size: number): number {
  return Math.max(1, Math.round(size / 8));
}
