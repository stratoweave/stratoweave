<script lang="ts">
  import {
    SNAP_S,
    calendarOccurrences,
    dayBlocks,
    localDays,
    moveRule,
    resizeRule,
    ruleForSpan,
    snapTime,
    type Block,
    type Occurrence
  } from '$lib/maintenance/occurrences';
  import { SCHEDULE_COLOR_OTHER, scheduleColors } from '$lib/maintenance/palette';
  import { formatUtcOffset, ruleText, scheduleRulesText } from '$lib/maintenance/schedule-form';
  import type { MaintenanceWindow, Schedule } from '$lib/software/model';
  import { clockLabel, dayLabel } from '$lib/software/plan-timeline';
  import { formatClock } from '$lib/software/time';

  interface Props {
    schedules: Schedule[];
    /** Unix seconds. */
    now: number;
    days?: number;
    /** Colour per schedule name; derived from the names when absent. */
    colors?: Map<string, string>;
    /** Where a window leads; without it the blocks are plain boxes. */
    hrefFor?: (name: string) => string;
    legend?: boolean;
    hourPx?: number;
    /** Editing one schedule: drag a window to move it, drag its top or
     * bottom edge to resize it. Gets the rule as it was and as it is to
     * become. */
    onrulechange?: (from: MaintenanceWindow, to: MaintenanceWindow) => void;
    /** Dragging over an empty stretch of a day adds a rule. */
    onrulecreate?: (rule: MaintenanceWindow) => void;
  }

  let {
    schedules,
    now,
    days = 7,
    colors,
    hrefFor,
    legend = true,
    hourPx = 22,
    onrulechange,
    onrulecreate
  }: Props = $props();

  // A week of the viewer's local days, hours down the side. Each window
  // occurrence is a block in the day it falls in, cut at midnight when it
  // crosses one; blocks that overlap in a day sit side by side.
  const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
  // Less pointer movement than this is a click.
  const DRAG_PX = 4;

  type Drag =
    | {
        kind: 'move' | 'start' | 'end';
        occ: Occurrence;
        col0: number;
        /** Column under the pointer now. */
        col: number;
        x0: number;
        y0: number;
        moved: boolean;
        proposed: MaintenanceWindow | null;
      }
    | { kind: 'create'; col: number; t0: number; t1: number; x0: number; y0: number; moved: boolean };

  // Raw, not proxied: the drag holds the very rule objects it compares.
  let drag = $state.raw<Drag | null>(null);
  let calEl: HTMLDivElement;

  let editable = $derived(!!onrulechange && schedules.length === 1);
  // While a window is dragged its rule is drawn as it would become.
  let shown = $derived.by(() => {
    const d = drag;
    if (!d || d.kind === 'create' || !d.proposed) return schedules;
    const { occ, proposed } = d;
    return schedules.map((s) =>
      s.name === occ.schedule ? { ...s, windows: s.windows.map((w) => (w === occ.rule ? proposed : w)) } : s
    );
  });
  let draggedRule = $derived(drag && drag.kind !== 'create' ? drag.proposed : null);

  let palette = $derived(colors ?? scheduleColors(schedules.map((s) => s.name)));
  let columns = $derived(localDays(now, days));
  let blocks = $derived(dayBlocks(calendarOccurrences(shown, columns), columns));
  let perDay = $derived(columns.map((_, i) => blocks.filter((b) => b.day === i)));
  let byName = $derived(new Map(schedules.map((s) => [s.name, s])));
  let todayIndex = $derived(columns.findIndex((c) => now >= c.start && now < c.end));
  let viewerOffset = $derived(formatUtcOffset(-new Date(now * 1000).getTimezoneOffset()));
  // One time tag, on the dragged rule's opening nearest the pointer.
  let tagCol = $derived.by(() => {
    const d = drag;
    if (!d || d.kind === 'create' || !d.proposed) return -1;
    const opens = (i: number) =>
      perDay[i]?.some((b) => b.occurrence.rule === d.proposed && b.start === b.occurrence.start);
    for (let k = 0; k < columns.length; k++) {
      if (opens(d.col - k)) return d.col - k;
      if (opens(d.col + k)) return d.col + k;
    }
    return -1;
  });

  function colorOf(name: string): string {
    return palette.get(name) ?? SCHEDULE_COLOR_OTHER;
  }

  function top(b: Block, colStart: number): number {
    return ((b.start - colStart) / 3600) * hourPx;
  }

  function height(b: Block): number {
    return Math.max(4, ((b.end - b.start) / 3600) * hourPx - 2);
  }

  /** "Wed 23": the weekday and the day of the month fit a narrow column. */
  function dayHeader(unix: number): string {
    const d = new Date(unix * 1000);
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`;
  }

  function describe(b: Block): string {
    const o = b.occurrence;
    const s = byName.get(o.schedule);
    const rule = s ? ` · rule ${ruleText(o.rule, s.utcOffset)}` : '';
    return `${o.schedule}: opens ${formatClock(o.start)}, closes ${formatClock(o.end)}${rule}`;
  }

  function dayEls(): HTMLElement[] {
    return [...calEl.querySelectorAll<HTMLElement>('[data-col]')];
  }

  function columnAt(x: number): number {
    let col = 0;
    dayEls().forEach((el, i) => {
      if (x >= el.getBoundingClientRect().left) col = i;
    });
    return col;
  }

  function timeAt(col: number, y: number): number {
    const r = dayEls()[col].getBoundingClientRect();
    return columns[col].start + Math.min(Math.max((y - r.top) / hourPx, 0), 24) * 3600;
  }

  function onPointerDown(event: PointerEvent): void {
    if (!editable || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const dayEl = target.closest<HTMLElement>('[data-col]');
    if (!dayEl) return;
    const col = Number(dayEl.dataset.col);
    const blockEl = target.closest<HTMLElement>('[data-block]');
    let next: Drag;
    if (blockEl) {
      const b = perDay[col]?.[Number(blockEl.dataset.block)];
      if (!b) return;
      const edge = target.closest<HTMLElement>('[data-edge]')?.dataset.edge;
      const kind = edge === 'start' ? 'start' : edge === 'end' ? 'end' : 'move';
      next = { kind, occ: b.occurrence, col0: col, col, x0: event.clientX, y0: event.clientY, moved: false, proposed: null };
    } else if (onrulecreate) {
      const t = snapTime(timeAt(col, event.clientY));
      next = { kind: 'create', col, t0: t, t1: t, x0: event.clientX, y0: event.clientY, moved: false };
    } else {
      return;
    }
    event.preventDefault();
    drag = next;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', onKeyDown);
  }

  function onPointerMove(event: PointerEvent): void {
    const d = drag;
    if (!d) return;
    if (!d.moved && Math.abs(event.clientX - d.x0) < DRAG_PX && Math.abs(event.clientY - d.y0) < DRAG_PX) return;
    if (d.kind === 'create') {
      drag = { ...d, moved: true, t1: snapTime(timeAt(d.col, event.clientY)) };
      return;
    }
    const s = byName.get(d.occ.schedule);
    if (!s) return;
    const o = d.occ;
    const dt = ((event.clientY - d.y0) / hourPx) * 3600;
    let proposed: MaintenanceWindow;
    if (d.kind === 'move') {
      const shift = snapTime(o.start + dt) - o.start;
      proposed = moveRule(o.rule, s.utcOffset, o.start, shift, columnAt(event.clientX) - d.col0);
    } else if (d.kind === 'start') {
      proposed = resizeRule(o.rule, s.utcOffset, o.start, 'start', snapTime(o.start + dt));
    } else {
      // The length snaps, so a whole-hour window stays whole hours even
      // when it opens off the quarter-hour grid.
      const length = Math.round((o.end - o.start + dt) / SNAP_S) * SNAP_S;
      proposed = resizeRule(o.rule, s.utcOffset, o.start, 'end', o.start + length);
    }
    drag = { ...d, moved: true, proposed, col: columnAt(event.clientX) };
  }

  function onPointerUp(): void {
    const d = drag;
    stop();
    if (!d || !d.moved) return;
    if (d.kind === 'create') {
      const start = Math.min(d.t0, d.t1);
      const end = Math.max(d.t0, d.t1);
      if (end - start >= SNAP_S) onrulecreate?.(ruleForSpan(start, end, schedules[0].utcOffset));
      return;
    }
    const p = d.proposed;
    const r = d.occ.rule;
    if (p && (p.at !== r.at || p.duration !== r.duration || p.days.join() !== r.days.join())) {
      onrulechange?.(r, p);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') stop();
  }

  function stop(): void {
    drag = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', stop);
    window.removeEventListener('keydown', onKeyDown);
  }

  // Leaving the page mid-drag drops the window listeners.
  $effect(() => stop);
</script>

<div
  class="cal"
  class:editable
  bind:this={calEl}
  data-drag={drag?.moved ? drag.kind : undefined}
  role={editable ? 'application' : undefined}
  aria-label={editable ? 'Drag a window to move it, an edge to resize it, an empty stretch to add one' : undefined}
  style:--days={columns.length}
  style:--hour-px={`${hourPx}px`}
  onpointerdown={onPointerDown}
>
  <div class="corner"></div>
  {#each columns as col, i (col.start)}
    <div class="head" class:today={i === todayIndex} title={dayLabel(col.start)}>{dayHeader(col.start)}</div>
  {/each}

  <div class="hours">
    {#each HOURS as h (h)}
      <span class="hour mono" style:top={`${h * hourPx}px`}>{h < 10 ? `0${h}` : h}:00</span>
    {/each}
  </div>
  {#each columns as col, i (col.start)}
    <div class="day" class:today={i === todayIndex} data-col={i}>
      {#each perDay[i] as b, j (`${b.occurrence.schedule}@${b.occurrence.start}`)}
        {@const color = colorOf(b.occurrence.schedule)}
        {@const h = height(b)}
        {@const dragged = draggedRule !== null && b.occurrence.rule === draggedRule}
        <svelte:element
          this={hrefFor ? 'a' : 'div'}
          class="block"
          class:past={b.end <= now}
          class:dragged
          data-block={j}
          href={hrefFor ? hrefFor(b.occurrence.schedule) : undefined}
          title={drag ? undefined : describe(b)}
          aria-label={describe(b)}
          style:top={`${top(b, col.start)}px`}
          style:height={`${h}px`}
          style:left={`calc(${(b.lane / b.lanes) * 100}% + 2px)`}
          style:width={`calc(${100 / b.lanes}% - 5px)`}
          style:background={`color-mix(in srgb, ${color} 32%, var(--sw-bg-card))`}
          style:border-left-color={color}
        >
          {#if h >= 16}
            <span class="name">{b.occurrence.schedule}</span>
          {/if}
          {#if h >= 34}
            <span class="range mono">{clockLabel(b.occurrence.start)}–{clockLabel(b.occurrence.end)}</span>
          {/if}
          {#if editable && b.start === b.occurrence.start}
            <span class="edge top" data-edge="start"></span>
          {/if}
          {#if editable && b.end === b.occurrence.end}
            <span class="edge bottom" data-edge="end"></span>
          {/if}
        </svelte:element>
        {#if dragged && i === tagCol && b.start === b.occurrence.start}
          <span class="tag mono" class:end={i >= columns.length - 2} style:top={`${Math.max(0, top(b, col.start) - 16)}px`}>
            {clockLabel(b.occurrence.start)}–{clockLabel(b.occurrence.end)}
          </span>
        {/if}
      {/each}
      {#if drag?.kind === 'create' && drag.moved && drag.col === i}
        {@const a = Math.min(drag.t0, drag.t1)}
        {@const z = Math.max(drag.t0, drag.t1)}
        <div class="ghost" style:top={`${((a - col.start) / 3600) * hourPx}px`} style:height={`${((z - a) / 3600) * hourPx}px`}></div>
        <span
          class="tag mono"
          class:end={i >= columns.length - 2}
          style:top={`${Math.max(0, ((a - col.start) / 3600) * hourPx - 16)}px`}
        >
          {clockLabel(a)}–{clockLabel(z)}
        </span>
      {/if}
      {#if i === todayIndex}
        <div class="now" style:top={`${((now - col.start) / 3600) * hourPx}px`}>
          <span class="mono">{clockLabel(now)}</span>
        </div>
      {/if}
    </div>
  {/each}
</div>

{#if legend}
  <div class="legend">
    {#each schedules as s (s.name)}
      <span class="entry">
        <span class="swatch" style:background={colorOf(s.name)}></span>
        <span class="mono">{s.name}</span>
        <span class="rule">{scheduleRulesText(s)}</span>
      </span>
    {/each}
    <span class="tz">times in your clock, UTC{viewerOffset}</span>
  </div>
{/if}

<style>
  .cal {
    display: grid;
    grid-template-columns: 48px repeat(var(--days), minmax(0, 1fr));
    grid-template-rows: auto calc(24 * var(--hour-px));
    column-gap: 2px;
  }

  .corner,
  .head {
    padding: 0 6px 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--sw-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head.today {
    color: var(--sw-accent);
  }

  .hours {
    position: relative;
  }

  .hour {
    position: absolute;
    right: 8px;
    transform: translateY(-50%);
    font-size: 10.5px;
    color: var(--sw-text-muted);
  }

  .hours .hour:first-child {
    transform: none;
  }

  .day {
    position: relative;
    background-color: var(--sw-bg-deep);
    background-image: repeating-linear-gradient(
      to bottom,
      var(--sw-border-subtle) 0,
      var(--sw-border-subtle) 1px,
      transparent 1px,
      transparent calc(3 * var(--hour-px))
    );
    border-radius: 4px;
    overflow: hidden;
  }

  .day.today {
    box-shadow: inset 0 0 0 1px var(--sw-accent-glow-strong);
  }

  .block {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 5px;
    border-radius: 3px;
    border-left: 3px solid;
    box-sizing: border-box;
    overflow: hidden;
    color: var(--sw-text-primary);
    text-decoration: none;
    font-size: 11px;
    line-height: 1.3;
  }

  a.block:hover,
  a.block:focus-visible {
    filter: brightness(1.2);
  }

  .block.past {
    opacity: 0.5;
  }

  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .range {
    font-size: 10.5px;
    color: var(--sw-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .now {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 1px solid var(--sw-accent);
    pointer-events: none;
  }

  .now span {
    position: absolute;
    right: 4px;
    top: 1px;
    font-size: 10px;
    color: var(--sw-accent);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-top: 12px;
    font-size: 12px;
    color: var(--sw-text-secondary);
  }

  .entry {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }

  .rule {
    color: var(--sw-text-muted);
  }

  .tz {
    margin-left: auto;
    color: var(--sw-text-muted);
  }

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }

  /* Editing */
  .cal.editable {
    user-select: none;
  }

  /* Time tags while dragging are wider than a day. */
  .cal.editable .day {
    overflow: visible;
    cursor: crosshair;
    touch-action: none;
  }

  .cal.editable .block {
    cursor: grab;
  }

  .edge {
    position: absolute;
    left: 0;
    right: 0;
    height: min(6px, 30%);
    cursor: ns-resize;
  }

  .edge.top {
    top: 0;
  }

  .edge.bottom {
    bottom: 0;
  }

  .cal[data-drag='move'],
  .cal[data-drag='move'] * {
    cursor: grabbing !important;
  }

  .cal[data-drag='start'],
  .cal[data-drag='start'] *,
  .cal[data-drag='end'],
  .cal[data-drag='end'] * {
    cursor: ns-resize !important;
  }

  .cal[data-drag='create'],
  .cal[data-drag='create'] * {
    cursor: crosshair !important;
  }

  .block.dragged {
    z-index: 2;
    box-shadow:
      0 0 0 1px var(--sw-accent),
      0 6px 16px rgb(0 0 0 / 0.35);
  }

  .ghost {
    position: absolute;
    left: 2px;
    right: 3px;
    border: 1px dashed var(--sw-accent);
    border-radius: 3px;
    background: var(--sw-accent-glow);
    pointer-events: none;
  }

  .tag {
    position: absolute;
    left: 2px;
    z-index: 3;
    padding: 0 4px;
    border: 1px solid var(--sw-border-default);
    border-radius: 3px;
    background: var(--sw-bg-elevated);
    color: var(--sw-text-primary);
    font-size: 10.5px;
    line-height: 14px;
    white-space: nowrap;
    pointer-events: none;
  }

  .tag.end {
    left: auto;
    right: 3px;
  }
</style>
