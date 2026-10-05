// Colours that tell schedules apart on the calendar. A fixed order,
// checked for colour-vision separation against the card surface, and
// clear of the status colours (green, red, amber, cyan) the rest of the
// UI reserves. Colours are assigned by name order; every block also
// carries its schedule's name, so identity never rests on colour alone.

export const SCHEDULE_COLORS = ['#9085e9', '#d55181', '#3987e5'];

/** Schedules beyond the palette share this and rely on their label. */
export const SCHEDULE_COLOR_OTHER = '#6b7a99';

export function scheduleColors(names: string[]): Map<string, string> {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  return new Map(sorted.map((name, i) => [name, SCHEDULE_COLORS[i] ?? SCHEDULE_COLOR_OTHER]));
}
