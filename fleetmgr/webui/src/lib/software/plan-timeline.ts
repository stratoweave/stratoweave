// Layout for the plan timeline: the plan's windows on a wall-clock axis,
// and inside each window one cell per device in a column at its estimated
// start. Pure functions over the parsed plan; the component draws what
// comes out.

import { CELL_COLOR, gutter } from './cells';
import type { KnownStatus, PlanWindow } from './model';

const HOUR = 3600;

/** Long idle stretches between windows collapse to a break this wide. */
export const BREAK_W = 44;
/** A gap that would draw narrower than this stays at true scale. */
const BREAK_MIN_PX = BREAK_W * 1.5;
/** A window's band stops this far before its end, so one that starts
 * right after another does not touch it. */
export const WINDOW_GAP = 6;

export const MAX_SIZE = 10;
export const MIN_SIZE = 3;

/** Where a window's band ends on the axis: its end, or for an open window
 * the last estimated finish plus a small margin. */
export function windowEnd(w: PlanWindow): number {
  if (w.end !== null) return w.end;
  let last = w.start;
  for (const d of w.devices) last = Math.max(last, d.estimatedStart + d.estimatedDuration);
  return Math.max(w.start + 60, last + Math.max(60, Math.round((last - w.start) * 0.05)));
}

export interface Segment {
  start: number;
  end: number;
  /** Pixel x of start and end. */
  x: number;
  xEnd: number;
}

export interface Break {
  from: number;
  to: number;
  x: number;
  width: number;
}

export interface Axis {
  segments: Segment[];
  breaks: Break[];
  /** Total width in px, padding included. */
  width: number;
  pxPerHour: number;
  xOf: (t: number) => number;
}

/** Merge overlapping or touching spans. `now` is always a span, so the
 * axis holds the marker even before the first window opens. */
