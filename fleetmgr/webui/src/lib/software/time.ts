// The model counts window offsets, deadlines and the published plan's
// estimates in seconds after launch. Operators type and read offsets as
// 30m, 2h30m or 1d.

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
