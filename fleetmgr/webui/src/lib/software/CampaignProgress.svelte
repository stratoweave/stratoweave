<script lang="ts">
  import { CELL_COLOR, CELL_LABEL } from '#lib/software/cells.ts';
  import type { CampaignCounters } from '#lib/software/model.ts';
  import { progressOf } from '#lib/software/progress.ts';

  interface Props {
    counters: CampaignCounters | null;
    /** The members held because they have not answered, from the last
     * rows read; without rows they count as held. */
    notAnswered?: number;
    /** hero renders the 30px bar with the full legend; compact a 7px bar */
    compact?: boolean;
  }

  let { counters, notAnswered = 0, compact = false }: Props = $props();

  interface Segment {
    name: string;
    n: number;
    color: string;
    hint: string;
    pulse?: boolean;
    /** Listed in the legend only while it counts any member. */
    situational?: boolean;
  }

  // The legend lists the usual entries, zero or not, so they do not shift
  // as a count crosses zero, and the situational ones while they count any
  // member; the bar only draws the non-empty ones.
  let segments = $derived.by((): Segment[] => {
    if (counters === null) return [];
    const p = progressOf(counters, notAnswered);
    return [
      { name: CELL_LABEL.upgraded, n: p.upgraded, color: 'var(--sw-success)', hint: 'upgraded by this campaign' },
      {
        name: CELL_LABEL['up-to-date'],
        n: p.upToDate,
        color: CELL_COLOR['up-to-date'],
        hint: 'ran the target release already: nothing to install',
        situational: true
      },
      { name: CELL_LABEL['in-progress'], n: p.inProgress, color: 'var(--sw-accent)', hint: 'upgrading now', pulse: true },
      { name: CELL_LABEL.failed, n: p.failed, color: 'var(--sw-danger)', hint: 'failed or rolled back' },
      {
        name: CELL_LABEL.held,
        n: p.held,
        color: 'var(--sw-warning)',
        hint: 'may not start now: down, behind a group member, or over the failure budget',
        situational: true
      },
      {
        name: CELL_LABEL['not-answered'],
        n: p.notAnswered,
        color: CELL_COLOR['not-answered'],
        hint: 'has not said whether it needs the upgrade',
        situational: true
      },
      {
        name: CELL_LABEL.waiting,
        n: p.waiting,
        color: 'var(--sw-bar-rest)',
        hint: 'needs the upgrade and waits for its turn'
      }
    ];
  });
  let bars = $derived(segments.filter((s) => s.n > 0));
  let listed = $derived(segments.filter((s) => s.n > 0 || !s.situational));
  let label = $derived(segments.map((s) => `${s.n} ${s.name}`).join(', '));

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
      aria-label={`${total} devices: ${label}`}
    >
      {#each bars as s, i (s.name)}
        <div
          class="seg"
          class:pulse={s.pulse}
          class:separated={i < bars.length - 1}
          style:width={width(s.n, total)}
          style:background={s.color}
          title={s.hint}
        ></div>
      {/each}
    </div>
    {#if !compact}
      <div class="legend">
        {#each listed as s (s.name)}
          <div class="entry" class:empty={s.n === 0} title={s.hint}>
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
    border-radius: var(--sw-radius-sm);
    overflow: hidden;
    background: var(--sw-bg-deep);
  }

  .bar.compact {
    height: 7px;
    border-radius: var(--sw-radius-xs);
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
    border-radius: var(--sw-radius-xs);
    align-self: center;
  }

  /* A zero entry recedes by colour, not opacity, so it keeps 4.5:1. */
  .entry.empty .name,
  .entry.empty .n {
    color: var(--sw-text-muted);
    font-weight: 400;
  }

  .entry.empty .swatch {
    opacity: 0.5;
  }

  .name {
    font-size: var(--sw-text-sm);
    color: var(--sw-text-secondary);
  }

  .n {
    font-size: var(--sw-text-lg);
    font-weight: 600;
    color: var(--sw-text-primary);
  }

  .pct {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
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
