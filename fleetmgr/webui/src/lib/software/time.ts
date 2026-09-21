// Schedules speak in local times of day, and the published plan and the
// deadline in absolute seconds since the Unix epoch. Durations read and
// type as 30m, 2h30m or 1d.

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** "600", "10m", "2h30m", "1d 12h" -> seconds; null when unparsable. A bare
 * number is seconds. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  let total = 0;
  let matched = '';
  for (const m of t.matchAll(/(\d+)\s*([smhd])/g)) {
    total += Number(m[1]) * UNIT_SECONDS[m[2]];
    matched += m[0];
  }
  return matched.replace(/\s+/g, '') === t.replace(/\s+/g, '') ? total : null;
}

/** seconds -> "45s", "2h30m", "1d12h". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const parts: string[] = [];
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (sec > 0) parts.push(`${sec}s`);
  return parts.join('');
}

/** Seconds after launch -> "at launch", "+2h30m". */
export function formatOffset(seconds: number): string {
  return seconds === 0 ? 'at launch' : `+${formatDuration(seconds)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Epoch seconds -> local wall clock; the date is added when it is not today. */
export function formatClock(epochSeconds: number, now = new Date()): string {
  const d = new Date(epochSeconds * 1000);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? time : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${time}`;
}

/** Local time-of-day seconds and a schedule's UTC offset -> "00:00+01:00". */
export function formatLocalTime(at: number, utcOffsetMinutes: number): string {
  const sign = utcOffsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(utcOffsetMinutes);
  const tz = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return `${pad2(Math.floor(at / 3600))}:${pad2(Math.floor((at % 3600) / 60))}${tz}`;
}
