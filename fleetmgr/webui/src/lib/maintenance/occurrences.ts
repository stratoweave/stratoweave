// Window occurrences of a maintenance schedule on the absolute clock, the
// way fleetmgr's planner generates them (fleetmgr/src/fleetmgr/cfs.act,
// occurrences): each rule opens at its local time of day on its listed
// weekdays, every day when none are listed, over a fixed horizon. The
// calendar cuts them into the viewer's local days.

import type { MaintenanceWindow, Schedule } from '../software/model';

/** How far ahead the planner generates occurrences. */
export const HORIZON_DAYS = 9;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DAY = 86400;

export interface Occurrence {
  schedule: string;
  rule: MaintenanceWindow;
  /** Seconds since the Unix epoch. */
  start: number;
  end: number;
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** The occurrences whose local day lies within `horizonDays` of the
 * schedule's local day of `from`, in start order. With `closedBefore`,
 * occurrences already closed at that time are left out, as the planner
 * leaves out the ones closed now. */
export function occurrences(
  schedule: Schedule,
  from: number,
  horizonDays = HORIZON_DAYS,
  closedBefore?: number
): Occurrence[] {
  const off = schedule.utcOffset * 60;
  const localFrom = from + off;
  const day0 = localFrom - mod(localFrom, DAY);
  const out: Occurrence[] = [];
  for (const rule of schedule.windows) {
    const days = rule.days.map((d) => WEEKDAYS.indexOf(d as Weekday)).filter((i) => i >= 0);
    for (let k = 0; k < horizonDays; k++) {
      const localDay = day0 + k * DAY;
      if (days.length > 0) {
        // 1970-01-01 was a Thursday; monday is day zero here.
        const weekday = mod(Math.floor(localDay / DAY) + 3, 7);
        if (!days.includes(weekday)) continue;
      }
      const start = localDay + rule.at - off;
      const end = start + rule.duration;
      if (closedBefore !== undefined && end <= closedBefore) continue;
      out.push({ schedule: schedule.name, rule, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface DayColumn {
  /** Local midnight, seconds since the Unix epoch. */
  start: number;
  end: number;
}

/** `count` calendar days of the viewer's clock, starting at the local
 * midnight before `t`. Built from Date so a daylight-saving switch keeps
 * the days on midnight. */
export function localDays(t: number, count: number): DayColumn[] {
  const first = new Date(t * 1000);
  first.setHours(0, 0, 0, 0);
  const out: DayColumn[] = [];
  for (let i = 0; i < count; i++) {
    const s = new Date(first);
    s.setDate(first.getDate() + i);
    const e = new Date(first);
    e.setDate(first.getDate() + i + 1);
    out.push({ start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) });
  }
  return out;
}

export interface Block {
  occurrence: Occurrence;
  /** The part inside the day. */
  start: number;
  end: number;
  day: number;
  /** Overlapping blocks of one day sit side by side. */
  lane: number;
  lanes: number;
}

/** Every occurrence cut at the day boundaries: one block per day it
 * touches, in start order per day. */
export function dayBlocks(occs: Occurrence[], days: DayColumn[]): Block[] {
  const out: Block[] = [];
  days.forEach((day, di) => {
    const blocks: Block[] = [];
    for (const o of occs) {
      const a = Math.max(o.start, day.start);
      const b = Math.min(o.end, day.end);
      if (b <= a) continue;
      blocks.push({ occurrence: o, start: a, end: b, day: di, lane: 0, lanes: 1 });
    }
    blocks.sort((x, y) => x.start - y.start || x.end - y.end);
    const laneEnds: number[] = [];
    for (const b of blocks) {
      let lane = laneEnds.findIndex((e) => e <= b.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(b.end);
      } else {
        laneEnds[lane] = b.end;
      }
      b.lane = lane;
    }
    for (const b of blocks) b.lanes = laneEnds.length;
    out.push(...blocks);
  });
  return out;
}

/** All schedules' occurrences over the calendar's days, from one local
 * day before the first (a schedule far east or west of the viewer opens
 * its day earlier or later) to one after the last. */
export function calendarOccurrences(schedules: Schedule[], days: DayColumn[]): Occurrence[] {
  if (days.length === 0) return [];
  const from = days[0].start - DAY;
  const horizon = days.length + 2;
  return schedules
    .flatMap((s) => occurrences(s, from, horizon))
    .filter((o) => o.end > days[0].start && o.start < days[days.length - 1].end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
