// The schedule editor's draft: a window the way a calendar event is typed
// (starts, ends, repeat), validated into the model's time of day, duration
// and weekdays, and turned into the YANG-JSON the API takes.

import type { Campaign, Device, MaintenanceWindow, Schedule, ScheduleJson } from '#lib/software/model.ts';
import { formatDuration, formatTimeOfDay, formatUtcOffset } from '#lib/core/time.ts';
import { WEEKDAYS, type Weekday } from './occurrences';

const DAY = 86400;

/** How a window repeats. The model has weekdays only: an empty list is
 * every day, the presets are fixed lists. */
export type Repeat = 'daily' | 'weekdays' | 'weekends' | 'weekly';

export const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekends', label: 'Every weekend' },
  { value: 'weekly', label: 'Weekly' }
];

const PRESET_DAYS: Record<'weekdays' | 'weekends', Weekday[]> = {
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekends: ['sat', 'sun']
};

const DAY_NAMES: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun'
};

function sameDays(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((d) => b.includes(d));
}

/** The repeat a stored weekday list reads as. */
export function repeatOf(days: string[]): Repeat {
  if (days.length === 0) return 'daily';
  if (sameDays(days, PRESET_DAYS.weekdays)) return 'weekdays';
  if (sameDays(days, PRESET_DAYS.weekends)) return 'weekends';
  return 'weekly';
}

/** The weekday list a repeat stores. */
export function daysOfRepeat(repeat: Repeat, days: string[]): string[] {
  if (repeat === 'daily') return [];
  if (repeat === 'weekly') return WEEKDAYS.filter((d) => days.includes(d));
  return [...PRESET_DAYS[repeat]];
}

export interface WindowDraft {
  /** The model's key, also the row identity while editing. */
  id: number;
  /** The optional label as typed. */
  label: string;
  repeat: Repeat;
  /** Picked weekdays; only 'weekly' uses them, the others keep them for
   * a switch back. */
  days: string[];
  /** Local time of day, HH:MM. */
  at: string;
  /** Local time of day the window closes, HH:MM, endDay days after it
   * opens. */
  end: string;
  endDay: number;
  /** The last length that parsed: a new start keeps it, as a calendar
   * moves an event. */
  duration: number | null;
}

export interface ScheduleDraft {
  name: string;
  /** Minutes east of UTC. */
  utcOffset: number;
  windows: WindowDraft[];
}

/** A draft row for a window of the model. */
export function windowDraft(w: MaintenanceWindow): WindowDraft {
  const endAbs = w.at + w.duration;
  return {
    id: w.id,
    label: w.description,
    repeat: repeatOf(w.days),
    days: [...w.days],
    at: formatTimeOfDay(w.at),
    end: formatTimeOfDay(endAbs % DAY),
    endDay: Math.floor(endAbs / DAY),
    duration: w.duration
  };
}

export function newWindowDraft(id: number, at = 79200): WindowDraft {
  return windowDraft({ id, description: '', at, duration: 4 * 3600, days: [] });
}

/** The lowest id no window has yet. */
export function freeWindowId(windows: { id: number }[]): number {
  const used = new Set(windows.map((w) => w.id));
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

/** The viewer's current offset when the model allows it. */
function browserOffset(): number {
  const off = -new Date().getTimezoneOffset();
  return off >= OFFSET_MIN && off <= OFFSET_MAX ? off : 0;
}

export function emptyDraft(): ScheduleDraft {
  return { name: '', utcOffset: browserOffset(), windows: [newWindowDraft(1)] };
}

export function draftFromSchedule(s: Schedule): ScheduleDraft {
  return { name: s.name, utcOffset: s.utcOffset, windows: s.windows.map(windowDraft) };
}

/** "22:00", "7:30", "12:07:18" -> seconds after midnight; null when
 * unparsable. The model counts seconds, so seconds are accepted. */
export function parseTimeOfDay(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] ?? '0');
  if (h > 23 || min > 59 || sec > 59) return null;
  return h * 3600 + min * 60 + sec;
}

/** The window's length from its start and end; null when either does
 * not parse. Zero or less when it ends before it starts. */
export function draftDuration(w: Pick<WindowDraft, 'at' | 'end' | 'endDay'>): number | null {
  const at = parseTimeOfDay(w.at);
  const end = parseTimeOfDay(w.end);
  if (at === null || end === null) return null;
  return w.endDay * DAY + end - at;
}

