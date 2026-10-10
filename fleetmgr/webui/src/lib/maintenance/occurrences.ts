// Window occurrences of a maintenance schedule on the absolute clock, the
// way fleetmgr's planner generates them (fleetmgr/src/fleetmgr/cfs.act,
// occurrences): each rule opens at its local time of day on its listed
// weekdays, every day when none are listed, over a fixed horizon. The
// calendar cuts them into the viewer's local days.

import type { MaintenanceWindow, Schedule } from '$lib/software/model';

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

/** Local seconds -> weekday index, monday zero (1970-01-01 was a
 * Thursday). */
function weekdayOf(local: number): number {
  return mod(Math.floor(local / DAY) + 3, 7);
}

/** A rule's weekdays as indexes, monday zero; unknown names are dropped. */
function dayIndexes(days: string[]): number[] {
  return days.map((d) => WEEKDAYS.indexOf(d as Weekday)).filter((i) => i >= 0);
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
    const days = dayIndexes(rule.days);
    for (let k = 0; k < horizonDays; k++) {
      const localDay = day0 + k * DAY;
      if (days.length > 0 && !days.includes(weekdayOf(localDay))) continue;
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

// Editing on the calendar: a rule moves and resizes in steps of a quarter
// hour, on the absolute clock (every UTC offset is a whole number of
// quarter hours, so the grid is the same in any zone).

export const SNAP_S = 900;

export function snapTime(t: number): number {
  return Math.round(t / SNAP_S) * SNAP_S;
}

function daysFromIndexes(indexes: Iterable<number>): Weekday[] {
  const set = new Set(indexes);
  return WEEKDAYS.filter((_, i) => set.has(i));
}

/** The rule after its occurrence opening at `occStart` moved by `shift`
 * seconds and `dayMove` days. Every weekday of a rule shares the opening
 * time, so a shift past midnight moves them all; the day move applies to
 * the dragged weekday only, and only onto a weekday the rule does not
 * have yet. A daily rule stays daily. */
export function moveRule(
  rule: MaintenanceWindow,
  utcOffset: number,
  occStart: number,
  shift: number,
  dayMove: number
): MaintenanceWindow {
  const raw = rule.at + shift;
  const carry = Math.floor(raw / DAY);
  const at = mod(raw, DAY);
  if (rule.days.length === 0) return { at, duration: rule.duration, days: [] };
  const dragged = weekdayOf(occStart + utcOffset * 60);
  const others = dayIndexes(rule.days)
    .filter((i) => i !== dragged)
    .map((i) => mod(i + carry, 7));
  let moved = mod(dragged + carry + dayMove, 7);
  if (others.includes(moved)) moved = mod(dragged + carry, 7);
  return { at, duration: rule.duration, days: daysFromIndexes([...others, moved]) };
}

/** The rule after one edge of its occurrence opening at `occStart` moved
 * to `to`: the opening edge keeps the closing time, the closing edge keeps
 * the opening time, and the window stays at least a quarter hour long. */
export function resizeRule(
  rule: MaintenanceWindow,
  utcOffset: number,
  occStart: number,
  edge: 'start' | 'end',
  to: number
): MaintenanceWindow {
  const occEnd = occStart + rule.duration;
  if (edge === 'end') {
    return { at: rule.at, duration: Math.max(SNAP_S, to - occStart), days: [...rule.days] };
  }
  const start = Math.min(to, occEnd - SNAP_S);
  return { ...moveRule(rule, utcOffset, occStart, start - occStart, 0), duration: occEnd - start };
}

/** A rule on one weekday for a span dragged out on the calendar. */
export function ruleForSpan(start: number, end: number, utcOffset: number): MaintenanceWindow {
  const local = start + utcOffset * 60;
  return { at: mod(local, DAY), duration: end - start, days: [WEEKDAYS[weekdayOf(local)]] };
}
