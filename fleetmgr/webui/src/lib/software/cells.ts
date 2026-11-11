// The palette of the plan timeline's device cells.

import type { KnownStatus } from './model';

// A device that waits for its turn, whether it has answered or not.
const WAITING = '#1d2c49';

// Grey is kept free for devices that were unreachable from the start, a
// status the model does not carry yet.
export const CELL_COLOR: Record<KnownStatus, string> = {
  pending: WAITING,
  unknown: WAITING,
  // Done like succeeded, which it counts into, but dimmer: the device was
  // on the target release already.
  'up-to-date': '#166534',
  'upgrade-needed': WAITING,
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
