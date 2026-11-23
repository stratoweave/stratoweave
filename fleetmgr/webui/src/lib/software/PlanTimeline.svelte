<script lang="ts">
  import { tick } from 'svelte';
  import {
    CELL_COLOR,
    CELL_KINDS,
    CELL_LABEL,
    READY_COLOR,
    READY_KINDS,
    READY_LABEL,
    cellKind,
    readyKind,
    type CellKind,
    type ReadyKind
  } from '#lib/software/cells.ts';
  import { heldText } from '#lib/software/device-state.ts';
  import {
    STATUS_LABEL,
    deviceDuration,
    deviceStart,
    type CampaignPlan,
    type DeviceStatusRow,
    type PlanDevice,
    type PlanWindow
  } from '#lib/software/model.ts';
  import {
    WINDOW_GAP,
    anchorStep,
    axisSpans,
    axisTicks,
    cellAt,
    cellPaths,
    columnAt,
    fitter,
    holdWindows,
    layoutAt,
    nowAnchor,
    opensAtLaunch,
    orderWindows,
    pickZoom,
    tickStep,
    windowDone,
    type Placed,
    type WindowCells
  } from '#lib/software/plan-timeline.ts';
  import type { PrepareView } from '#lib/software/prepare.ts';
  import { clockLabel, dayLabel, formatClockSeconds, formatDuration, sameLocalDay } from '#lib/core/time.ts';

  interface Props {
    plan: CampaignPlan;
    /** Each member's row, by device name. */
    rows: Map<string, DeviceStatusRow>;
    /** Each member that prepares ahead, by name; see prepare.ts. A waiting
     * member's cell then shows whether its image is ready. */
    prepare?: Map<string, PrepareView>;
    /** Unix seconds, ticking. */
    now: number;
    /** Open at the zoom that fits the whole plan, and do not follow now:
     * for a campaign in plan mode, where nothing runs. */
    fitPlan?: boolean;
    /** Keeps the zoom the viewer picks under this key, such as the
     * campaign's name. */
    zoomKey?: string;
    ondevice?: (name: string) => void;
  }

  let { plan, rows, prepare = new Map(), now, fitPlan = false, zoomKey, ondevice }: Props = $props();

  // The plan on a wall-clock axis. Each window is a band as wide as its
  // duration with one cell per device below it, in a column at its
  // start; devices released together stack in one column.
  // Windows that overlap sit in lanes above each other, idle stretches
  // between windows collapse to a break, and a marker shows now.
  // A waiting member that prepares ahead shows how far its prepare is, and
  // a window that has not opened says how many of its members are ready.
  const PAD_L = 30;
  const PAD_R = 30;
  // Axis rows: the marker's clock, the day, the time of day, then the line.
  const AXIS_H = 64;
  const AXIS_Y = 58;
  const MARK_Y = 13;
  const DAY_Y = 30;
  const TIME_Y = 44;
  const HEAD_H = 22;
  const LANE_GAP = 12;
  const MAX_STACK = 200;
  const FALLBACK_WIDTH = 960;
  const ZOOMS = [1, 2, 4, 8];
  /** The smallest cell a run opens with when a zoom can give it. */
  const READABLE_SIZE = 8;
  /** The same for a plan, which is read whole rather than cell by cell. */
  const FIT_SIZE = 4;
  /** Where the zoom the viewer picked is kept, under zoomKey. */
  const ZOOM_STORE = 'fleetmgr.timeline.zoom.';
  /** A character of the 11px axis labels and the 12px band labels, with
   * room for the wider fallback monospace fonts. */
  const AXIS_CHAR_W = 6.8;
  const BAND_CHAR_W = 7.4;
  /** Space between two day labels, so they do not read as one. */
  const DAY_GAP = 16;

  /** What a cell shows: its kind, or for a waiting member, its prepare. */
  type Fill = CellKind | ReadyKind;
  const FILL_COLOR: Record<Fill, string> = { ...CELL_COLOR, ...READY_COLOR };
  const FILL_LABEL: Record<Fill, string> = { ...CELL_LABEL, ...READY_LABEL };
  const FILLS: Fill[] = [...CELL_KINDS, ...READY_KINDS];

  interface Block {
    p: Placed;
    cells: WindowCells;
    y: number;
    gy: number;
    gridW: number;
    gridH: number;
    bandW: number;
  }

  let scroller = $state<HTMLDivElement | null>(null);
  let width = $state(0);
  let scrollX = $state(0);
  // The zoom the viewer picked, kept per zoomKey. Until one is picked, the
  // timeline opens at the least zoom whose cells are readable. A plan takes
  // smaller ones, so it opens fitted whole at 1×, unless that would shrink
  // them to a few pixels, as on a phone.
  let zoomChoice = $derived(storedZoom(zoomKey));
  // A run follows now; in a plan nothing runs to follow.
  let follow = $derived(!fitPlan);
  let lastSet = -1;

  // Geometry: rebuilt when the plan's times, the width or the zoom change.
  // The clock reaches it only through the anchor, which moves once per step
  // and only while no window holds now.
  const hold = holdWindows();
  let windows = $derived(hold(plan.windows));
  let ordered = $derived(orderWindows(windows));
  let spans = $derived(ordered.map((o) => ({ start: o.start, end: o.end })));
  let step = $derived(anchorStep(spans));
  let anchor = $derived(nowAnchor(spans, now, step));
  let fit = $derived(
    fitter(ordered, axisSpans(spans, anchor, step), width > 0 ? width : FALLBACK_WIDTH, PAD_L, PAD_R, MAX_STACK)
  );
  let autoZoom = $derived(width === 0 ? 1 : pickZoom(ZOOMS, fitPlan ? FIT_SIZE : READABLE_SIZE, fit));
  let zoom = $derived(zoomChoice ?? autoZoom);
  let axis = $derived(fit(zoom).axis);
  let placed = $derived(fit(zoom).placed);
  let cells = $derived(layoutAt(placed, fit(zoom).size, MAX_STACK));

  let lanes = $derived.by(() => {
    const count = Math.max(1, ...placed.map((p) => p.lane + 1));
    const grid = Array<number>(count).fill(0);
    placed.forEach((p, i) => {
      const c = cells.windows[i];
      if (c.rows > 0) grid[p.lane] = Math.max(grid[p.lane], (c.rows - 1) * cells.pitch + cells.size);
    });
    const tops: number[] = [];
    let y = AXIS_H;
    for (let k = 0; k < count; k++) {
      tops.push(y);
      y += HEAD_H + grid[k] + LANE_GAP;
    }
    return { tops, height: y - LANE_GAP + 4 };
  });

  let blocks = $derived(
    placed.map((p, i): Block => {
      const c = cells.windows[i];
      const y = lanes.tops[p.lane];
      return {
        p,
        cells: c,
        y,
        gy: y + HEAD_H,
        gridW: c.cols.length > 0 ? c.cols[c.cols.length - 1].x + cells.size - p.x : 0,
        gridH: c.rows > 0 ? (c.rows - 1) * cells.pitch + cells.size : 0,
        bandW: Math.max(2, p.xEnd - p.x - WINDOW_GAP)
      };
    })
  );

  let ticks = $derived(axisTicks(axis, tickStep(axis.pxPerHour)));

  // Day labels: at the first tick and wherever the day changes, centred on
  // the tick but kept inside the chart. One that would run into the next
  // day's moves left of it, or goes when there is no room.
  let days = $derived.by(() => {
    const out: { text: string; x: number; w: number }[] = [];
    ticks.forEach((t, i) => {
      if (i > 0 && sameLocalDay(ticks[i - 1], t)) return;
      const text = dayLabel(t);
      const w = text.length * AXIS_CHAR_W;
      const x = Math.max(2, Math.min(axis.width - 2 - w, axis.xOf(t) - w / 2));
      const prev = out[out.length - 1];
      if (prev !== undefined && prev.x + prev.w + DAY_GAP > x) {
        if (x - DAY_GAP - prev.w >= 2) prev.x = x - DAY_GAP - prev.w;
        else out.pop();
      }
      out.push({ text, x, w });
    });
    return out;
  });

  // Statuses: the cells, each window's done share and the legend of the
  // kinds that show.
  function fillOf(name: string): Fill {
    const kind = cellKind(rows.get(name));
    const ready = kind === 'waiting' ? readyKind(prepare.get(name)) : null;
    return ready ?? kind;
  }

  let paths = $derived(cellPaths(blocks, fillOf, cells.size, cells.pitch));
  let done = $derived(placed.map((p) => windowDone(p.w, rows)));
  let legend = $derived.by((): Fill[] => {
    const shown = new Set<Fill>();
    for (const w of windows) for (const d of w.devices) shown.add(fillOf(d.name));
    return FILLS.filter((k) => shown.has(k));
  });

  // Each window's members that prepare ahead and wait for its run, and how
  // many of them have their image prepared.
  let readiness = $derived(
    placed.map((p) => {
      let due = 0;
      let got = 0;
      for (const d of p.w.devices) {
        const state = prepare.get(d.name)?.state;
        if (state === undefined || state === 'released') continue;
        due++;
        if (state === 'prepared') got++;
      }
      return { due, got };
    })
  );

  // The clock: the marker and which windows are open.
  let markerX = $derived(Math.min(axis.width - PAD_R, Math.max(PAD_L, axis.xOf(now))));
  let markerLabelLeft = $derived(markerX > axis.width - 90);

  function isOpen(w: PlanWindow): boolean {
    return now >= w.start && (w.end === null || now < w.end);
  }

  $effect(() => {
    if (!follow || !scroller) return;
    const view = scroller.clientWidth;
    if (axis.width <= view) return;
    const target = Math.max(0, Math.min(axis.width - view, Math.round(markerX - view * 0.4)));
    scroller.scrollLeft = target;
    lastSet = scroller.scrollLeft;
  });

  function onScroll(): void {
    if (!scroller) return;
    scrollX = scroller.scrollLeft;
    if (Math.abs(scroller.scrollLeft - lastSet) > 1) follow = false;
  }

  function storedZoom(key: string | undefined): number | null {
    if (key === undefined) return null;
    try {
      const z = Number(localStorage.getItem(ZOOM_STORE + key));
      return ZOOMS.includes(z) ? z : null;
    } catch {
      return null;
    }
  }

  /** Zooms to z and keeps it for zoomKey. A run then follows now; a plan
   * keeps what is in the middle of the view there. */
  async function setZoom(z: number): Promise<void> {
    if (zoomKey !== undefined) {
      try {
        localStorage.setItem(ZOOM_STORE + zoomKey, String(z));
      } catch {
        // Without storage the zoom lasts while the page is open.
      }
    }
    if (!fitPlan) follow = true;
    const mid = scroller !== null && !follow ? (scroller.scrollLeft + scroller.clientWidth / 2) / axis.width : null;
    zoomChoice = z;
    if (mid === null) return;
    await tick();
    if (scroller === null) return;
    scroller.scrollLeft = mid * axis.width - scroller.clientWidth / 2;
    lastSet = scroller.scrollLeft;
  }

  // Where the view starts: the last scroll, clamped to an axis that a zoom
  // may have just shrunk.
  let viewX = $derived(Math.max(0, Math.min(scrollX, axis.width - width)));

  // Windows outside the scrolled view: the nearest one on each side gets a
  // marker above that edge of the chart, which scrolls it into view. Their
  // row shows while the chart is wider than the view; over the chart they
  // would hide a band's label or the clock.
  let overflows = $derived(width > 0 && axis.width > width);
  let edges = $derived.by(() => {
    let left: Block | null = null;
    let right: Block | null = null;
    if (!overflows) return { left, right };
    for (const b of blocks) {
      const end = b.p.x + b.bandW;
      if (end <= viewX && (left === null || end > left.p.x + left.bandW)) left = b;
      if (b.p.x >= viewX + width && (right === null || b.p.x < right.p.x)) right = b;
    }
    return { left, right };
  });

  /** Scrolls a window's band to the middle of the view, or its start to the
   * left edge when it is wider than the view. */
  function reveal(b: Block): void {
    if (scroller === null) return;
    const view = scroller.clientWidth;
    const left = b.bandW + PAD_L + PAD_R <= view ? b.p.x + b.bandW / 2 - view / 2 : b.p.x - PAD_L;
    follow = false;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ left, behavior: still ? 'auto' : 'smooth' });
    // The marker goes once its window shows; focus stays on the timeline.
    scroller.focus({ preventScroll: true });
  }

  function windowName(w: PlanWindow): string {
    return w.schedule || 'window';
  }

  function devices(n: number): string {
    return `${n.toLocaleString()} device${n === 1 ? '' : 's'}`;
  }

  /** Where a band's label starts: at the band, or at the view's left edge
   * while the band starts left of it. */
  function labelX(b: Block): number {
    return Math.max(b.p.x, Math.min(viewX, b.p.x + b.bandW));
  }

  /** The label parts that fit the band from x on: first to go is the
   * range, then the progress, then the count. Before a window opens with
   * members that prepare ahead, how many are ready takes the count's
   * place. */
  function label(b: Block, share: number, ready: { due: number; got: number }, x: number): string {
    const w = b.p.w;
    const name = windowName(w);
    const range = opensAtLaunch(w)
      ? w.end === null
        ? 'always open'
        : `until ${clockLabel(w.end)}`
      : `${clockLabel(w.start)} → ${w.end === null ? 'open' : clockLabel(w.end)}`;
    const count = devices(w.devices.length);
    const pct = now >= w.start ? `${Math.round(share * 100)}%` : null;
    const readyText = `${ready.got.toLocaleString()} of ${ready.due.toLocaleString()} ready`;
    const options =
      ready.due > 0 && now < w.start
        ? [[name, range, readyText], [name, readyText], [`${ready.got}/${ready.due} ready`], [name]]
        : [[name, range, count, pct], [name, count, pct], [name, count], [name]];
    for (const parts of options) {
      const text = parts.filter((p) => p !== null).join(' · ');
      if (text.length * BAND_CHAR_W + 12 <= b.p.x + b.bandW - x) return text;
    }
    return '';
  }

  type Hit = { kind: 'device'; name: string } | { kind: 'window'; w: PlanWindow } | null;

  // The line under the chart shows what the pointer is on, else the last
  // thing tapped: touch has no hover to show it with.
  let hover = $state<Hit>(null);
  let pinned = $state<Hit>(null);
  let shown = $derived(hover ?? pinned);
  let pointer = 'mouse';

  function hitAt(event: MouseEvent): Hit {
    const svg = event.currentTarget as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    for (const b of blocks) {
      if (px < b.p.x) continue;
      if (py >= b.y && py < b.y + HEAD_H && px < b.p.x + b.bandW) return { kind: 'window', w: b.p.w };
      if (py >= b.gy && py < b.gy + b.gridH && px < b.p.x + b.gridW) {
        const col = columnAt(b.cells.cols, px, cells.size);
        const d = col < 0 ? null : cellAt(b.cells, col, Math.floor((py - b.gy) / cells.pitch));
        if (d !== null) return { kind: 'device', name: d.name };
      }
    }
    return null;
  }

  function sameHit(a: Hit, b: Hit): boolean {
    if (a === null || b === null) return a === b;
    if (a.kind === 'device') return b.kind === 'device' && a.name === b.name;
    return b.kind === 'window' && a.w === b.w;
  }

  /** A device's cell in the current layout. */
  function locate(name: string): { d: PlanDevice; x: number; y: number } | null {
    for (const b of blocks) {
      for (const col of b.cells.cols) {
        for (let row = 0; row < col.count; row++) {
          const d = b.cells.devices[col.first + row];
          if (d.name === name) return { d, x: col.x, y: b.gy + row * cells.pitch };
        }
      }
    }
    return null;
  }

  let spot = $derived(shown?.kind === 'device' ? locate(shown.name) : null);

  /** A time as the axis reads it: the clock, and the day unless today. */
  function when(t: number): string {
    return sameLocalDay(t, now) ? clockLabel(t) : `${dayLabel(t)} ${clockLabel(t)}`;
  }

  /** Where a device's prepare ahead is, while its window run has not
   * started; '' otherwise. */
  function prepareText(v: PrepareView | undefined): string {
    if (v === undefined) return '';
    switch (v.state) {
      case 'scheduled':
        return v.start > now ? `prepares ${when(v.start)}` : `may prepare since ${when(v.start)}`;
      case 'preparing':
        return v.progress === null ? `preparing since ${when(v.start)}` : `preparing, ${v.progress}%`;
      case 'prepared':
        return 'image prepared';
      case 'failed':
        return `prepare failed${v.message ? `: ${v.message}` : ''}, copies its image in its window`;
      default:
        return '';
    }
  }

  let info = $derived.by((): { name: string; text: string; kind: Fill | null } | null => {
    if (shown?.kind === 'window') {
      const w = shown.w;
      const opens = opensAtLaunch(w) ? 'opens at launch' : `opens ${when(w.start)}`;
      const closes = w.end === null ? 'never closes' : `closes ${when(w.end)}`;
      return { name: windowName(w), text: `${opens}, ${closes} · ${devices(w.devices.length)}`, kind: null };
    }
    if (spot === null) return null;
    const d = spot.d;
    const row = rows.get(d.name);
    const held = row === undefined ? '' : heldText(row);
    const parts = [
      STATUS_LABEL[row?.status ?? 'pending'],
      held ? `held: ${held}` : '',
      prepareText(prepare.get(d.name)),
      `${d.started === null ? 'starts' : 'started'} ${when(deviceStart(d))}`,
      `${d.finished === null ? '~' : 'took '}${formatDuration(deviceDuration(d))}`
    ];
    return { name: d.name, text: parts.filter((p) => p !== '').join(' · '), kind: fillOf(d.name) };
  });

  function onMove(event: PointerEvent): void {
    // Touch has no hover; a tap shows what it hit instead.
    if (event.pointerType === 'touch') return;
    const hit = hitAt(event);
    (event.currentTarget as SVGSVGElement).style.cursor = hit?.kind === 'device' ? 'pointer' : 'default';
    if (!sameHit(hit, hover)) hover = hit;
  }

  function onClick(event: MouseEvent): void {
    const hit = hitAt(event);
    if (pointer !== 'touch') {
      if (hit?.kind === 'device') ondevice?.(hit.name);
      return;
    }
    // A tap keeps what it hit under the chart; a second tap on a device
    // opens it.
    if (hit?.kind === 'device' && pinned?.kind === 'device' && pinned.name === hit.name) ondevice?.(hit.name);
    else pinned = hit;
  }