function merge(spans: { start: number; end: number }[], now: number): { start: number; end: number }[] {
  const sorted = [{ start: now, end: now }, ...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { start: number; end: number }[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Scale (px per hour) that fits everything into `width`. Gaps count as
 * breaks first; a second pass keeps the short ones at true scale. */
export function fitScale(
  spans: { start: number; end: number }[],
  now: number,
  width: number,
  padLeft: number,
  padRight: number
): number {
  const merged = merge(spans, now);
  const hours = merged.reduce((acc, s) => acc + (s.end - s.start) / HOUR, 0);
  const gaps = merged.slice(1).map((s, i) => (s.start - merged[i].end) / HOUR);
  const room = Math.max(120, width - padLeft - padRight);
  let scale = (room - gaps.length * BREAK_W) / Math.max(hours, 1 / 60);
  for (let pass = 0; pass < 2; pass++) {
    let trueHours = hours;
    let breaks = 0;
    for (const g of gaps) {
      if (g * scale <= BREAK_MIN_PX) trueHours += g;
      else breaks++;
    }
    scale = (room - breaks * BREAK_W) / Math.max(trueHours, 1 / 60);
  }
  return Math.max(1, scale);
}

export function buildAxis(
  spans: { start: number; end: number }[],
  now: number,
  pxPerHour: number,
  padLeft: number,
  padRight: number
): Axis {
  const merged = merge(spans, now);
  const segments: Segment[] = [];
  const breaks: Break[] = [];
  let x = padLeft;
  merged.forEach((s, i) => {
    if (i > 0) {
      const prev = merged[i - 1];
      const gapPx = ((s.start - prev.end) / HOUR) * pxPerHour;
      if (gapPx <= BREAK_MIN_PX) {
        x += gapPx;
      } else {
        breaks.push({ from: prev.end, to: s.start, x, width: BREAK_W });
        x += BREAK_W;
      }
    }
    const xEnd = x + ((s.end - s.start) / HOUR) * pxPerHour;
    segments.push({ start: s.start, end: s.end, x, xEnd });
    x = xEnd;
  });
  const width = x + padRight;

  function xOf(t: number): number {
    const first = segments[0];
    if (t <= first.start) return first.x - ((first.start - t) / HOUR) * pxPerHour;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (t <= s.end) return s.x + ((t - s.start) / HOUR) * pxPerHour;
      const next = segments[i + 1];
      if (next && t < next.start) {
        return s.xEnd + ((t - s.end) / (next.start - s.end)) * (next.x - s.xEnd);
      }
    }
    const last = segments[segments.length - 1];
    return last.xEnd + ((t - last.end) / HOUR) * pxPerHour;
  }

  return { segments, breaks, width, pxPerHour, xOf };
}

export interface Placed {
  w: PlanWindow;
  end: number;
  x: number;
  xEnd: number;
  lane: number;
}

/** Windows in start order, stacked into lanes so overlapping ones sit
 * above each other; a lane's windows are at least minGap px apart. */
export function assignLanes(windows: PlanWindow[], axis: Axis, minGap: number): Placed[] {
  const laneEnds: number[] = [];
  return [...windows]
    .sort((a, b) => a.start - b.start)
    .map((w) => {
      const end = windowEnd(w);
      const x = axis.xOf(w.start);
      const xEnd = axis.xOf(end);
      let lane = laneEnds.findIndex((e) => e + minGap <= x);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(xEnd);
      } else {
        laneEnds[lane] = xEnd;
      }
      return { w, end, x, xEnd, lane };
    });
}

export interface Column {
  /** Pixel x of the column; its cells share one estimated start. */
  x: number;
  start: number;
  count: number;
}

export interface Cell {
  name: string;
  col: number;
  row: number;
}

export interface WindowCells {
  cells: Cell[];
  cols: Column[];
  /** Rows in the tallest column. */
  rows: number;
  /** Devices drawn later than their estimate because the column at their
   * start was full and they spilled into the next. */
  displaced: number;
}

/** Cells for one window: a column opens at a device's estimated start
 * and takes every later start that falls within one pitch of it, so
 * starts a cell's width apart share a column instead of overlapping. A
 * full column spills into the next, so a crowded window degrades into a
 * packed fill instead of growing without bound. */
export function layoutCells(p: Placed, axis: Axis, size: number, pitch: number, rowsCap: number): WindowCells {
  const maxX = p.xEnd - WINDOW_GAP - size;
  const devices = [...p.w.devices].sort(
    (a, b) => a.estimatedStart - b.estimatedStart || a.name.localeCompare(b.name)
  );
  const cells: Cell[] = [];
  const cols: Column[] = [];
  let rows = 0;
  let displaced = 0;
  let col: Column | null = null;
  for (const d of devices) {
    const wanted = Math.max(p.x, Math.min(maxX, Math.round(axis.xOf(d.estimatedStart))));
    if (col === null || wanted >= col.x + pitch || col.count >= rowsCap) {
      const prevX: number | null = col === null ? null : col.x;
      const x: number = prevX === null ? wanted : Math.max(wanted, prevX + pitch);
      if (x !== wanted) displaced++;
      col = { x, start: d.estimatedStart, count: 0 };
      cols.push(col);
    }
    cells.push({ name: d.name, col: cols.length - 1, row: col.count });
    col.count++;
    if (col.count > rows) rows = col.count;
  }
  return { cells, cols, rows, displaced };
}

export interface CellLayout {
  size: number;
  pitch: number;
  windows: WindowCells[];
}

/** The largest cell from MAX_SIZE down whose columns stay under maxStack
 * px; failing that, the smallest cell with spills. Columns open at a
 * device's own start, so evenly spaced rounds merge evenly at any size. */
export function chooseCells(placed: Placed[], axis: Axis, maxStack: number): CellLayout {
  let fallback: CellLayout | null = null;
  for (let size = MAX_SIZE; size >= MIN_SIZE; size--) {
    const pitch = size + gutter(size);
    const rowsCap = Math.max(1, Math.floor((maxStack + gutter(size)) / pitch));
    const windows = placed.map((p) => layoutCells(p, axis, size, pitch, rowsCap));
    const layout = { size, pitch, windows };
    if (windows.every((w) => w.displaced === 0)) return layout;
    fallback = layout;
  }
  return fallback ?? { size: MIN_SIZE, pitch: MIN_SIZE + 1, windows: [] };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/** Cells of one window as rects, vertical runs of one colour collapsed;
 * the row gutter pattern re-cuts them into cells. Cells arrive column by
 * column, rows ascending. */
export function cellRects(
  layout: WindowCells,
  statuses: Map<string, KnownStatus>,
  oy: number,
  size: number,
  pitch: number
): Rect[] {
  const out: Rect[] = [];
  let run: Rect | null = null;
  let runCol = -1;
  let runRow = -1;
  for (const c of layout.cells) {
    const fill = CELL_COLOR[statuses.get(c.name) ?? 'pending'];
    if (run && c.col === runCol && c.row === runRow + 1 && run.fill === fill) {
      run.h += pitch;
      runRow = c.row;
      continue;
    }
    run = { x: layout.cols[c.col].x, y: oy + c.row * pitch, w: size, h: size, fill };
    out.push(run);
    runCol = c.col;
    runRow = c.row;
  }
  return out;
}

/** Index of the column covering pixel x, or -1. Columns are in x order. */
export function columnAt(cols: Column[], x: number, size: number): number {
  let lo = 0;
  let hi = cols.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cols[mid];
    if (x < c.x) hi = mid - 1;
    else if (x >= c.x + size) lo = mid + 1;
    else return mid;
  }
  return -1;
}

const TICK_STEPS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800];

/** The smallest tick step that keeps ticks at least minPx apart. */
export function tickStep(pxPerHour: number, minPx = 72): number {
  for (const s of TICK_STEPS) {
    if ((s / HOUR) * pxPerHour >= minPx) return s;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/** Seconds the local clock is ahead of UTC at t. */
function localOffset(t: number): number {
  return -new Date(t * 1000).getTimezoneOffset() * 60;
}

/** Tick times: multiples of `step` on the local clock inside each
 * segment. A tick that would sit on top of the previous one is skipped. */
export function axisTicks(axis: Axis, step: number): number[] {
  const out: number[] = [];
  let lastX = -Infinity;
  for (const s of axis.segments) {
    const off = localOffset(s.start);
    for (let t = Math.ceil((s.start + off) / step) * step - off; t <= s.end; t += step) {
      const x = axis.xOf(t);
      if (x - lastX < 24) continue;
      out.push(t);
      lastX = x;
    }
  }
  return out;
}

/** Local wall clock "13:07" for a Unix time. */
export function clockLabel(unix: number): string {
  const d = new Date(unix * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/** Local day "Tue 22 Sep" for a Unix time. */
export function dayLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

const DONE = new Set<KnownStatus>(['succeeded', 'failed', 'rolled-back', 'up-to-date']);

/** Share of a window's devices that have settled, 0..1. */
export function windowDone(w: PlanWindow, statuses: Map<string, KnownStatus>): number {
  if (w.devices.length === 0) return 0;
  let done = 0;
  for (const d of w.devices) {
    if (DONE.has(statuses.get(d.name) ?? 'pending')) done++;
  }
  return done / w.devices.length;
}
