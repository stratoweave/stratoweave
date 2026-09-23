<script lang="ts">
  import { CELL_BG } from '$lib/software/cells';
  import type { CampaignPlan, KnownStatus, PlanDevice, PlanWindow } from '$lib/software/model';
  import {
    WINDOW_GAP,
    assignLanes,
    axisTicks,
    buildAxis,
    cellRects,
    chooseCells,
    clockLabel,
    columnAt,
    dayLabel,
    fitScale,
    sameLocalDay,
    tickStep,
    windowDone,
    windowEnd,
    type Placed,
    type Rect,
    type WindowCells
  } from '$lib/software/plan-timeline';
  import { formatClock, formatClockSeconds, formatDuration } from '$lib/software/time';

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
  // estimated start; devices released together stack in one column.
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
  const NOW_COLOR = '#22d3ee';
  const DONE_COLOR = '#16a34a';
  const uid = `pt-${Math.random().toString(36).slice(2, 9)}`;

  interface Block {
    p: Placed;
    cells: WindowCells;
    y: number;
    gy: number;
    gridW: number;
    gridH: number;
    bandW: number;
    done: number;
    open: boolean;
  }

  let scroller = $state<HTMLDivElement | null>(null);
  let width = $state(0);
  let zoom = $state(1);
  let follow = $state(true);
  let lastSet = -1;

  let spans = $derived(plan.windows.map((w) => ({ start: w.start, end: windowEnd(w) })));
  let axis = $derived.by(() => {
    const w = width > 0 ? width : FALLBACK_WIDTH;
    return buildAxis(spans, now, fitScale(spans, now, w, PAD_L, PAD_R) * zoom, PAD_L, PAD_R);
  });
  let placed = $derived(assignLanes(plan.windows, axis, WINDOW_GAP));
  let cells = $derived(chooseCells(placed, axis, MAX_STACK));

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
        bandW: Math.max(2, p.xEnd - p.x - WINDOW_GAP),
        done: windowDone(p.w, statuses),
        open: now >= p.w.start && (p.w.end === null || now < p.w.end)
      };
    })
  );

  let rects = $derived(
    blocks.map((b): Rect[] => cellRects(b.cells, statuses, b.gy, cells.size, cells.pitch))
  );

  /** column*65536+row -> device, per block, for the hit test. */
  let index = $derived(
    blocks.map((b) => {
      const m = new Map<number, string>();
      for (const c of b.cells.cells) m.set(c.col * 65536 + c.row, c.name);
      return m;
    })
  );

  let devices = $derived.by(() => {
    const m = new Map<string, PlanDevice>();
    for (const w of plan.windows) for (const d of w.devices) m.set(d.name, d);
    return m;
  });

  let ticks = $derived(axisTicks(axis, tickStep(axis.pxPerHour)));
  let markerX = $derived(Math.min(axis.width - PAD_R, Math.max(PAD_L, axis.xOf(now))));
  let markerLabelLeft = $derived(markerX > axis.width - 90);

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
  function label(b: Block): string {
    const w = b.p.w;
    const name = w.schedule || 'window';
    const range = `${clockLabel(w.start)} → ${w.end === null ? 'open' : clockLabel(w.end)}`;
    const n = w.devices.length;
    const count = `${n.toLocaleString()} device${n === 1 ? '' : 's'}`;
    const pct = now >= w.start ? `${Math.round(b.done * 100)}%` : null;
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

  type Hit = { kind: 'device'; name: string } | { kind: 'window'; w: PlanWindow } | null;

  function hitAt(event: MouseEvent): Hit {
    const svg = event.currentTarget as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (px < b.p.x) continue;
      if (py >= b.y && py < b.y + HEAD_H && px < b.p.x + b.bandW) return { kind: 'window', w: b.p.w };
      if (py >= b.gy && py < b.gy + b.gridH && px < b.p.x + b.gridW) {
        const col = columnAt(b.cells.cols, px, cells.size);
        const row = Math.floor((py - b.gy) / cells.pitch);
        const name = col < 0 ? undefined : index[i].get(col * 65536 + row);
        if (name !== undefined) return { kind: 'device', name };
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
    const d = devices.get(hit.name);
    const status = statuses.get(hit.name) ?? 'pending';
    if (!d) return `${hit.name} — ${status}`;
    return `${hit.name} — ${status} · starts ${formatClock(d.estimatedStart)} · ~${formatDuration(d.estimatedDuration)}`;
  }

  function onClick(event: MouseEvent): void {
    const hit = hitAt(event);
    if (hit !== null && hit.kind === 'device') ondevice?.(hit.name);
  }

  function onMove(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const hit = hitAt(event);
    svg.querySelector('title')!.textContent = describe(hit);
    svg.style.cursor = hit !== null && hit.kind === 'device' ? 'pointer' : 'default';
  }
</script>

<div class="bar">
  <span class="hint">one cell per device at its estimated start</span>
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
        onclick={() => {
          zoom = z;
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
    aria-label="The plan's windows over time, one cell per device at its estimated start"
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
      {#if b.done > 0}
        <rect x={b.p.x} y={b.y} width={b.bandW * b.done} height={HEAD_H - 4} fill={DONE_COLOR} />
      {/if}
      {#if b.open}
        <rect x={b.p.x} y={b.y} width={b.bandW} height={HEAD_H - 4} fill="none" stroke={NOW_COLOR} />
      {/if}
      <text class="blk" x={b.p.x + 6} y={b.y + 13}>{label(b)}</text>
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

  .chip {
    font-size: 12px;
    padding: 2px 9px;
    border-radius: 999px;
    border: 1px solid var(--sw-border-default);
    color: var(--sw-text-secondary);
    background: var(--sw-bg-elevated);
    cursor: pointer;
  }

  .chip.active {
    color: var(--sw-accent);
    border-color: var(--sw-accent-glow-strong);
    background: var(--sw-accent-glow);
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
    font-size: 10px;
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
