// The model has no timestamps, so rate and ETA are derived client-side
// from counter samples observed while the page is open.

interface Sample {
  t: number;
  settled: number;
}

export class RateTracker {
  private samples: Sample[] = [];

  constructor(private windowMs = 120_000) {}

  push(settled: number, t = Date.now()): void {
    this.samples.push({ t, settled });
    const cutoff = t - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }

  /** Settled devices per minute over the window; null until measurable. */
  ratePerMin(): number | null {
    if (this.samples.length < 2) {
      return null;
    }
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dtMin = (last.t - first.t) / 60_000;
    if (dtMin <= 0 || last.settled < first.settled) {
      // A settled count can regress (status is live, not latched); restart.
      this.samples = [last];
      return null;
    }
    return (last.settled - first.settled) / dtMin;
  }

  /** Milliseconds until `remaining` devices settle at the current rate. */
  etaMs(remaining: number): number | null {
    const rate = this.ratePerMin();
    if (rate === null || rate <= 0) {
      return null;
    }
    return (remaining / rate) * 60_000;
  }

  reset(): void {
    this.samples = [];
  }
}

export function formatEta(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}
