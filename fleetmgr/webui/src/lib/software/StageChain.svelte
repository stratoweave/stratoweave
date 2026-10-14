<script lang="ts">
  import { STEPS, STEP_LABEL, type DeviceStatusRow, type Step } from '$lib/software/model';
  import { stageView, type RollbackState, type StepState } from '$lib/software/stages';
  import { formatClock } from '$lib/core/time';

  interface Props {
    /** Without a row the chain shows the step names, for a table header. */
    row?: DeviceStatusRow;
    /** Bigger, with the step names under the dots, for one device. */
    large?: boolean;
  }

  let { row, large = false }: Props = $props();
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
    class:large
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
        <span class="pin">
          <span class="dot {s.state}">
            {#if s.state === 'failed'}
              <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 3l4 4M7 3l-4 4" /></svg>
            {/if}
          </span>
        </span>
        {#if large}
          <span class="name {s.state}">{STEP_LABEL[s.step]}</span>
        {/if}
      </span>
    {/each}
    <!-- A large chain has no header to line up with. -->
    {#if !large || view.rollback}
      <span class="end">
        {#if view.rollback}
          <span class="pin">
            <svg class="rollback {view.rollback}" viewBox="0 0 16 16" role="img">
              <title>{ROLLBACK_TEXT[view.rollback]}</title>
              <path d="M3.1 6.2A5.2 5.2 0 1 0 5.4 3.5M5.4 3.5l2.9.5M5.4 3.5l1-2.8" />
            </svg>
          </span>
          {#if large}
            <span class="name {view.rollback}">{ROLLBACK_TEXT[view.rollback]}</span>
          {/if}
        {/if}
      </span>
    {/if}
  </span>
{/if}

<style>
  .chain {
    --cell: 56px;
    --end: 20px;
    --track: 16px;
    --line: 2px;
    --ring: 2px;
    --dot: 10px;
    --dot-running: 12px;
    --dot-failed: 14px;
    --cross: 10px;
    --icon: 16px;
    display: inline-flex;
    align-items: flex-start;
    vertical-align: middle;
  }

  /* Cells share the width, so the chain narrows with the page. */
  .chain.large {
    --end: 100px;
    --track: 32px;
    --line: 3px;
    --ring: 3px;
    --dot: 22px;
    --dot-running: 24px;
    --dot-failed: 30px;
    --cross: 14px;
    --icon: 28px;
    display: flex;
    width: min(100%, 850px);
  }

  .large .cell {
    flex: 1 1 0;
    min-width: 0;
  }

  /* One cell per step, so the header names sit over the dots. */
  .cell,
  .end {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: var(--cell);
    min-height: var(--track);
  }

  .end {
    width: var(--end);
    flex: none;
  }

  /* Holds the dot, so the links meet its middle whatever its size. */
  .pin {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--track);
  }

  /* Each cell draws half of the link on either side of its dot, up to
     the edge of the dot. */
  .line::before,
  .line::after {
    content: '';
    position: absolute;
    top: calc((var(--track) - var(--line)) / 2);
    height: var(--line);
    background: var(--sw-border-default);
  }

  .line::before {
    left: 0;
    right: calc(50% + var(--dot) / 2);
  }

  .line::after {
    left: calc(50% + var(--dot) / 2);
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
    font-size: var(--sw-text-2xs);
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    color: var(--sw-text-muted);
    white-space: nowrap;
  }

  .name {
    font-size: var(--sw-text-md);
    font-weight: 600;
    line-height: 1.2;
    color: var(--sw-text-muted);
    white-space: nowrap;
  }

  .name.done {
    color: var(--sw-text-secondary);
  }

  .name.running {
    color: var(--sw-accent);
  }

  .name.failed {
    color: var(--sw-danger-text);
  }

  /* Five names do not fit side by side on a phone: they shrink and break
     at their hyphens, under narrower ends. */
  @media (max-width: 560px) {
    .chain.large {
      --end: 8px;
      --dot: 18px;
      --dot-running: 20px;
      --dot-failed: 24px;
    }

    .large .name {
      font-size: var(--sw-text-2xs);
      white-space: normal;
      text-align: center;
      overflow-wrap: anywhere;
    }
  }

  .dot {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--dot);
    height: var(--dot);
    border-radius: 50%;
    border: var(--ring) solid var(--sw-border-default);
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
    width: var(--dot-running);
    height: var(--dot-running);
    border-color: var(--sw-accent);
    background: var(--sw-accent);
    animation: ring 1.6s var(--sw-ease) infinite;
  }

  .dot.failed {
    width: var(--dot-failed);
    height: var(--dot-failed);
    border-color: var(--sw-danger);
    background: var(--sw-danger);
  }

  .dot svg {
    width: var(--cross);
    height: var(--cross);
    stroke: var(--sw-paper);
    stroke-width: 1.8;
    stroke-linecap: round;
  }

  .rollback {
    width: var(--icon);
    height: var(--icon);
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
    stroke: var(--sw-danger-text);
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
