// Where a device's upgrade run is, as the chain of its steps.

import { STEPS, STEP_LABEL, type DeviceStatusRow, type Step } from './model';

/** skipped: the device was already on the target, so no step ran. */
export type StepState = 'done' | 'running' | 'failed' | 'todo' | 'skipped';
export type RollbackState = 'running' | 'done' | 'failed';

export interface StageView {
  steps: { step: Step; state: StepState }[];
  /** null when the run did not roll back. */
  rollback: RollbackState | null;
}

/** The steps before at are done, at is in state, the rest not reached. */
function chain(at: number, state: StepState, rollback: RollbackState | null = null): StageView {
  return {
    steps: STEPS.map((step, i) => ({ step, state: i < at ? 'done' : i === at ? state : 'todo' })),
    rollback
  };
}

/** The step a rollback followed. The post-check verdict tells a failed
 * commit (pass) from a failed post-check (fail) or one with no time left
 * to run (not-run). */
function rolledBackFrom(row: DeviceStatusRow): number {
  return STEPS.indexOf(row.postcheck.verdict === 'pass' ? 'commit' : 'postcheck');
}

export function stageView(row: DeviceStatusRow): StageView {
  const { status, stage } = row;
  switch (status) {
    case 'succeeded':
      return chain(STEPS.length, 'todo');
    case 'up-to-date':
      // A run that ended here, or nothing to do from the start.
      if (stage === 'commit') return chain(STEPS.length, 'todo');
      return { steps: STEPS.map((step) => ({ step, state: 'skipped' })), rollback: null };
    case 'rolled-back':
      return chain(rolledBackFrom(row), 'failed', 'done');
    case 'in-progress':
    case 'failed': {
      const now = status === 'in-progress' ? 'running' : 'failed';
      if (stage === 'rollback') return chain(rolledBackFrom(row), 'failed', now);
      if (stage !== null) return chain(STEPS.indexOf(stage), now);
      return chain(0, 'todo');
    }
    default:
      return chain(0, 'todo');
  }
}

/** One line on what the device is doing or what stopped it; empty when
 * the status says it all. */
export function stageDetail(row: DeviceStatusRow): string {
  const view = stageView(row);
  const running = view.steps.find((s) => s.state === 'running');
  if (running) return `${STEP_LABEL[running.step]} running`;
  if (view.steps[0].state === 'skipped') return 'already on the target release';
  const failed = view.steps.find((s) => s.state === 'failed');
  if (!failed) return '';
  let why = `${STEP_LABEL[failed.step]} failed`;
  if (failed.step === 'precheck' && row.precheck.verdict === 'fail') {
    why = `pre-check: ${row.precheck.detail}`;
  } else if (failed.step === 'postcheck' && row.postcheck.verdict === 'fail') {
    why = `post-check: ${row.postcheck.detail}`;
  } else if (failed.step === 'postcheck' && view.rollback !== null) {
    why = 'no time left to commit';
  }
  if (view.rollback === 'running') return `rolling back: ${why}`;
  if (view.rollback === 'failed') return `${why}; rollback failed`;
  return why;
}