/** A new start: the end moves along and the length stays. */
export function withStart(w: WindowDraft, text: string): WindowDraft {
  const at = parseTimeOfDay(text);
  if (at === null || w.duration === null || w.duration <= 0) return { ...w, at: text };
  const endAbs = at + w.duration;
  return { ...w, at: text, end: formatTimeOfDay(endAbs % DAY), endDay: Math.floor(endAbs / DAY) };
}

/** A new end time: an end at or before the start is on the next day,
 * unless a later day is picked. */
export function withEnd(w: WindowDraft, text: string): WindowDraft {
  const at = parseTimeOfDay(w.at);
  const end = parseTimeOfDay(text);
  let endDay = w.endDay;
  if (at !== null && end !== null && endDay <= 1) endDay = end <= at ? 1 : 0;
  return withLength({ ...w, end: text, endDay });
}

export function withEndDay(w: WindowDraft, endDay: number): WindowDraft {
  return withLength({ ...w, endDay });
}

function withLength(w: WindowDraft): WindowDraft {
  const duration = draftDuration(w);
  return duration !== null && duration > 0 ? { ...w, duration } : w;
}

export function withRepeat(w: WindowDraft, repeat: Repeat): WindowDraft {
  // Weekly starts from the days the preset had.
  const days = repeat === 'weekly' && w.repeat !== 'weekly' ? daysOfRepeat(w.repeat, w.days) : w.days;
  return { ...w, repeat, days };
}

export function withDayToggled(w: WindowDraft, day: string): WindowDraft {
  const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day];
  return { ...w, days: WEEKDAYS.filter((d) => days.includes(d)) };
}

/** A window changed on the calendar. A preset stays when the days still
 * match it, else the window turns weekly. */
export function withRule(w: WindowDraft, rule: MaintenanceWindow): WindowDraft {
  const next = windowDraft(rule);
  const repeat = w.repeat === 'weekly' && rule.days.length > 0 ? 'weekly' : next.repeat;
  return { ...next, id: w.id, label: w.label, repeat };
}

/** Options for the end's day: the same day up to a week later, more when
 * a stored window is longer. */
export function endDayOptions(endDay: number): { value: string; label: string }[] {
  const last = Math.max(6, endDay);
  const out: { value: string; label: string }[] = [];
  for (let d = 0; d <= last; d++) {
    out.push({ value: String(d), label: d === 0 ? 'same day' : d === 1 ? 'next day' : `${d} days later` });
  }
  return out;
}

// The model's range for utc-offset: UTC-12:00 to UTC+14:00.
const OFFSET_MIN = -720;
const OFFSET_MAX = 840;
// duration is a uint32.
const DURATION_MAX = 4294967295;

// The offsets in use around the world, in minutes east of UTC.
const OFFSETS = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270,
  300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 825, 840
];

/** Time zone options; a stored offset outside the usual ones is kept. */
export function utcOffsetOptions(current: number): { value: string; label: string }[] {
  const all = OFFSETS.includes(current) ? OFFSETS : [...OFFSETS, current].sort((a, b) => a - b);
  return all.map((m) => ({ value: String(m), label: `UTC${formatUtcOffset(m)}` }));
}

export interface DraftValidation {
  ok: boolean;
  /** By field: name, window.<id>.at, window.<id>.end, window.<id>.days. */
  errors: Record<string, string>;
  warnings: string[];
}

/** "Window 2 opens at the same time as window 1 on Fri." when window i
 * opens on a day at the same time as an earlier one; the planner would
 * count only the longer. '' when it does not. */
function sameStartError(windows: (MaintenanceWindow | null)[], i: number): string {
  const w = windows[i];
  if (!w) return '';
  const days = (x: MaintenanceWindow) => (x.days.length === 0 ? [...WEEKDAYS] : x.days);
  for (let j = 0; j < i; j++) {
    const o = windows[j];
    if (!o || o.at !== w.at) continue;
    const common = WEEKDAYS.filter((d) => days(w).includes(d) && days(o).includes(d));
    if (common.length === 0) continue;
    const text = daysText(common);
    const when = common.length === 7 ? 'every day' : `on ${/^Week/.test(text) ? text.toLowerCase() : text}`;
    return `Window ${i + 1} opens at the same time as window ${j + 1} ${when}.`;
  }
  return '';
}

