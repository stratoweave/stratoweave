// The campaign page's live data: the loader's snapshot, kept fresh by one
// tick every FAST_MS that decides what to read. A campaign of up to
// FAST_ENTRY_LIMIT members gets its state node every tick; a larger one
// its four counter leaves every tick, and its state every SLOW_MS, or
// FAILED_GAP_MS after the last one when `failed` moved. The config comes
// every SLOW_MS with content=config, which is also how an outside change
// or a deletion shows. Without published state the tick reads the whole
// entry instead: it is small then, and it tells a campaign that has not
// reported yet from one that was deleted.
//
// Every read takes a sequence number when it starts. What it brings back
// is used only if it is newer than what is shown of its kind, started
// after the page's last write, and is for the campaign still on the page;
// reads that can no longer count are aborted.

import { nextSeq } from '$lib/core/polling/poller';
import { withSignal } from '$lib/core/restconf/client';
import { FAST_ENTRY_LIMIT, fetchCampaignEntry, fetchCampaignState, fetchCounters } from './counters';
import type { CampaignConfig, CampaignCounters, StateParts } from './model';
import { RateTracker } from './rate';

export const FAST_MS = 1500;
export const SLOW_MS = 12_000;
export const FAILED_GAP_MS = SLOW_MS / 2;

export interface LiveView {
  name: string;
  /** undefined until a read succeeds; null when there is no such campaign. */
  config: CampaignConfig | null | undefined;
  /** The sequence number of the newest read that got through. */
  seq: number;
  /** null while the campaign has published no state. */
  state: StateParts | null;
  counters: CampaignCounters | null;
  /** Devices finished per minute and the ms left, measured since the page
   * opened. */
  rate: number | null;
  eta: number | null;
}

interface Stamped<T> {
  seq: number;
  value: T;
}

function sameConfig(a: CampaignConfig | null | undefined, b: CampaignConfig | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (Object.keys(a) as (keyof CampaignConfig)[]).every((key) => {
    const x = a[key];
    const y = b[key];
    return Array.isArray(x) && Array.isArray(y) ? x.length === y.length && x.every((v, i) => v === y[i]) : x === y;
  });
}

export class CampaignLive {
  private name = '';
  private config: Stamped<CampaignConfig | null | undefined> = { seq: 0, value: undefined };
  private state: Stamped<StateParts | null> = { seq: 0, value: null };
  private counters: Stamped<CampaignCounters | null> = { seq: 0, value: null };
  /** Reads that started before this are dropped: they may predate a write. */
  private barrier = 0;
  private aborter = new AbortController();
  private stateRead: Promise<void> | null = null;
  /** When the last state and config reads started, ms. */
  private stateAt = 0;
  private configAt = 0;
  private lastFailed: number | null = null;
  private failedMoved = false;
  private tracker = new RateTracker();
  private rate: number | null = null;
  private eta: number | null = null;
  private disposed = false;

  constructor(
    private readonly onchange: (view: LiveView) => void,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly clock: () => number = Date.now
  ) {}

  /** The loader's data: on open, after navigation, a refresh or a write.
   * `config` undefined means the load failed: what is shown stays and the
   * ticks keep trying. Another campaign starts from nothing. */
  load(name: string, seq: number, config: CampaignConfig | null | undefined, state: StateParts | null): void {
    if (this.disposed) return;
    if (name !== this.name) this.reset(name);
    if (config !== undefined && seq >= this.barrier) {
      const t = this.clock();
      if (this.applyConfig(seq, config)) this.configAt = t;
      if (this.applyState(seq, state)) this.stateAt = t;
    }
    this.emit();
  }

  /** One round of reads. Never rejects. */
  async tick(): Promise<void> {
    const name = this.name;
    const config = this.config.value;
    if (this.disposed || name === '' || config === null) return;
    const signal = this.aborter.signal;
    try {
      if (config === undefined || this.state.value === null) {
        await this.readEntry(name, false, signal);
        return;
      }
      const t = this.clock();
      const reads: Promise<void>[] = [];
      reads.push(this.stateDue(config, t) ? this.readState() : this.readCounters(name, signal));
      if (t - this.configAt >= SLOW_MS) reads.push(this.readEntry(name, true, signal));
      await Promise.allSettled(reads);
    } catch {
      // keep what is shown; the next tick tries again
    }
  }

  /** A write went through: drop and cancel the reads that started before
   * it. The page reloads right after. */
  wrote(): void {
    this.barrier = nextSeq();
    this.abortReads();
  }

  dispose(): void {
    this.disposed = true;
    this.abortReads();
  }

