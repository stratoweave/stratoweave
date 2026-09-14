<script lang="ts">
  import type { CampaignCounters } from '$lib/software/model';

  interface Props {
    counters: CampaignCounters | null;
    /** hero renders the 30px bar with the full legend; compact a 7px bar */
    compact?: boolean;
  }

  let { counters, compact = false }: Props = $props();

  const REMAINDER_HINT = 'pending or unknown';

  interface Segment {
    name: string;
    n: number;
    color: string;
    hint?: string;
    pulse?: boolean;
  }

  let segments = $derived.by((): Segment[] => {
    if (counters === null) return [];
    return [
      { name: 'succeeded', n: counters.succeeded, color: 'var(--sw-success)' },
      { name: 'in progress', n: counters.inProgress, color: 'var(--sw-accent)', pulse: true },
      { name: 'failed', n: counters.failed, color: 'var(--sw-danger)' },
      { name: 'waiting', n: counters.remainder, color: 'var(--sw-bar-rest)', hint: REMAINDER_HINT }
    ].filter((s) => s.n > 0);
  });

  function pct(n: number, total: number): string {
    return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0%';
  }

  function width(n: number, total: number): string {
    return total > 0 ? `${(n / total) * 100}%` : '0%';
  }
</script>

{#if counters !== null}
  {@const total = counters.total}
  <div class="progress">
    <div
      class="bar"
      class:compact
      role="img"
      aria-label={`${counters.succeeded} of ${total} succeeded, ${counters.failed} failed, ${counters.inProgress} in progress`}
    >
      {#each segments as s, i (s.name)}
        <div
          class="seg"
          class:pulse={s.pulse}
          class:separated={i < segments.length - 1}
          style:width={width(s.n, total)}
          style:background={s.color}
          title={s.hint}
        ></div>
      {/each}
    </div>
    {#if !compact}
      <div class="legend">
        {#each segments as s (s.name)}
          <div class="entry" title={s.hint}>
            <span class="swatch" style:background={s.color}></span>
            <span class="name">{s.name}</span>
            <span class="n tn">{s.n.toLocaleString()}</span>
            <span class="pct tn">{pct(s.n, total)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .progress {
    display: grid;
    gap: 11px;
  }

  .bar {
    display: flex;
    height: 30px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--sw-bg-deep);
  }

  .bar.compact {
    height: 7px;
    border-radius: 4px;
  }

  .seg {
    height: 100%;
    transition: width 0.4s ease;
  }

  .seg.separated {
    border-right: 1px solid var(--sw-bg-deep);
  }

  .seg.pulse {
    animation: seg-pulse 1.6s ease-in-out infinite;
  }

  .legend {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
  }

  .entry {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    align-self: center;
  }

  .name {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    font-size: 12px;
    color: var(--sw-text-secondary);
  }

  .n {
    font-size: 15px;
    font-weight: 600;
    color: var(--sw-text-primary);
  }

  .pct {
    font-size: 11.5px;
    color: var(--sw-text-muted);
  }

  .tn {
    font-variant-numeric: tabular-nums;
  }

  @keyframes seg-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
</style>