export function validateScheduleDraft(
  draft: ScheduleDraft,
  existingNames: string[],
  isNew: boolean
): DraftValidation {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];
  // An existing name is the key: it cannot change, so it is not checked.
  const name = draft.name.trim();
  if (isNew) {
    if (!name) {
      errors['name'] = 'A name is required.';
    } else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      errors['name'] = 'Letters, digits, dots, dashes and underscores; it becomes part of a URL.';
    } else if (existingNames.includes(name)) {
      errors['name'] = `${name} already exists.`;
    }
  }
  const parsed = draft.windows.map(draftWindow);
  draft.windows.forEach((w, i) => {
    if (parseTimeOfDay(w.at) === null) {
      errors[`window.${w.id}.at`] = 'A time of day like 22:00.';
    } else {
      const clash = sameStartError(parsed, i);
      if (clash) errors[`window.${w.id}.at`] = clash;
    }
    const duration = draftDuration(w);
    if (parseTimeOfDay(w.end) === null) {
      errors[`window.${w.id}.end`] = 'A time of day like 02:00.';
    } else if (duration !== null && duration <= 0) {
      errors[`window.${w.id}.end`] = 'Ends before it starts.';
    } else if (duration !== null && duration > DURATION_MAX) {
      errors[`window.${w.id}.end`] = `At most ${formatDuration(DURATION_MAX)}.`;
    }
    if (w.repeat === 'weekly' && w.days.length === 0) {
      errors[`window.${w.id}.days`] = 'Pick at least one day.';
    }
  });
  if (draft.windows.length === 0) {
    warnings.push('Without windows the schedule offers no time: campaigns defaulting to it and devices bound to it plan nothing.');
  }
  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

/** The draft row as a window of the model; null while it does not
 * parse. */
export function draftWindow(w: WindowDraft): MaintenanceWindow | null {
  const at = parseTimeOfDay(w.at);
  const duration = draftDuration(w);
  if (at === null || duration === null || duration <= 0) return null;
  if (w.repeat === 'weekly' && w.days.length === 0) return null;
  return { id: w.id, description: w.label.trim(), at, duration, days: daysOfRepeat(w.repeat, w.days) };
}

/** The draft as a parsed schedule. Rows that do not parse are left out,
 * so a half-typed draft still previews. */
export function draftToSchedule(draft: ScheduleDraft): Schedule {
  const windows: MaintenanceWindow[] = [];
  for (const w of draft.windows) {
    const window = draftWindow(w);
    if (window !== null) windows.push(window);
  }
  windows.sort((a, b) => a.at - b.at || a.id - b.id);
  return { name: draft.name.trim(), utcOffset: draft.utcOffset, windows };
}

/** The draft as a save would store it, to tell an edited draft from the
 * one loaded: a row compares by value where it parses, as typed where it
 * does not, and the rows in any order. */
export function draftKey(draft: ScheduleDraft): string {
  const rows = draft.windows.map((w) =>
    JSON.stringify(draftWindow(w) ?? [w.id, w.label, w.at.trim(), w.end.trim(), w.endDay, w.repeat, w.days])
  );
  return JSON.stringify([draft.name.trim(), draft.utcOffset, rows.sort()]);
}

/** The draft row a rule of draftToSchedule(draft) came from. */
export function rowOfRule(draft: ScheduleDraft, rule: MaintenanceWindow): WindowDraft | undefined {
  return draft.windows.find((w) => w.id === rule.id);
}

/** The wire entry. The offset is always sent: a PUT replaces the entry,
 * and an omitted leaf would fall back to the model default. */
export function scheduleToJson(s: Schedule): ScheduleJson {
  return {
    name: s.name,
    'utc-offset': s.utcOffset,
    window: s.windows.map((w) => {
      const entry: NonNullable<ScheduleJson['window']>[number] = { id: w.id, at: w.at, duration: w.duration };
      if (w.description) entry.description = w.description;
      if (w.days.length > 0) entry.day = [...w.days];
      return entry;
    })
  };
}

/** Creation merges into the datastore root under the module wrapper: the
 * backend rejects a PATCH whose target does not exist yet. */
export function scheduleCreatePatch(s: Schedule): { 'maintenance:schedules': { schedule: ScheduleJson[] } } {
  return { 'maintenance:schedules': { schedule: [scheduleToJson(s)] } };
}