  view(): LiveView {
    const counters =
      this.counters.seq > this.state.seq ? this.counters.value : (this.state.value?.counters ?? null);
    return {
      name: this.name,
      config: this.config.value,
      seq: Math.max(this.config.seq, this.state.seq, this.counters.seq),
      state: this.state.value,
      counters,
      rate: this.rate,
      eta: this.eta
    };
  }

  private reset(name: string): void {
    this.abortReads();
    this.name = name;
    this.config = { seq: 0, value: undefined };
    this.state = { seq: 0, value: null };
    this.counters = { seq: 0, value: null };
    this.barrier = 0;
    this.stateAt = 0;
    this.configAt = 0;
    this.lastFailed = null;
    this.failedMoved = false;
    this.tracker.reset();
    this.rate = null;
    this.eta = null;
  }

  private abortReads(): void {
    this.aborter.abort();
    this.aborter = new AbortController();
    this.stateRead = null;
  }

  private current(name: string, seq: number): boolean {
    return !this.disposed && name === this.name && seq >= this.barrier;
  }

  private stateDue(config: CampaignConfig, t: number): boolean {
    if (config.devices.length <= FAST_ENTRY_LIMIT) return true;
    const since = t - this.stateAt;
    return since >= SLOW_MS || (this.failedMoved && since >= FAILED_GAP_MS);
  }

  /** The state node. Whoever asks while it is in flight gets the same read. */
  private readState(): Promise<void> {
    if (this.stateRead !== null) return this.stateRead;
    const name = this.name;
    const signal = this.aborter.signal;
    const seq = nextSeq();
    this.stateAt = this.clock();
    this.failedMoved = false;
    const read = (async () => {
      const parts = await fetchCampaignState(name, withSignal(signal, this.fetchFn));
      if (!this.current(name, seq)) return;
      if (parts === null) {
        // Gone: not published any more, or the campaign was deleted.
        await this.readEntry(name, false, signal);
        return;
      }
      if (this.applyState(seq, parts)) this.emit();
    })();
    this.stateRead = read;
    const done = () => {
      if (this.stateRead === read) this.stateRead = null;
    };
    read.then(done, done);
    return read;
  }

  private async readCounters(name: string, signal: AbortSignal): Promise<void> {
    const seq = nextSeq();
    const counters = await fetchCounters(name, withSignal(signal, this.fetchFn));
    if (!this.current(name, seq)) return;
    if (counters === null) {
      await this.readEntry(name, false, signal);
      return;
    }
    if (this.applyCounters(seq, counters)) this.emit();
  }

  /** The entry, config only or with its state. A 404 means the campaign
   * was deleted. */
  private async readEntry(name: string, configOnly: boolean, signal: AbortSignal): Promise<void> {
    const seq = nextSeq();
    this.configAt = this.clock();
    const entry = await fetchCampaignEntry(name, configOnly, withSignal(signal, this.fetchFn));
    if (!this.current(name, seq)) return;
    this.applyConfig(seq, entry === null ? null : entry.config);
    if (!configOnly && entry !== null && this.applyState(seq, entry.state)) this.stateAt = this.clock();
    this.emit();
  }

  private applyConfig(seq: number, value: CampaignConfig | null): boolean {
    if (seq <= this.config.seq) return false;
    // An unchanged config keeps its object, so nothing on the page redraws.
    this.config = { seq, value: sameConfig(this.config.value, value) ? (this.config.value ?? null) : value };
    return true;
  }

  private applyState(seq: number, value: StateParts | null): boolean {
    if (seq <= this.state.seq) return false;
    const newest = seq > this.counters.seq;
    this.state = { seq, value };
    if (newest && value?.counters) this.observe(value.counters);
    return true;
  }

  private applyCounters(seq: number, value: CampaignCounters): boolean {
    if (seq <= this.counters.seq || seq <= this.state.seq) return false;
    this.counters = { seq, value };
    this.observe(value);
    return true;
  }

  /** Failure tracking and the rate, from counters newer than any before. */
  private observe(c: CampaignCounters): void {
    if (this.lastFailed !== null && c.failed !== this.lastFailed) this.failedMoved = true;
    this.lastFailed = c.failed;
    if (this.config.value?.adminState !== 'run') return;
    this.tracker.push(c.succeeded + c.failed, this.clock());
    this.rate = this.tracker.ratePerMin();
    const remaining = c.total - c.succeeded - c.failed;
    this.eta = remaining > 0 ? this.tracker.etaMs(remaining) : null;
  }

  private emit(): void {
    if (!this.disposed) this.onchange(this.view());
  }
}
