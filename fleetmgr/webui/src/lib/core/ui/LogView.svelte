<script lang="ts">
  // A log, newest first: a chip for each level to show or hide it, a
  // search, Live to follow what is written, and older messages a page at a
  // time. A message opens to show all of its data. load reads a page of the
  // one log this view shows.
  import { tick, untrack } from 'svelte';

  import { errorText } from '#lib/core/errors.ts';
  import {
    LEVEL_LABEL,
    LOG_LEVELS,
    logSource,
    logTimeMs,
    logTone,
    logValue,
    logValueLong,
    records,
    type LogEntry,
    type LogLevel,
    type LogPage,
    type LogQuery
  } from '#lib/core/log.ts';
  import { createPoller } from '#lib/core/polling/poller.ts';
  import { dayLabel, sameLocalDay } from '#lib/core/time.ts';

  interface Props {
    load: (query: LogQuery) => Promise<LogPage>;
    /** Gets each page. */
    onpage?: (page: LogPage) => void;
    /** The level the log is written at, when the caller knows it sooner
     * than a page tells. A level it leaves out, with no messages in view,
     * has its chip dimmed. */
    logsAt?: string;
  }

  let { load, onpage, logsAt }: Props = $props();

  const uid = $props.id();
  const PAGE = 200;
  // Live asks for at most this many new messages; past it, the view marks
  // the ones it skipped.
  const LIVE_PAGE = 500;
  const LIVE_MS = 2000;
  // Live drops the oldest messages past this many.
  const KEEP = 5000;
  // A data value longer than this is cut on its line; it opens whole.
  const SHORT = 80;

  type Row = { id: number; entry: LogEntry } | { id: number; gap: true };

  let shown = $state.raw<Set<LogLevel>>(new Set(LOG_LEVELS));
  /** The messages of each level in the time the rows span. */
  let counts = $state.raw<Partial<Record<LogLevel, number>>>({});
  /** The level the last page said the log is written at. */
  let pageLevel = $state('');
  let search = $state('');
  /** The search as asked for, once typing stops. */
  let query = $state('');
  let live = $state(true);
  let rows = $state.raw<Row[]>([]);
  let start = $state<string | null>(null);
  let dropped = $state(false);
  let loading = $state(true);
  let loadingOlder = $state(false);
  let error = $state('');
  let expanded = $state.raw<Set<number>>(new Set());
  /** New messages above the scrolled view. */
  let unseen = $state(0);
  let list = $state<HTMLOListElement | null>(null);

  let end: string | null = null;
  let nextId = 0;
  // A new filter starts a new generation; answers for an older one are
  // dropped.
  let generation = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  let writtenAt = $derived(logsAt ?? pageLevel);

  function asked(extra: LogQuery): LogQuery {
    const levels = shown.size === LOG_LEVELS.length ? undefined : LOG_LEVELS.filter((l) => shown.has(l));
    return { levels, q: query, ...extra };
  }

  function plusCounts(more: Partial<Record<LogLevel, number>>): Partial<Record<LogLevel, number>> {
    const sum = { ...counts };
    for (const level of LOG_LEVELS) sum[level] = (sum[level] ?? 0) + (more[level] ?? 0);
    return sum;
  }

  /** A level the log is not written at and that has no messages in view. */
  function dimmed(level: LogLevel): boolean {
    return !records(writtenAt, level) && !counts[level];
  }

  function toggleLevel(level: LogLevel): void {
    if (dimmed(level)) return;
    const next = new Set(shown);
    if (!next.delete(level)) next.add(level);
    shown = next;
  }

  /** Entries oldest first -> rows newest first. */
  function toRows(entries: LogEntry[]): Row[] {
    const res: Row[] = [];
    for (let i = entries.length - 1; i >= 0; i--) res.push({ id: ++nextId, entry: entries[i] });
    return res;
  }

  async function reload(): Promise<void> {
    const gen = ++generation;
    if (shown.size === 0) {
      rows = [];
      start = null;
      end = null;
      loading = false;
      return;
    }
    loading = true;
    try {
      const page = await load(asked({ limit: PAGE }));
      if (gen !== generation) return;
      rows = toRows(page.entries);
      counts = page.counts;
      pageLevel = page.level;
      start = page.start;
      end = page.end;
      error = '';
      dropped = false;
      expanded = new Set();
      unseen = 0;
      if (list) list.scrollTop = 0;
      onpage?.(page);
    } catch (readError) {
      if (gen !== generation) return;
      rows = [];
      start = null;
      end = null;
      error = errorText(readError, 'The log could not be read.');
    } finally {
      if (gen === generation) loading = false;
    }
  }

  async function loadOlder(): Promise<void> {
    if (start === null || loadingOlder) return;
    const gen = generation;
    loadingOlder = true;
    try {
      const page = await load(asked({ limit: PAGE, before: start }));
      if (gen !== generation) return;
      rows = [...rows, ...toRows(page.entries)];
      counts = plusCounts(page.counts);
      start = page.start;
    } catch (readError) {
      if (gen === generation) error = errorText(readError, 'The log could not be read.');
    } finally {
      loadingOlder = false;
    }
  }

  async function follow(): Promise<void> {
    if (loading || shown.size === 0) return;
    if (end === null) {
      // The first read failed; try it again.
      await reload();
      return;
    }
    const gen = generation;
    const page = await load(asked({ limit: LIVE_PAGE, after: end }));
    if (gen !== generation) return;
    end = page.end;
    error = '';
    pageLevel = page.level;
    counts = plusCounts(page.counts);
    onpage?.(page);
    if (page.entries.length === 0 && !page.gap) return;
    const added = toRows(page.entries);
    if (page.gap) added.push({ id: ++nextId, gap: true });
    let next = [...added, ...rows];
    if (next.length > KEEP) {
      next = next.slice(0, KEEP);
      start = null;
      dropped = true;
    }
    // Someone reading further down keeps their place.
    const top = list?.scrollTop ?? 0;
    const height = list?.scrollHeight ?? 0;
    rows = next;
    if (list && top > 0) {
      await tick();
      list.scrollTop = top + (list.scrollHeight - height);
      unseen += page.entries.length;
    }
  }

  $effect(() => {
    void shown;
    void query;
    untrack(() => void reload());
  });

  $effect(() => {
    if (!live) return;
    const poller = createPoller(follow, LIVE_MS);
    poller.start();
    return () => poller.stop();
  });

  function onSearch(value: string): void {
    search = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => (query = value.trim()), 300);
  }

  function searchNow(): void {
    clearTimeout(searchTimer);
    query = search.trim();
  }

  function onScroll(): void {
    if (list && list.scrollTop < 8) unseen = 0;
  }

  function toTop(): void {
    list?.scrollTo({ top: 0 });
    unseen = 0;
  }

  function toggle(id: number): void {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    expanded = next;
  }

  function pad(n: number, width = 2): string {
    return String(n).padStart(width, '0');
  }

  /** "13:07:42.123" on the local clock; the date is in the day rows. */
  function clock(ms: number): string {
    if (Number.isNaN(ms)) return '';
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  /** The day row above a message, '' when it needs none: above the first
   * message of each day, and above the newest unless that is today. */
  function dayAbove(i: number): string {
    const row = rows[i];
    if ('gap' in row) return '';
    const ms = logTimeMs(row.entry.time);
    if (Number.isNaN(ms)) return '';
    let previous: number | null = null;
    for (let j = i - 1; j >= 0 && previous === null; j--) {
      const above = rows[j];
      if (!('gap' in above)) previous = logTimeMs(above.entry.time);
    }
    const compare = previous === null || Number.isNaN(previous) ? Date.now() : previous;
    return sameLocalDay(ms / 1000, compare / 1000) ? '' : dayLabel(ms / 1000);
  }

  function short(text: string): string {
    const line = text.split('\n', 1)[0];
    return line.length > SHORT || line.length < text.length ? `${line.slice(0, SHORT)}…` : line;
  }

  /** text in parts, the ones that match the search marked. */
  function marked(text: string): { text: string; match: boolean }[] {
    if (!query) return [{ text, match: false }];
    const parts: { text: string; match: boolean }[] = [];
    const lower = text.toLowerCase();
    const needle = query.toLowerCase();
    let at = 0;
    for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, at)) {
      if (i > at) parts.push({ text: text.slice(at, i), match: false });
      parts.push({ text: text.slice(i, i + needle.length), match: true });
      at = i + needle.length;
    }
    if (at < text.length) parts.push({ text: text.slice(at), match: false });
    return parts;
  }
