<script lang="ts">
  import { calendarOccurrences, dayBlocks, localDays, type Block } from '$lib/maintenance/occurrences';
  import { SCHEDULE_COLOR_OTHER, scheduleColors } from '$lib/maintenance/palette';
  import { formatUtcOffset, ruleText, scheduleRulesText } from '$lib/maintenance/schedule-form';
  import type { Schedule } from '$lib/software/model';
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
  }

  let { schedules, now, days = 7, colors, hrefFor, legend = true }: Props = $props();

  // A week of the viewer's local days, hours down the side. Each window
  // occurrence is a block in the day it falls in, cut at midnight when it
  // crosses one; blocks that overlap in a day sit side by side.
  const HOUR_PX = 22;
  const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

  let palette = $derived(colors ?? scheduleColors(schedules.map((s) => s.name)));
  let columns = $derived(localDays(now, days));
  let blocks = $derived(dayBlocks(calendarOccurrences(schedules, columns), columns));
  let perDay = $derived(columns.map((_, i) => blocks.filter((b) => b.day === i)));
  let byName = $derived(new Map(schedules.map((s) => [s.name, s])));
  let todayIndex = $derived(columns.findIndex((c) => now >= c.start && now < c.end));
  let viewerOffset = $derived(formatUtcOffset(-new Date(now * 1000).getTimezoneOffset()));

  function colorOf(name: string): string {
    return palette.get(name) ?? SCHEDULE_COLOR_OTHER;
  }

  function top(b: Block, colStart: number): number {
    return ((b.start - colStart) / 3600) * HOUR_PX;
  }

  function height(b: Block): number {
    return Math.max(4, ((b.end - b.start) / 3600) * HOUR_PX - 2);
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
</script>

<div class="cal" style:--days={columns.length} style:--hour-px={`${HOUR_PX}px`}>
  <div class="corner"></div>
  {#each columns as col, i (col.start)}
    <div class="head" class:today={i === todayIndex} title={dayLabel(col.start)}>{dayHeader(col.start)}</div>
  {/each}

  <div class="hours">
    {#each HOURS as h (h)}
      <span class="hour mono" style:top={`${h * HOUR_PX}px`}>{h < 10 ? `0${h}` : h}:00</span>
    {/each}
  </div>
  {#each columns as col, i (col.start)}
    <div class="day" class:today={i === todayIndex}>
      {#each perDay[i] as b (`${b.occurrence.schedule}@${b.start}`)}
        {@const color = colorOf(b.occurrence.schedule)}
        {@const h = height(b)}
        <svelte:element
          this={hrefFor ? 'a' : 'div'}
          class="block"
          class:past={b.end <= now}
          href={hrefFor ? hrefFor(b.occurrence.schedule) : undefined}
          title={describe(b)}
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
        </svelte:element>
      {/each}
      {#if i === todayIndex}
        <div class="now" style:top={`${((now - col.start) / 3600) * HOUR_PX}px`}>
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
</style>
