// The palette of the plan timeline's device cells.

import type { KnownStatus } from './model';

// Grey is kept free for devices that were unreachable from the start, a
// status the model does not carry yet.
export const CELL_COLOR: Record<KnownStatus, string> = {
  pending: '#1d2c49',
  unknown: '#1d2c49',
  'up-to-date': '#1d2c49',
  'upgrade-needed': '#3f3080',
  'in-progress': '#22d3ee',
  succeeded: '#16a34a',
  failed: '#ef4444',
  'rolled-back': '#991b1b'
};

/** The gutter between cells; also the grid background. */
export const CELL_BG = '#0f1a30';

/** Gutter width for a cell size: 1 px up to 8 px cells, then an eighth. */
export function gutter(size: number): number {
  return Math.max(1, Math.round(size / 8));
}
