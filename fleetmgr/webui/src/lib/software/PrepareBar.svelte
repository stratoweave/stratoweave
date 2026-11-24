<script lang="ts">
  // Preparing ahead as one bar over the plan: of the members that prepare
  // ahead, the prepared ones, the ones preparing and the failed ones; the
  // rest of the track is still to start. Which member is which shows on
  // the timeline's cells. The Prepare chip in front of it hides the bar and
  // tells the page to hide its other prepare information too.
  import { PREPARE_COLOR } from '#lib/software/cells.ts';
  import { preparesLeft, prepareTally, type PrepareView } from '#lib/software/prepare.ts';
  import { formatDayClock } from '#lib/core/time.ts';

  interface Props {
    /** Each member that prepares ahead, by name; see prepare.ts. */
    prepare: Map<string, PrepareView>;
    /** Unix seconds, ticking. */
    now: number;
    /** Whether prepare information is shown. */
    shown: boolean;
    onchange: (shown: boolean) => void;
  }

  let { prepare, now, shown, onchange }: Props = $props();

  /** The most failed members the tooltip names. */
  const NAMED = 20;

  let tally = $derived(prepareTally(prepare));
  let total = $derived(prepare.size);
  // A released member prepared before its window run took over.
  let got = $derived(tally.prepared + tally.released);

  let failed = $derived([...prepare].filter(([, v]) => v.state === 'failed').map(([name]) => name));

  /** The whole state in words, for the tooltip. */
  let detail = $derived.by(() => {
    let text = `${got.toLocaleString()} of ${total.toLocaleString()} prepared, ${tally.preparing.toLocaleString()} preparing, ${tally.failed.toLocaleString()} failed`;
    if (preparesLeft(tally) && tally.last !== null) text += `, last one starts ${formatDayClock(tally.last, now)}`;
    if (failed.length > 0) {
      text += `\nFailed: ${failed.slice(0, NAMED).join(', ')}${failed.length > NAMED ? ', ...' : ''}`;
    }
    return text;
  });

  function share(n: number): string {
    return `${(n / Math.max(1, total)) * 100}%`;
  }
</script>

{#if total > 0}
  <div class="prep" class:off={!shown}>
    <button class="chip" class:active={shown} type="button" aria-pressed={shown} onclick={() => onchange(!shown)}>
      Prepare
    </button>
    {#if shown}
      <span class="track" role="img" aria-label={detail} title={detail} style:background={PREPARE_COLOR.scheduled}>
        <span style:width={share(got)} style:background={PREPARE_COLOR.prepared}></span>
        <span style:width={share(tally.preparing)} style:background={PREPARE_COLOR.preparing}></span>
        <!-- A few failures among thousands still show. -->
        <span
          style:width={share(tally.failed)}
          style:min-width={tally.failed > 0 ? '3px' : null}
          style:background={PREPARE_COLOR.failed}
        ></span>
      </span>
      <span class="count mono" title={detail}>
        {got.toLocaleString()} / {total.toLocaleString()}{#if tally.failed > 0}{' · '}<span class="failed"
            >{tally.failed.toLocaleString()} failed</span
          >{/if}
      </span>
    {/if}
  </div>
{/if}

<style>
  .prep {
    display: grid;
    grid-template-columns: auto minmax(40px, 1fr) auto;
    align-items: center;
    gap: 6px 14px;
    margin-bottom: 14px;
    font-size: var(--sw-text-sm);
  }

  .prep.off {
    display: block;
  }

  .track {
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
  }

  .track span {
    flex: none;
  }

  .count {
    color: var(--sw-text-primary);
    white-space: nowrap;
  }

  .failed {
    color: var(--sw-warning);
  }
</style>
