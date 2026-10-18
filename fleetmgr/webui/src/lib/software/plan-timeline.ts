// Layout for the plan timeline: the plan's windows on a wall-clock axis,
// and inside each window one cell per device in a column at its start,
// real once released, estimated before. Pure functions over the parsed
// plan; the component draws what comes out.
//
// The work splits by what it depends on, so clock ticks and status polls
// stay cheap: devices are sorted once per plan change, the geometry (axis,
// lanes, columns) is redone when the plan's times, the width or the zoom
// change, colours when statuses change, and the clock only moves the
// marker.

import { CELL_COLOR, gutter } from './cells';
import { deviceDuration, deviceStart, type KnownStatus, type PlanDevice, type PlanWindow } from './model';

const HOUR = 3600;

/** Long idle stretches between windows collapse to a break this wide. */
const BREAK_W = 44;
/** A gap that would draw narrower than this stays at true scale. */
const BREAK_MIN_PX = BREAK_W * 1.5;
/** A window's band stops this far before its end, so one that starts
 * right after another does not touch it. */
export const WINDOW_GAP = 6;

const MAX_SIZE = 14;
const MIN_SIZE = 3;

/** Where a window's band ends on the axis: its end, or for an open window
 * the last finish plus a small margin. */
export function windowEnd(w: PlanWindow): number {
  if (w.end !== null) return w.end;
  let last = w.start;
  for (const d of w.devices) last = Math.max(last, deviceStart(d) + deviceDuration(d));
  return Math.max(w.start + 60, last + Math.max(60, Math.round((last - w.start) * 0.05)));
}

function sameDevice(a: PlanDevice, b: PlanDevice): boolean {
  return (
    a.name === b.name &&
    a.estimatedStart === b.estimatedStart &&
    a.estimatedDuration === b.estimatedDuration &&
    a.started === b.started &&
    a.finished === b.finished
  );
}

/** Whether two plans hold the same devices at the same times, which is
 * all the geometry is built from. */
export function sameWindows(a: PlanWindow[], b: PlanWindow[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const wa = a[i];
    const wb = b[i];
    if (
      wa.start !== wb.start ||
      wa.end !== wb.end ||
      wa.schedule !== wb.schedule ||
      wa.devices.length !== wb.devices.length
    ) {
      return false;
    }
    for (let j = 0; j < wa.devices.length; j++) {
      if (!sameDevice(wa.devices[j], wb.devices[j])) return false;
    }
  }
  return true;
}

/** Returns the windows it is given, or the ones it returned last when
 * those are the same: every state poll parses a new plan, and only one
 * whose times changed should rebuild the geometry. */
export function holdWindows(): (windows: PlanWindow[]) => PlanWindow[] {
  let held: PlanWindow[] | null = null;
  return (windows) => {
    if (held === null || !sameWindows(held, windows)) held = windows;
    return held;
  };
}

export interface OrderedWindow {
  w: PlanWindow;
  /** windowEnd(w). */
  end: number;
  /** The devices in the order cells fill: by start, then name. */
  devices: PlanDevice[];
  /** Each device's start, in that order. */
  starts: Float64Array;
}

const byName = new Intl.Collator().compare;

/** The windows by start, each with its devices sorted once; every cell
 * size and zoom tried afterwards walks this order. */
export function orderWindows(windows: PlanWindow[]): OrderedWindow[] {
  return [...windows]
    .sort((a, b) => a.start - b.start)
    .map((w) => {
      const keyed = w.devices.map((d) => ({ d, start: deviceStart(d) }));
      keyed.sort((a, b) => a.start - b.start || byName(a.d.name, b.d.name));
      return {
        w,
        end: windowEnd(w),
        devices: keyed.map((k) => k.d),
        starts: Float64Array.from(keyed, (k) => k.start)
      };
    });
}

