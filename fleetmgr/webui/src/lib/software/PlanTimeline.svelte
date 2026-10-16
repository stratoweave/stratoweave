<script lang="ts">
  import { CELL_BG } from '$lib/software/cells';
  import {
    deviceDuration,
    deviceStart,
    type CampaignPlan,
    type KnownStatus,
    type PlanDevice,
    type PlanWindow
  } from '$lib/software/model';
  import {
    WINDOW_GAP,
    anchorStep,
    axisSpans,
    axisTicks,
    cellAt,
    cellRects,
    columnAt,
    fitter,
    holdWindows,
    layoutAt,
    nowAnchor,
    orderWindows,
    pickZoom,
    tickStep,
    windowDone,
    type Placed,
    type Rect,
    type WindowCells
  } from '$lib/software/plan-timeline';
  import {
    clockLabel,
    dayLabel,
    formatClock,
    formatClockSeconds,
    formatDuration,
    sameLocalDay
  } from '$lib/core/time';

  interface Props {
    plan: CampaignPlan;
    statuses: Map<string, KnownStatus>;
    /** Unix seconds, ticking. */
    now: number;
    ondevice?: (name: string) => void;
  }

  let { plan, statuses, now, ondevice }: Props = $props();

  // The plan on a wall-clock axis. Each window is a band as wide as its
  // duration with one cell per device below it, in a column at its
  // start; devices released together stack in one column.
  // Windows that overlap sit in lanes above each other, idle stretches
  // between windows collapse to a break, and a marker shows now.
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
  /** The smallest cell the timeline opens with when a zoom can give it. */
  const READABLE_SIZE = 8;
  const NOW_COLOR = '#22d3ee';
  const DONE_COLOR = '#16a34a';
  const uid = $props.id();

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
  // Until a chip is picked, the timeline opens at the least zoom whose cells
  // are readable: 1× on a wide screen, more on a phone, where the fitted
  // axis would shrink the cells to a few pixels.
  let zoomChoice = $state<number | null>(null);
  let follow = $state(true);
  let lastSet = -1;

  // Geometry: rebuilt when the plan's times, the width or the zoom change.
  // The clock reaches it only through the anchor, which moves once per step
  // and only while no window holds now.
  const hold = holdWindows();
  let windows = $derived(hold(plan.windows));
  let ordered = $derived(orderWindows(windows));
  let spans = $derived(ordered.map((o) => ({ start: o.w.start, end: o.end })));
  let step = $derived(anchorStep(spans));
  let anchor = $derived(nowAnchor(spans, now, step));
  let fit = $derived(
    fitter(ordered, axisSpans(spans, anchor, step), width > 0 ? width : FALLBACK_WIDTH, PAD_L, PAD_R, MAX_STACK)
  );
  let autoZoom = $derived(width === 0 ? 1 : pickZoom(ZOOMS, READABLE_SIZE, fit));
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

  // Statuses: the colours and each window's done share.
  let rects = $derived(
    blocks.map((b): Rect[] => cellRects(b.cells, statuses, b.gy, cells.size, cells.pitch))
  );
  let done = $derived(placed.map((p) => windowDone(p.w, statuses)));

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
    if (Math.abs(scroller.scrollLeft - lastSet) > 1) follow = false;
  }

  /** The label parts that fit the band: first to go is the range, then
   * the progress, then the count. */
  function label(b: Block, share: number): string {
    const w = b.p.w;
    const name = w.schedule || 'window';
    const range = `${clockLabel(w.start)} → ${w.end === null ? 'open' : clockLabel(w.end)}`;
    const n = w.devices.length;
    const count = `${n.toLocaleString()} device${n === 1 ? '' : 's'}`;
    const pct = now >= w.start ? `${Math.round(share * 100)}%` : null;
    const options = [
      [name, range, count, pct],
      [name, count, pct],
      [name, count],
      [name]
    ];
    for (const parts of options) {
      const text = parts.filter((p) => p !== null).join(' · ');
      if (text.length * 6.8 + 12 <= b.bandW) return text;
    }
    return '';
  }

  type Hit = { kind: 'device'; d: PlanDevice } | { kind: 'window'; w: PlanWindow } | null;

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
        if (d !== null) return { kind: 'device', d };
      }
    }
    return null;
  }

  function describe(hit: Hit): string {
    if (hit === null) return '';
    if (hit.kind === 'window') {
      const w = hit.w;
      const closes = w.end === null ? 'never closes' : `closes ${formatClock(w.end)}`;
      return `${w.schedule || 'window'}: opens ${formatClock(w.start)}, ${closes}, ${w.devices.length} device(s)`;
    }
    const d = hit.d;
    const status = statuses.get(d.name) ?? 'pending';
    const start = `${d.started === null ? 'starts' : 'started'} ${formatClock(deviceStart(d))}`;
    const took = `${d.finished === null ? '~' : 'took '}${formatDuration(deviceDuration(d))}`;
    return `${d.name} — ${status} · ${start} · ${took}`;
  }

  function onClick(event: MouseEvent): void {
    const hit = hitAt(event);
    if (hit !== null && hit.kind === 'device') ondevice?.(hit.d.name);
  }

  function onMove(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const hit = hitAt(event);
    svg.querySelector('title')!.textContent = describe(hit);
    svg.style.cursor = hit !== null && hit.kind === 'device' ? 'pointer' : 'default';
  }
