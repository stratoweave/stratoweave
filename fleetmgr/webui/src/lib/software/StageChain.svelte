<script lang="ts">
  import { STEPS, STEP_LABEL, type DeviceStatusRow, type Step } from '$lib/software/model';
  import { stageView, type RollbackState, type StepState } from '$lib/software/stages';
  import { formatClock } from '$lib/software/time';

  interface Props {
    /** Without a row the chain shows the step names, for a table header. */
    row?: DeviceStatusRow;
  }

  let { row }: Props = $props();
  let view = $derived(row ? stageView(row) : null);

  const STATE_TEXT: Record<StepState, string> = {
    done: 'done',
    running: 'running',
    failed: 'failed',
    todo: 'not reached',
    skipped: 'not needed'
  };

  const ROLLBACK_TEXT: Record<RollbackState, string> = {
    running: 'rolling back',
    done: 'rolled back',
    failed: 'rollback failed'
  };

  /** The step and its state; a check adds its verdict, detail and time. */
  function title(r: DeviceStatusRow, step: Step, state: StepState): string {
    const check = step === 'precheck' ? r.precheck : step === 'postcheck' ? r.postcheck : null;
    if (check === null || check.verdict === 'not-run') return `${STEP_LABEL[step]}: ${STATE_TEXT[state]}`;
    return [
      `${STEP_LABEL[step]}: ${check.verdict}`,
      check.detail,
      check.at !== null ? formatClock(check.at) : ''
    ]
      .filter((s) => s)
      .join(' · ');
  }
</script>

{#if view === null}
  <span class="chain">
    {#each STEPS as step (step)}
      <span class="cell"><span class="label">{STEP_LABEL[step]}</span></span>
    {/each}
    <span class="end"></span>
  </span>
{:else}
  <span
    class="chain"
    role="img"
    aria-label={view.steps
      .map((s) => `${STEP_LABEL[s.step]} ${STATE_TEXT[s.state]}`)
      .concat(view.rollback ? [ROLLBACK_TEXT[view.rollback]] : [])
      .join(', ')}
  >
    {#each view.steps as s, i (s.step)}
      <span
        class="cell line"
        class:first={i === 0}
        class:last={i === view.steps.length - 1}
        class:from-done={i > 0 && view.steps[i - 1].state === 'done'}
        class:to-done={s.state === 'done'}
        title={title(row!, s.step, s.state)}
      >
        <span class="dot {s.state}">
          {#if s.state === 'failed'}
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 3l4 4M7 3l-4 4" /></svg>
          {/if}
        </span>
      </span>
    {/each}
    <span class="end">
      {#if view.rollback}
        <svg class="rollback {view.rollback}" viewBox="0 0 16 16" role="img">
          <title>{ROLLBACK_TEXT[view.rollback]}</title>
          <path d="M3.1 6.2A5.2 5.2 0 1 0 5.4 3.5M5.4 3.5l2.9.5M5.4 3.5l1-2.8" />
        </svg>
      {/if}
    </span>
  </span>
{/if}

<style>
  .chain {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
  }

  /* One cell per step, so the header names sit over the dots. */
  .cell {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 16px;
  }

  /* Each cell draws half of the link on either side of its dot, up to
     the edge of a 10px dot. */
  .line::before,
  .line::after {
    content: '';
    position: absolute;
    top: 7px;
    height: 2px;
    background: var(--sw-border-default);
  }

  .line::before {
    left: 0;
    right: calc(50% + 5px);
  }

  .line::after {
    left: calc(50% + 5px);
    right: 0;
  }

  .line.first::before,
  .line.last::after {
    display: none;
  }

  .line.from-done::before,
  .line.to-done::after {
    background: var(--sw-success);
  }

  .label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    color: var(--sw-text-muted);
    white-space: nowrap;
  }

  .dot {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--sw-border-default);
  }

  .dot.done {
    border-color: var(--sw-success);
    background: var(--sw-success);
  }

  .dot.skipped {
    border-color: var(--sw-bar-rest);
    background: var(--sw-bar-rest);
  }

  .dot.running {
    width: 12px;
    height: 12px;
    border-color: var(--sw-accent);
    background: var(--sw-accent);
    animation: ring 1.6s var(--sw-ease) infinite;
  }

  .dot.failed {
    width: 14px;
    height: 14px;
    border-color: var(--sw-danger);
    background: var(--sw-danger);
  }

  .dot svg {
    width: 10px;
    height: 10px;
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linecap: round;
  }

  .end {
    display: inline-flex;
    justify-content: center;
    width: 20px;
  }

  .rollback {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--sw-text-secondary);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .rollback.running {
    stroke: var(--sw-accent);
    animation: fade 1.6s var(--sw-ease) infinite;
  }

  .rollback.failed {
    stroke: var(--sw-danger);
  }

  @keyframes ring {
    0% {
      box-shadow: 0 0 0 0 rgb(var(--sw-accent-rgb) / 0.55);
    }
    100% {
      box-shadow: 0 0 0 7px rgb(var(--sw-accent-rgb) / 0);
    }
  }

  @keyframes fade {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
