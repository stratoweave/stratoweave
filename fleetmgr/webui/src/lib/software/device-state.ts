// What keeps a campaign member waiting, and whether a device can be
// reached, in words.

import type { Connection, DeviceStatusRow, HeldReason, StatusTone } from './model';

/** What the group member that holds a member is: why it holds the others. */
export const HOLDER_STATE: Partial<Record<HeldReason, string>> = {
  'group-failed': 'failed',
  'group-down': 'down',
  'group-not-answered': 'not answered',
  'group-vetoed': 'vetoed'
};

/** The group member that holds the member; '' when no member does. */
export function holderOf(row: DeviceStatusRow): string {
  return row.held !== null && row.held in HOLDER_STATE ? row.heldBy : '';
}

/** One line on why the campaign holds the member; '' when it does not. */
export function heldText(row: DeviceStatusRow): string {
  if (row.held === null) return '';
  const holder = HOLDER_STATE[row.held];
  if (holder !== undefined) {
    return row.heldBy ? `behind ${row.heldBy} (${holder})` : `behind a group member (${holder})`;
  }
  switch (row.held) {
    case 'down':
      return 'device down';
    case 'flotilla-down':
      return `${row.heldBy || 'its flotilla'} down`;
    case 'not-answered':
      return 'not answered yet';
    case 'vetoed':
      // held-by names the veto's holder, not a device.
      return row.heldBy ? `vetoed by ${row.heldBy}` : 'vetoed by another holder';
    default:
      return 'failure budget reached';
  }
}

/** The held reasons as the filters group them: the four that wait behind
 * a group member are one. */
export type HeldKind = 'down' | 'flotilla-down' | 'not-answered' | 'vetoed' | 'group' | 'failure-budget';

export const HELD_KINDS: HeldKind[] = ['down', 'flotilla-down', 'not-answered', 'vetoed', 'group', 'failure-budget'];

export const HELD_KIND_LABEL: Record<HeldKind, string> = {
  down: 'device down',
  'flotilla-down': 'flotilla down',
  'not-answered': 'not answered',
  vetoed: 'vetoed',
  group: 'behind a group member',
  'failure-budget': 'failure budget'
};

export function heldKind(reason: HeldReason): HeldKind {
  return reason === 'group-failed' ||
    reason === 'group-down' ||
    reason === 'group-not-answered' ||
    reason === 'group-vetoed'
    ? 'group'
    : reason;
}

export interface HeldCounts {
  byKind: Map<HeldKind, number>;
  /** The flotillas that hold members because they are down, by name. */
  flotillas: string[];
}

export function heldCounts(rows: DeviceStatusRow[]): HeldCounts {
  const byKind = new Map<HeldKind, number>();
  const flotillas = new Set<string>();
  for (const row of rows) {
    if (row.held === null) continue;
    const kind = heldKind(row.held);
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    if (row.held === 'flotilla-down' && row.heldBy) flotillas.add(row.heldBy);
  }
  return { byKind, flotillas: [...flotillas].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
}

/** Why a pending member has not answered: its device has no status for
 * the member's attempt yet, which names the attempt once there was one
 * before it. */
export function pendingText(row: DeviceStatusRow): string {
  return row.attempt > 0 ? `not answered attempt ${row.attempt} yet` : 'not answered yet';
}

type ConnectionState = Connection | 'never';

export const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connected: 'connected',
  'device-down': 'device not connected',
  'flotilla-down': 'its flotilla is down',
  never: 'has not connected since fleetmgr started'
};

export const CONNECTION_TONE: Record<ConnectionState, StatusTone> = {
  connected: 'success',
  'device-down': 'danger',
  'flotilla-down': 'warning',
  never: 'muted'
};

export function connectionState(connection: Connection | null): ConnectionState {
  return connection ?? 'never';
}