</script>

{#snippet highlighted(text: string)}
  {#each marked(text) as part, i (i)}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
{/snippet}

<div class="frame">
  <div class="toolbar">
    <div class="levels" role="group" aria-label="Levels shown">
      {#each LOG_LEVELS as level (level)}
        {@const off = dimmed(level)}
        <button
          class="level-chip tone-{level}"
          class:on={!off && shown.has(level)}
          class:off
          type="button"
          aria-pressed={!off && shown.has(level)}
          aria-disabled={off || undefined}
          title={off ? 'Not recorded' : undefined}
          onclick={() => toggleLevel(level)}
        >
          <span class="dot" aria-hidden="true"></span>
          {LEVEL_LABEL[level]}
          {#if off}
            <span class="sr-only">, not recorded</span>
          {:else}
            <span class="count">{counts[level] ?? 0}</span>
          {/if}
        </button>
      {/each}
    </div>
    <input
      id="{uid}-search"
      class="input compact mono search"
      type="search"
      aria-label="Search the log"
      placeholder="search"
      value={search}
      oninput={(e) => onSearch(e.currentTarget.value)}
      onkeydown={(e) => e.key === 'Enter' && searchNow()}
    />
    <button
      class="btn btn-sm live"
      class:on={live}
      type="button"
      aria-pressed={live}
      title={live ? 'Showing new messages as they are written' : 'New messages are not shown'}
      onclick={() => (live = !live)}
    >
      <span class="live-dot" aria-hidden="true"></span>Live
    </button>
  </div>

  {#if error}
    <div class="error-state status">{error}</div>
  {/if}

  <div class="rows">
    {#if unseen > 0}
      <button class="unseen" type="button" onclick={toTop}>{unseen} new ↑</button>
    {/if}
    <ol
      class="log"
      bind:this={list}
      role="log"
      aria-live={live ? 'polite' : 'off'}
      aria-label="Log messages, newest first"
      aria-busy={loading}
      onscroll={onScroll}
    >
      {#each rows as row, i (row.id)}
        {@const day = dayAbove(i)}
        {#if day}
          <li class="day" aria-hidden="true">{day}</li>
        {/if}
        {#if 'gap' in row}
          <li class="gap">More messages came at once than Live reads; the ones in between are not shown.</li>
        {:else}
          {@const e = row.entry}
          {@const open = expanded.has(row.id)}
          {@const data = Object.entries(e.data ?? {})}
          {@const ms = logTimeMs(e.time)}
          <li class="entry tone-{logTone(e.level)}" class:open>
            <button class="line" type="button" aria-expanded={open} onclick={() => toggle(row.id)}>
              <time class="time" datetime={e.time ?? undefined} title={e.time ?? ''}>{clock(ms)}</time>
              <span class="level">{(e.level ?? '').toUpperCase()}</span>
              <span class="text">
                {#if e.msg}<span class="msg">{@render highlighted(e.msg)}</span>{/if}
                {#each data as [key, value] (key)}
                  <span class="pair"><span class="key">{key}=</span>{@render highlighted(short(logValue(value)))}</span>
                {/each}
              </span>
              <span class="source">{logSource(e)}</span>
            </button>
            {#if open}
              <dl class="detail">
                {#if e.time}<dt>time</dt><dd>{e.time}</dd>{/if}
                {#if e.logger}<dt>logger</dt><dd>{e.logger}</dd>{/if}
                {#if e.actor}<dt>actor</dt><dd>{e.actor}</dd>{/if}
                {#each data as [key, value] (key)}
                  <dt>{key}</dt>
                  <dd><pre>{@render highlighted(logValueLong(value))}</pre></dd>
                {/each}
              </dl>
            {/if}
          </li>
        {/if}
      {/each}
    </ol>

    {#if loading && rows.length === 0}
      <p class="note" aria-busy="true">Reading the log…</p>
    {:else if !error && rows.length === 0}
      <p class="note">No messages.</p>
    {/if}
  </div>
</div>

{#if start !== null}
  <div class="more">
    <button class="btn btn-sm btn-secondary" type="button" disabled={loadingOlder} onclick={loadOlder}>
      {loadingOlder ? 'Reading…' : 'Older messages'}
    </button>
  </div>
{:else if dropped}
  <p class="end">The view keeps the newest {KEEP} messages.</p>
{/if}

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--sw-border-subtle);
    border-radius: var(--sw-radius-md) var(--sw-radius-md) 0 0;
    background: var(--sw-bg-card);
  }

  .levels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* A legend: the dot is filled while the level is shown. */
  .level-chip {
    --tone: var(--sw-text-muted);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px 4px 9px;
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-pill);
    background: transparent;
    color: var(--sw-text-muted);
    font-size: var(--sw-text-xs);
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--sw-dur-fast) var(--sw-ease),
      border-color var(--sw-dur-fast) var(--sw-ease),
      color var(--sw-dur-fast) var(--sw-ease);
  }

  .level-chip.tone-error {
    --tone: var(--sw-danger-text);
  }

  .level-chip.tone-warning {
    --tone: var(--sw-warning);
  }

  .level-chip.tone-info {
    --tone: var(--sw-accent);
  }

  .level-chip .dot {
    width: 8px;
    height: 8px;
    border: 1.5px solid var(--tone);
    border-radius: 50%;
    transition: background var(--sw-dur-fast) var(--sw-ease);
  }

  .level-chip.on {
    background: var(--sw-bg-elevated);
    color: var(--sw-text-primary);
  }

  .level-chip.on .dot {
    background: var(--tone);
  }

  .level-chip:hover:not(.off) {
    border-color: var(--sw-text-muted);
    color: var(--sw-text-primary);
  }

  .level-chip:focus-visible {
    outline: 2px solid var(--sw-accent);
    outline-offset: 2px;
  }

  .count {
    color: var(--sw-text-muted);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  /* Not written, and none in view: nothing to show or hide. */
  .level-chip.off {
    border-style: dashed;
    border-color: var(--sw-border-subtle);
    opacity: 0.55;
    cursor: default;
  }

  .level-chip.off .dot {
    border-color: var(--sw-text-muted);
  }

  .search {
    flex: 1;
    min-width: 10rem;
    max-width: 320px;
  }

  .live {
    gap: 8px;
    margin-left: auto;
  }

  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sw-text-muted);
  }

  .live.on {
    color: var(--sw-accent);
    border-color: var(--sw-accent-glow-strong);
    background: var(--sw-accent-glow);
  }

  .live.on .live-dot {
    background: var(--sw-accent);
    animation: pulse 2s var(--sw-ease) infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live.on .live-dot {
      animation: none;
    }
  }

  .frame {
    border: 1px solid var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-input);
  }

  .frame > .error-state {
    margin: 12px;
  }

  .rows {
    position: relative;
  }

  .log {
    max-height: min(62vh, 560px);
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    list-style: none;
    /* follow() keeps the place of someone reading lower down itself. */
    overflow-anchor: none;
    font-family: var(--sw-font-mono);
    font-size: var(--sw-text-xs);
    line-height: 1.55;
  }

  .log:empty {
    display: none;
  }

  .entry {
    content-visibility: auto;
    contain-intrinsic-size: auto 26px;
  }

  .line {
    display: grid;
    grid-template-columns: 12ch 6ch minmax(0, 1fr) auto;
    gap: 0 12px;
    width: 100%;
    padding: 3px 12px;
    border: none;
    background: none;
    color: var(--sw-text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .line:hover,
  .open .line {
    background: var(--sw-bg-hover);
  }

  .line:focus-visible {
    outline: 2px solid var(--sw-accent);
    outline-offset: -2px;
  }

  .time {
    color: var(--sw-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .level {
    font-weight: 600;
  }

  .tone-error .level {
    color: var(--sw-danger-text);
  }

  .tone-error .line {
    box-shadow: inset 2px 0 var(--sw-danger);
  }

  .tone-warning .level {
    color: var(--sw-warning);
  }

  .tone-warning .line {
    box-shadow: inset 2px 0 var(--sw-warning);
  }

  .tone-info .level {
    color: var(--sw-accent);
  }

  .tone-debug .level,
  .tone-debug .text {
    color: var(--sw-text-muted);
  }

  .text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .msg {
    color: var(--sw-text-primary);
    margin-right: 8px;
  }

  .tone-debug .msg {
    color: var(--sw-text-secondary);
  }

  /* A pair breaks only when it is longer than the line. */
  .pair {
    display: inline-block;
    max-width: 100%;
    margin-right: 8px;
    vertical-align: top;
  }

  .key {
    color: var(--sw-text-muted);
  }

  .source {
    color: var(--sw-text-muted);
    white-space: nowrap;
  }

  mark {
    background: var(--sw-warning-dim);
    color: var(--sw-warning);
    border-radius: 2px;
  }

  .detail {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px 16px;
    margin: 0;
    padding: 8px 12px 12px calc(12ch + 24px);
    background: var(--sw-bg-hover);
  }

  .detail dt {
    color: var(--sw-text-muted);
  }

  .detail dd {
    margin: 0;
    color: var(--sw-text-primary);
    overflow-wrap: anywhere;
  }

  .detail pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
  }

  .day,
  .gap {
    padding: 6px 12px;
    color: var(--sw-text-muted);
    font-family: var(--sw-font-sans);
    font-size: var(--sw-text-xs);
    font-weight: 600;
  }

  .day {
    position: sticky;
    top: -4px;
    background: var(--sw-bg-input);
  }

  .gap {
    font-weight: 400;
    font-style: italic;
    border-top: 1px dashed var(--sw-border-default);
    border-bottom: 1px dashed var(--sw-border-default);
  }

  .unseen {
    position: absolute;
    top: 8px;
    left: 50%;
    z-index: 1;
    transform: translateX(-50%);
    padding: 4px 12px;
    border: 1px solid var(--sw-accent-glow-strong);
    border-radius: var(--sw-radius-pill);
    background: var(--sw-bg-elevated);
    color: var(--sw-accent);
    font-size: var(--sw-text-xs);
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--sw-shadow-elevated);
  }

  .note {
    margin: 0;
    padding: 20px;
    color: var(--sw-text-muted);
    font-size: var(--sw-text-sm);
    text-align: center;
  }

  .more {
    display: flex;
    justify-content: center;
    margin-top: 12px;
  }

  .end {
    margin: 12px 0 0;
    color: var(--sw-text-muted);
    font-size: var(--sw-text-xs);
    text-align: center;
  }

  @media (max-width: 720px) {
    .levels {
      flex-basis: 100%;
    }

    .search {
      max-width: none;
    }

    .line {
      grid-template-columns: auto auto minmax(0, 1fr);
    }

    .text {
      grid-column: 1 / -1;
    }

    .source {
      grid-row: 1;
      grid-column: 3;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: right;
    }

    .detail {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
      padding-left: 12px;
    }

    .detail dd {
      margin-bottom: 6px;
    }
  }
</style>