</script>

<div class="bar">
  <span class="hint">one cell per device at its start</span>
  <div class="chips">
    {#if zoom > 1}
      <button class="chip" class:active={follow} type="button" onclick={() => (follow = !follow)}>
        {follow ? 'following now' : 'follow now'}
      </button>
    {/if}
    {#each ZOOMS as z (z)}
      <button
        class="chip"
        class:active={zoom === z}
        type="button"
        aria-pressed={zoom === z}
        onclick={() => {
          zoomChoice = z;
          follow = true;
        }}
      >
        {z}×
      </button>
    {/each}
  </div>
</div>

<div class="scroller" bind:this={scroller} bind:clientWidth={width} onscroll={onScroll}>
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
    onmousemove={onMove}
  >
    <title></title>
    <defs>
      <!-- One row-gutter pattern per grid, anchored at that grid's corner;
           columns sit at their own x, so only rows need re-cutting. -->
      {#each blocks as b, i (i)}
        {#if b.gridW > 0}
          <pattern
            id={`${uid}-${i}`}
            x={b.p.x}
            y={b.gy}
            width="1"
            height={cells.pitch}
            patternUnits="userSpaceOnUse"
          >
            <rect x="0" y={cells.size} width="1" height={cells.pitch - cells.size} fill={CELL_BG} />
          </pattern>
        {/if}
      {/each}
    </defs>

    <line class="axis" x1={PAD_L} x2={axis.width - PAD_R} y1={AXIS_Y} y2={AXIS_Y} />
    {#each ticks as t, i (t)}
      {@const x = axis.xOf(t)}
      <line class="tick" x1={x} x2={x} y1={AXIS_Y - 5} y2={lanes.height} />
      {#if i === 0 || !sameLocalDay(ticks[i - 1], t)}
        <text class="lbl mid day" x={x} y={DAY_Y}>{dayLabel(t)}</text>
      {/if}
      <text class="lbl mid" x={x} y={TIME_Y}>{clockLabel(t)}</text>
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
        <rect x={b.p.x} y={b.y} width={b.bandW * done[i]} height={HEAD_H - 4} fill={DONE_COLOR} />
      {/if}
      {#if isOpen(b.p.w)}
        <rect x={b.p.x} y={b.y} width={b.bandW} height={HEAD_H - 4} fill="none" stroke={NOW_COLOR} />
      {/if}
      <text class="blk" x={b.p.x + 6} y={b.y + 13}>{label(b, done[i])}</text>
      {#each rects[i] as r, j (j)}
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      {/each}
      {#if b.gridW > 0}
        <rect
          x={b.p.x}
          y={b.gy}
          width={b.gridW}
          height={b.gridH}
          fill={`url(#${uid}-${i})`}
          pointer-events="none"
        />
      {/if}
    {/each}

    <line x1={markerX} x2={markerX} y1={MARK_Y - 8} y2={lanes.height} stroke={NOW_COLOR} pointer-events="none" />
    <text class="now" class:left={markerLabelLeft} x={markerLabelLeft ? markerX - 4 : markerX + 4} y={MARK_Y}>
      {formatClockSeconds(now)}
    </text>
  </svg>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .hint {
    font-size: 13px;
    color: var(--sw-text-muted);
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
    font-size: 11px;
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

  .blk {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    font-size: 11px;
    fill: var(--sw-text-primary);
    pointer-events: none;
  }

  .now {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    font-size: 11px;
    fill: var(--sw-accent);
    pointer-events: none;
  }

  .now.left {
    text-anchor: end;
  }
</style>