/** "Every day", "Weekdays", "Weekends", "Tue–Thu", "Mon, Wed". */
export function daysText(days: string[]): string {
  const idx = WEEKDAYS.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0 || idx.length === 7) return 'Every day';
  const repeat = repeatOf(days);
  if (repeat === 'weekdays') return 'Weekdays';
  if (repeat === 'weekends') return 'Weekends';
  // Runs of three or more days read as a range.
  const parts: string[] = [];
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    if (j - i >= 2) {
      parts.push(`${DAY_NAMES[WEEKDAYS[idx[i]]]}–${DAY_NAMES[WEEKDAYS[idx[j]]]}`);
    } else {
      for (let k = i; k <= j; k++) parts.push(DAY_NAMES[WEEKDAYS[idx[k]]]);
    }
    i = j + 1;
  }
  return parts.join(', ');
}

/** "Tue–Thu 22:00–02:00", "Fri 20:00 – Sun 08:00", "Every day
 * 22:00–06:00 +2 days". An end before the start reads as the next day;
 * a later end is spelled out. */
export function windowText(w: MaintenanceWindow): string {
  const endAbs = w.at + w.duration;
  const endDay = Math.floor(endAbs / DAY);
  const end = formatTimeOfDay(endAbs % DAY);
  const days = daysText(w.days);
  if (endDay === 0 || (endDay === 1 && endAbs % DAY < w.at)) return `${days} ${formatTimeOfDay(w.at)}–${end}`;
  if (w.days.length === 1) {
    const i = WEEKDAYS.indexOf(w.days[0] as Weekday);
    if (i >= 0) return `${days} ${formatTimeOfDay(w.at)} – ${DAY_NAMES[WEEKDAYS[(i + endDay) % 7]]} ${end}`;
  }
  return `${days} ${formatTimeOfDay(w.at)}–${end} +${endDay} day${endDay === 1 ? '' : 's'}`;
}

/** windowText after the label, if any: "weeknights: Mon–Fri 22:00–01:00". */
export function labelledWindowText(w: MaintenanceWindow): string {
  return w.description ? `${w.description}: ${windowText(w)}` : windowText(w);
}

/** One window with the schedule's zone: "weeknights: Tue–Thu 22:00–02:00
 * UTC+01:00". */
export function ruleText(w: MaintenanceWindow, utcOffset: number): string {
  return `${labelledWindowText(w)} UTC${formatUtcOffset(utcOffset)}`;
}

/** Every window of a schedule, joined with a middle dot, the zone once at
 * the end unless left out. */
export function scheduleRulesText(s: Schedule, withZone = true): string {
  if (s.windows.length === 0) return 'no windows';
  const text = s.windows.map(windowText).join(' · ');
  return withZone ? `${text} UTC${formatUtcOffset(s.utcOffset)}` : text;
}

export interface ScheduleUsage {
  /** Devices bound to the schedule on their inventory entry. */
  boundDevices: number;
  /** Campaigns naming it as their default. */
  defaultOf: string[];
}

export function scheduleUsage(name: string, devices: Device[], campaigns: Campaign[]): ScheduleUsage {
  return {
    boundDevices: devices.filter((d) => d.schedule === name).length,
    defaultOf: campaigns.filter((c) => c.defaultSchedule === name).map((c) => c.name)
  };
}

/** "The campaign a", "The campaigns a and b", "The campaigns a, b, c and
 * 2 more": the start of a sentence. */
export function campaignsText(names: string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 3), `${(names.length - 3).toLocaleString()} more`] : names;
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] ?? '');
  return `The campaign${names.length === 1 ? '' : 's'} ${list}`;
}

/** What re-plans when a schedule changes: "The campaign fleet-upgrade and
 * 300 bound devices use it, and their windows change."; '' when nothing
 * uses it. */
export function usageChangeText(usage: ScheduleUsage): string {
  const users: string[] = [];
  if (usage.defaultOf.length > 0) users.push(campaignsText(usage.defaultOf));
  const n = usage.boundDevices;
  if (n > 0) users.push(`${n.toLocaleString()} bound device${n === 1 ? '' : 's'}`);
  if (users.length === 0) return '';
  const one = usage.defaultOf.length + n === 1;
  return `${users.join(' and ')} ${one ? 'uses' : 'use'} it, and ${one ? 'its' : 'their'} windows change.`;
}
