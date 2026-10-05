// The schedule editor's draft: text fields the way an operator types them
// (a time of day, a duration, a UTC offset), validated into the model's
// seconds and minutes, and turned into the YANG-JSON the API takes.

import type { Campaign, Device, MaintenanceWindow, Schedule, ScheduleJson } from '../software/model';
import { formatDuration, formatLocalTime, parseDuration } from '../software/time';
import { WEEKDAYS } from './occurrences';

export interface WindowDraft {
  /** Row identity while editing; the model's key is `at`. */
  id: number;
  /** Local time of day, HH:MM. */
  at: string;
  /** 30m, 2h30m, 1d; a bare number is seconds. */
  duration: string;
  days: string[];
}

export interface ScheduleDraft {
  name: string;
  /** ±HH:MM east of UTC. */
  utcOffset: string;
  windows: WindowDraft[];
}

let nextRowId = 1;

export function newWindowDraft(partial: Partial<WindowDraft> = {}): WindowDraft {
  return { id: nextRowId++, at: '22:00', duration: '4h', days: [], ...partial };
}

export function emptyDraft(): ScheduleDraft {
  return { name: '', utcOffset: '+00:00', windows: [newWindowDraft()] };
}

export function draftFromSchedule(s: Schedule): ScheduleDraft {
  return {
    name: s.name,
    utcOffset: formatUtcOffset(s.utcOffset),
    windows: s.windows.map((w) =>
      newWindowDraft({ at: formatTimeOfDay(w.at), duration: formatDuration(w.duration), days: [...w.days] })
    )
  };
}

/** "+01:00", "-05:00", "+1", "0", "UTC+08:00" -> minutes east of UTC;
 * null when unparsable. */
export function parseUtcOffset(text: string): number | null {
  const t = text.trim().toUpperCase().replace(/^UTC/, '').replace(/^GMT/, '');
  if (t === '' || t === 'Z') return 0;
  const m = /^([+-]?)(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const minutes = Number(m[3] ?? '0');
  if (minutes > 59) return null;
  return sign * (Number(m[2]) * 60 + minutes);
}

/** minutes -> "+01:00". */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
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

/** seconds after midnight -> "22:00", or "12:07:18" when the value does
 * not sit on a whole minute, so an edit round-trips the model's value. */
export function formatTimeOfDay(seconds: number): string {
  const hm = `${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor((seconds % 3600) / 60))}`;
  const sec = seconds % 60;
  return sec === 0 ? hm : `${hm}:${pad2(sec)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export interface DraftValidation {
  ok: boolean;
  /** By field: name, utc-offset, window.<id>.at, window.<id>.duration. */
  errors: Record<string, string>;
  warnings: string[];
}

// The model's range for utc-offset: UTC-12:00 to UTC+14:00.
const OFFSET_MIN = -720;
const OFFSET_MAX = 840;

export function validateScheduleDraft(
  draft: ScheduleDraft,
  existingNames: string[],
  isNew: boolean
): DraftValidation {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];
  const name = draft.name.trim();
  if (!name) {
    errors['name'] = 'A name is required.';
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    errors['name'] = 'Letters, digits, dots, dashes and underscores; it becomes part of a URL.';
  } else if (isNew && existingNames.includes(name)) {
    errors['name'] = `${name} already exists.`;
  }
  const offset = parseUtcOffset(draft.utcOffset);
  if (offset === null) {
    errors['utc-offset'] = 'An offset like +01:00 or -05:00.';
  } else if (offset < OFFSET_MIN || offset > OFFSET_MAX) {
    errors['utc-offset'] = 'Between -12:00 and +14:00.';
  }
  const seen = new Map<number, number>();
  for (const w of draft.windows) {
    const at = parseTimeOfDay(w.at);
    if (at === null) {
      errors[`window.${w.id}.at`] = 'A time of day like 22:00 or 22:00:30.';
    } else if (seen.has(at)) {
      errors[`window.${w.id}.at`] = `Rule ${seen.get(at)} already opens at ${w.at}; the opening time is the key.`;
    } else {
      seen.set(at, draft.windows.indexOf(w) + 1);
    }
    const duration = parseDuration(w.duration);
    if (duration === null) {
      errors[`window.${w.id}.duration`] = 'A duration like 30m, 2h30m or 1d.';
    } else if (duration <= 0) {
      errors[`window.${w.id}.duration`] = 'Longer than zero.';
    } else if (duration > 7 * 86400) {
      errors[`window.${w.id}.duration`] = 'At most a week.';
    }
  }
  if (draft.windows.length === 0) {
    warnings.push('Without windows the schedule offers no time: campaigns defaulting to it and devices bound to it plan nothing.');
  }
  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

/** The draft as a parsed schedule. Rows that do not parse are left out,
 * so a half-typed draft still previews. */
export function draftToSchedule(draft: ScheduleDraft): Schedule {
  const windows: MaintenanceWindow[] = [];
  const seen = new Set<number>();
  for (const w of draft.windows) {
    const at = parseTimeOfDay(w.at);
    const duration = parseDuration(w.duration);
    if (at === null || duration === null || duration <= 0 || seen.has(at)) continue;
    seen.add(at);
    windows.push({ at, duration, days: WEEKDAYS.filter((d) => w.days.includes(d)) });
  }
  windows.sort((a, b) => a.at - b.at);
  return { name: draft.name.trim(), utcOffset: parseUtcOffset(draft.utcOffset) ?? 0, windows };
}

/** The wire entry. The offset is always sent: a PUT replaces the entry,
 * and an omitted leaf would fall back to the model default. */
export function scheduleToJson(s: Schedule): ScheduleJson {
  return {
    name: s.name,
    'utc-offset': s.utcOffset,
    window: s.windows.map((w) => {
      const entry: { at: number; duration: number; day?: string[] } = { at: w.at, duration: w.duration };
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

/** One rule: "tue,wed,thu 22:00 (UTC+01:00) for 4h". */
export function ruleText(w: MaintenanceWindow, utcOffset: number): string {
  return `${w.days.length > 0 ? w.days.join(',') : 'daily'} ${formatLocalTime(w.at, utcOffset)} for ${formatDuration(w.duration)}`;
}

/** Every rule of a schedule, joined with a middle dot. */
export function scheduleRulesText(s: Schedule): string {
  if (s.windows.length === 0) return 'no windows';
  return s.windows.map((w) => ruleText(w, s.utcOffset)).join(' · ');
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