</script>

{#snippet swatch(kind: Fill)}
  <span class="swatch" style:background={FILL_COLOR[kind]}></span>
{/snippet}

{#snippet edge(b: Block, side: 'left' | 'right')}
  {@const w = b.p.w}
  <button
    class="edge {side}"
    type="button"
    aria-label={`Scroll to ${windowName(w)}: ${devices(w.devices.length)}`}
    onclick={() => reveal(b)}
  >
    {side === 'left' ? '‹ ' : ''}{windowName(w)} · {w.devices.length.toLocaleString()}{side === 'right' ? ' ›' : ''}
  </button>
{/snippet}

<div class="bar">
  <div class="key">
    <ul class="legend" aria-label="Cell colours">
      {#each legend as kind (kind)}
        <li>{@render swatch(kind)}{FILL_LABEL[kind]}</li>
      {/each}
    </ul>
  </div>
  <div class="chips">
    {#if zoom > 1}
      <button class="chip" class:active={follow} type="button" onclick={() => (follow = !follow)}>
        {follow ? 'Following now' : 'Follow now'}
      </button>
    {/if}
    {#each ZOOMS as z (z)}
      <button class="chip" class:active={zoom === z} type="button" aria-pressed={zoom === z} onclick={() => setZoom(z)}>
        {z}×
      </button>
    {/each}
  </div>
</div>

{#if overflows}
  <div class="edges">
    {#if edges.left !== null}
      {@render edge(edges.left, 'left')}
    {/if}
    {#if edges.right !== null}
      {@render edge(edges.right, 'right')}
    {/if}
  </div>
{/if}

<!-- Focusable, so Safari scrolls it by keyboard too. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="scroller"
  tabindex="0"
  role="region"
  aria-label="Plan timeline"
  bind:this={scroller}
  bind:clientWidth={width}
  onscroll={onScroll}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    width={axis.width}
    height={lanes.height}
    viewBox={`0 0 ${axis.width} ${lanes.height}`}
    shape-rendering="crispEdges"
    role="img"
    aria-label="The plan's windows over time, one cell per device at its start"
    onclick={onClick}
    onpointerdown={(event) => (pointer = event.pointerType)}
    onpointermove={onMove}
    onpointerleave={() => (hover = null)}
  >
    <line class="axis" x1={PAD_L} x2={axis.width - PAD_R} y1={AXIS_Y} y2={AXIS_Y} />
    {#each ticks as t (t)}
      {@const x = axis.xOf(t)}
      <line class="tick" x1={x} x2={x} y1={AXIS_Y - 5} y2={lanes.height} />
      <text class="lbl mid" x={x} y={TIME_Y}>{clockLabel(t)}</text>
    {/each}
    {#each days as d (d.text)}
      <text class="lbl day" x={d.x} y={DAY_Y}>{d.text}</text>
    {/each}
    {#each axis.breaks as b (b.from)}
      {@const mid = b.x + b.width / 2}
      <rect class="cover" x={b.x} y={AXIS_Y - 8} width={b.width} height="16" />
      <line class="zig" x1={mid - 5} x2={mid + 1} y1={AXIS_Y + 6} y2={AXIS_Y - 6} />
      <line class="zig" x1={mid - 1} x2={mid + 5} y1={AXIS_Y + 6} y2={AXIS_Y - 6} />
      <text class="lbl mid day" x={mid} y={AXIS_Y + 18}>{formatDuration(Math.round((b.to - b.from) / 60) * 60)}</text>
    {/each}

    {#each blocks as b, i (i)}
      <rect class="head" x={b.p.x} y={b.y} width={b.bandW} height={HEAD_H - 4} />
      {#if done[i] > 0}
        <rect class="done" x={b.p.x} y={b.y} width={b.bandW * done[i]} height={HEAD_H - 4} />
      {/if}
      {#if isOpen(b.p.w)}
        <rect class="open" x={b.p.x} y={b.y} width={b.bandW} height={HEAD_H - 4} />
      {/if}
      {@const lx = labelX(b)}
      <text class="blk" x={lx + 6} y={b.y + 13}>{label(b, done[i], readiness[i], lx)}</text>
    {/each}

    {#each FILLS as kind (kind)}
      {#if paths[kind] !== undefined}
        <path d={paths[kind]} style:fill={FILL_COLOR[kind]} />
      {/if}
    {/each}
    {#if spot !== null}
      <rect class="ring" x={spot.x - 1.5} y={spot.y - 1.5} width={cells.size + 3} height={cells.size + 3} />
    {/if}

    <line class="now-line" x1={markerX} x2={markerX} y1={MARK_Y - 8} y2={lanes.height} />
    <text class="now" class:left={markerLabelLeft} x={markerLabelLeft ? markerX - 4 : markerX + 4} y={MARK_Y}>
      {formatClockSeconds(now)}
    </text>
  </svg>
</div>

<p class="inspect">
  {#if info !== null}
    {#if info.kind !== null}{@render swatch(info.kind)}{/if}
    {#if info.kind !== null && pinned?.kind === 'device' && hover === null}
      <button class="name open-device" type="button" onclick={() => ondevice?.(info.name)}>{info.name}</button>:
    {:else}
      <span class="name">{info.name}</span>:
    {/if}
    {info.text}
  {/if}
</p>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .key {
    display: flex;
    align-items: center;
    gap: 6px 14px;
    flex-wrap: wrap;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .swatch {
    display: inline-block;
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }

  .chips {
    display: flex;
    gap: 6px;
  }

  .scroller {
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  .edges {
    display: flex;
    min-height: 24px;
    /* Clears the scroller's focus outline. */
    margin-bottom: 6px;
  }

  /* A window outside the scrolled view, named at the edge it is past. */
  .edge {
    min-height: 24px;
    padding: 0 8px;
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-pill);
    background: var(--sw-bg-elevated);
    color: var(--sw-text-secondary);
    font-family: var(--sw-font-mono);
    font-variant-ligatures: none;
    font-size: var(--sw-text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
  }

  .edge.right {
    margin-left: auto;
  }

  .edge:hover {
    color: var(--sw-text-primary);
    border-color: var(--sw-accent-glow-strong);
  }

  svg {
    display: block;
  }

  .axis,
  .tick {
    stroke: var(--sw-border-default);
  }

  .zig {
    stroke: var(--sw-text-muted);
  }

  .cover {
    fill: var(--sw-bg-card);
  }

  .lbl {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    font-variant-ligatures: none;
    font-size: var(--sw-text-2xs);
    fill: var(--sw-text-secondary);
  }

  .lbl.day {
    font-size: var(--sw-text-2xs);
    fill: var(--sw-text-muted);
  }

  .mid {
    text-anchor: middle;
  }

  .head {
    fill: var(--sw-bg-elevated);
  }

  /* Darker than the upgraded cells, so the white label over it keeps
     4.5:1 (5.8:1 here; on the plain success green it was 3.2:1). */
  .done {
    fill: color-mix(in srgb, var(--sw-success) 72%, #000);
  }

  .open {
    fill: none;
    stroke: var(--sw-accent);
  }

  .blk {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    font-variant-ligatures: none;
    font-size: var(--sw-text-xs);
    fill: var(--sw-text-primary);
    pointer-events: none;
  }

  /* The device the line below the chart describes. */
  .ring {
    fill: none;
    stroke: var(--sw-text-primary);
    pointer-events: none;
  }

  .now-line {
    stroke: var(--sw-accent);
    pointer-events: none;
  }

  .now {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    font-variant-ligatures: none;
    font-size: var(--sw-text-2xs);
    fill: var(--sw-accent);
    pointer-events: none;
  }

  .now.left {
    text-anchor: end;
  }

  /* Kept a line tall while empty, so the page does not shift as it fills. */
  .inspect {
    min-height: 20px;
    margin: 6px 0 0;
    font-size: var(--sw-text-xs);
    line-height: 20px;
    color: var(--sw-text-secondary);
  }

  .inspect .swatch {
    margin-right: 6px;
    vertical-align: -1px;
  }

  .name {
    font-family: var(--sw-font-mono);
    font-variant-ligatures: none;
    color: var(--sw-text-primary);
  }

  .open-device {
    padding: 0;
    border: 0;
    background: none;
    font-size: inherit;
    color: var(--sw-accent-bright);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
</style>
