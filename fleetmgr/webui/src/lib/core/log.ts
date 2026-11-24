// Reads a device's log from /device/<name>/log-entries, next to RESTCONF.
// The top answers for a fleet device from the device's flotilla, where the
// log file is. A page holds the newest entries, or the ones before a start
// cursor; asking with the end cursor gives the entries written since.

type Fetch = typeof fetch;

/** One line of a log file, as the json log format writes it. A line of
 * another kind has only its text, in msg. */
export interface LogEntry {
  time: string | null;
  /** The label in lower case: emerg, alert, crit, error, warn, notice,
   * info, debug, verb or trace. */
  level: string | null;
  /** The handlers the message passed, such as "cpe-001>ssh". */
  logger: string;
  /** The class of the actor that logged it. */
  actor: string;
  msg: string | null;
  data?: Record<string, unknown>;
}

export interface LogPage {
  /** Oldest first. */
  entries: LogEntry[];
  /** Asks for older entries; null when there are none. */
  start: string | null;
  /** Asks for the entries written since. */
  end: string | null;
  /** Entries since the after cursor are missing. */
  gap: boolean;
  /** The level the device logs at, such as "warning". */
  level: string;
  /** The lines of each level the answer read, also of the levels it left
   * out. */
  counts: Partial<Record<LogLevel, number>>;
}

/** The levels a log is filtered by, most severe first. error takes in the
 * emerg, alert and crit labels too, info takes in notice and debug verb. */
export const LOG_LEVELS = ['error', 'warning', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LEVEL_LABEL: Record<LogLevel, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  debug: 'Debug',
  trace: 'Trace'
};

export interface LogQuery {
  /** The levels to return; every level without it. */
  levels?: LogLevel[];
  /** Only lines that hold this, in any case. */
  q?: string;
  limit?: number;
  before?: string;
  after?: string;
}

export async function fetchDeviceLog(name: string, query: LogQuery, fetchFn: Fetch = fetch): Promise<LogPage> {
  const params = new URLSearchParams();
  const { levels, ...rest } = query;
  if (levels) params.set('level', levels.join(','));
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const response = await fetchFn(`/device/${encodeURIComponent(name)}/log-entries?${params}`, {
    headers: { accept: 'application/json' }
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(
      typeof error === 'string' ? `${error} (${response.status})` : `The log could not be read (${response.status}).`
    );
  }
  const page = body as Partial<LogPage> | null;
  return {
    entries: Array.isArray(page?.entries) ? page.entries : [],
    start: page?.start ?? null,
    end: page?.end ?? null,
    gap: page?.gap === true,
    level: page?.level ?? '',
    counts: page?.counts ?? {}
  };
}

/** Whether a device that logs at `logsAt` writes messages of `level`; true
 * while `logsAt` is not known. */
export function records(logsAt: string, level: LogLevel): boolean {
  if (logsAt === 'off') return false;
  const at = LOG_LEVELS.indexOf(logsAt as LogLevel);
  return at < 0 || LOG_LEVELS.indexOf(level) <= at;
}

export type LogTone = 'error' | 'warning' | 'info' | 'debug';

/** How severe a label looks. */
export function logTone(level: string | null): LogTone {
  switch (level) {
    case 'emerg':
    case 'alert':
    case 'crit':
    case 'error':
      return 'error';
    case 'warn':
      return 'warning';
    case 'debug':
    case 'verb':
    case 'trace':
      return 'debug';
    default:
      return 'info';
  }
}

/** An RFC 3339 time with up to nine digits of fraction -> epoch ms; NaN
 * for anything else. Date.parse takes three digits at most. */
export function logTimeMs(time: string | null): number {
  const m = time ? /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/.exec(time) : null;
  if (!m) return NaN;
  const ms = (m[2] ?? '').padEnd(3, '0').slice(0, 3);
  return Date.parse(`${m[1]}.${ms}${m[3] ?? ''}`);
}

/** A data value as one line of text. */
export function logValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** A data value to read whole: JSON, also in a string, is indented. */
export function logValueLong(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    if (!/^\s*[[{]/.test(value)) return value;
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
  }
  return JSON.stringify(parsed, null, 2);
}

/** Where a message came from, without the device: the short actor class,
 * and the handlers below the device's, such as "NetconfDriver · ssh". */
export function logSource(entry: LogEntry): string {
  const actor = entry.actor.split('.').pop() ?? '';
  const below = entry.logger.split('>').slice(1).join('>');
  return [actor, below].filter(Boolean).join(' · ');
}