export interface Span {
  start: number;
  end: number;
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

/** Merge overlapping or touching spans. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** How long a stretch the axis keeps for now when no window holds it: a
 * fiftieth of the windows' time, a minute to an hour, so the marker
 * crosses about 2% of the axis before the axis moves on. */
export function anchorStep(spans: Span[]): number {
  const total = merge(spans).reduce((acc, s) => acc + s.end - s.start, 0);
  return Math.min(HOUR, Math.max(60, Math.round(total / 50)));
}

/** Where the axis's stretch for now starts: null while a window holds now,
 * else now rounded down to `step`. It changes once per step, so a clock
 * ticking inside it leaves the axis as it is. */
export function nowAnchor(spans: Span[], now: number, step: number): number | null {
  for (const s of spans) {
    if (s.start <= now && now <= s.end) return null;
  }
  return Math.floor(now / step) * step;
}

/** The spans the axis covers: the windows, and the stretch for now. */
export function axisSpans(spans: Span[], anchor: number | null, step: number): Span[] {
  return anchor === null ? spans : [...spans, { start: anchor, end: anchor + step }];
}

/** Scale (px per hour) that fits everything into `width`. Gaps count as
 * breaks first; a second pass keeps the short ones at true scale. */
export function fitScale(spans: Span[], width: number, padLeft: number, padRight: number): number {
  const merged = merge(spans);
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

export function buildAxis(spans: Span[], pxPerHour: number, padLeft: number, padRight: number): Axis {
  const merged = merge(spans);
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
  /** The window's devices in fill order, and each one's x at its start. */
  devices: PlanDevice[];
  xs: Float64Array;
  x: number;
  xEnd: number;
  lane: number;
}

/** Windows, in start order, stacked into lanes so overlapping ones sit
 * above each other; a lane's windows are at least minGap px apart. */
export function assignLanes(windows: OrderedWindow[], axis: Axis, minGap: number): Placed[] {
  const laneEnds: number[] = [];
  return windows.map((o) => {
    const x = axis.xOf(o.w.start);
    const xEnd = axis.xOf(o.end);
    let lane = laneEnds.findIndex((e) => e + minGap <= x);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(xEnd);
    } else {
      laneEnds[lane] = xEnd;
    }
    const xs = new Float64Array(o.starts.length);
    for (let i = 0; i < xs.length; i++) xs[i] = Math.round(axis.xOf(o.starts[i]));
    return { w: o.w, devices: o.devices, xs, x, xEnd, lane };
  });
}

export interface Column {
  /** Pixel x of the column. */
  x: number;
  /** The column holds devices[first] to devices[first + count - 1] of its
   * window, top to bottom. */
  first: number;
  count: number;
}

export interface WindowCells {
  /** The window's devices in fill order. */
  devices: PlanDevice[];
  cols: Column[];
  /** Rows in the tallest column. */
  rows: number;
  /** Devices drawn later than their start because the column at their
   * start was full and they spilled into the next. */
  displaced: number;
}

function rowsCap(size: number, pitch: number, maxStack: number): number {
  return Math.max(1, Math.floor((maxStack + gutter(size)) / pitch));
}

/** Cells for one window: a column opens at a device's start and takes
 * every later start that falls within one pitch of it, so starts a cell's
 * width apart share a column instead of overlapping. A full column spills
 * into the next, so a crowded window degrades into a packed fill instead
 * of growing without bound. */
function layoutCells(p: Placed, size: number, pitch: number, cap: number): WindowCells {
  const maxX = p.xEnd - WINDOW_GAP - size;
  const cols: Column[] = [];
  let rows = 0;
  let displaced = 0;
  let col: Column | null = null;
  for (let i = 0; i < p.xs.length; i++) {
    const wanted = Math.max(p.x, Math.min(maxX, p.xs[i]));
    if (col === null || wanted >= col.x + pitch || col.count >= cap) {
      const x: number = col === null ? wanted : Math.max(wanted, col.x + pitch);
      if (x !== wanted) displaced++;
      col = { x, first: i, count: 0 };
      cols.push(col);
    }
    col.count++;
    if (col.count > rows) rows = col.count;
  }
  return { devices: p.devices, cols, rows, displaced };
}

/** layoutCells' walk without building anything: whether some device
 * would be displaced at this size. */
function displaces(p: Placed, size: number, pitch: number, cap: number): boolean {
  const maxX = p.xEnd - WINDOW_GAP - size;
  let open = false;
  let colX = 0;
  let count = 0;
  for (let i = 0; i < p.xs.length; i++) {
    const wanted = Math.max(p.x, Math.min(maxX, p.xs[i]));
    if (!open || wanted >= colX + pitch || count >= cap) {
      if (open && wanted < colX + pitch) return true;
      open = true;
      colX = wanted;
      count = 0;
    }
    count++;
  }
  return false;
}

/** The largest cell from MAX_SIZE down whose columns stay under maxStack
 * px with no device displaced; failing that, the smallest cell, with
 * spills. Columns open at a device's own start, so evenly spaced rounds
 * merge evenly at any size. */
export function fitCellSize(placed: Placed[], maxStack: number): number {
  for (let size = MAX_SIZE; size >= MIN_SIZE; size--) {
    const pitch = size + gutter(size);
    const cap = rowsCap(size, pitch, maxStack);
    if (!placed.some((p) => displaces(p, size, pitch, cap))) return size;
  }
  return MIN_SIZE;
}

export interface CellLayout {
  size: number;
  pitch: number;
  windows: WindowCells[];
}

export function layoutAt(placed: Placed[], size: number, maxStack: number): CellLayout {
  const pitch = size + gutter(size);
  const cap = rowsCap(size, pitch, maxStack);
  return { size, pitch, windows: placed.map((p) => layoutCells(p, size, pitch, cap)) };
}

export interface Fit {
  axis: Axis;
  placed: Placed[];
  /** The cell size this zoom gives. */
  size: number;
}

/** Fits of the windows into `width`, one per zoom, made when first asked
 * for and kept: picking the zoom tries several, and the chosen one is
 * then laid out without trying it again. */
export function fitter(
  windows: OrderedWindow[],
  spans: Span[],
  width: number,
  padLeft: number,
  padRight: number,
  maxStack: number
): (zoom: number) => Fit {
  const scale = fitScale(spans, width, padLeft, padRight);
  const fits = new Map<number, Fit>();
  return (zoom) => {
    let fit = fits.get(zoom);
    if (fit === undefined) {
      const axis = buildAxis(spans, scale * zoom, padLeft, padRight);
      const placed = assignLanes(windows, axis, WINDOW_GAP);
      fit = { axis, placed, size: fitCellSize(placed, maxStack) };
      fits.set(zoom, fit);
    }
    return fit;
  };
}

/** The least zoom whose cells are at least `readable` px; a crowded plan
 * can stay small at every zoom, then the least zoom with the largest
 * cells, so zooming in never costs the overview for nothing. */
export function pickZoom(zooms: number[], readable: number, fit: (zoom: number) => Fit): number {
  let best = { zoom: zooms[0], size: 0 };
  for (const zoom of zooms) {
    const size = fit(zoom).size;
    if (size >= readable) return zoom;
    if (size > best.size) best = { zoom, size };
  }
  return best.zoom;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/** Cells of one window as rects, vertical runs of one colour collapsed;
 * the row gutter pattern re-cuts them into cells. */
export function cellRects(
  layout: WindowCells,
  statuses: Map<string, KnownStatus>,
  oy: number,
  size: number,
  pitch: number
): Rect[] {
  const out: Rect[] = [];
  for (const col of layout.cols) {
    let run: Rect | null = null;
    for (let row = 0; row < col.count; row++) {
      const fill = CELL_COLOR[statuses.get(layout.devices[col.first + row].name) ?? 'pending'];
      if (run !== null && run.fill === fill) {
        run.h += pitch;
        continue;
      }
      run = { x: col.x, y: oy + row * pitch, w: size, h: size, fill };
      out.push(run);
    }
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

/** The device in column `col`, row `row` of a window, if there is one. */
export function cellAt(layout: WindowCells, col: number, row: number): PlanDevice | null {
  const c = layout.cols[col];
  return c !== undefined && row >= 0 && row < c.count ? layout.devices[c.first + row] : null;
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
