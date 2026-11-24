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

/** Whether the member ran the target release before the campaign touched
 * it, so no step ran: up-to-date from the start, not at the end of a run. */
export function alreadyOnTarget(row: DeviceStatusRow): boolean {
  return row.status === 'up-to-date' && row.stage !== 'commit';
}

/** How the prepare ahead of a member that waits for its window stands:
 * done, running (also while the device tries it again), or null when it
 * has not started or failed. A prepare job left from another intent does
 * not count. */
function preparedAhead(row: DeviceStatusRow): 'done' | 'running' | null {
  const job = row.prepare;
  const current = !job.release || !row.targetRelease || job.release === row.targetRelease;
  if (row.status !== 'upgrade-needed' || !current) return null;
  if (job.state === 'retrying') return 'running';
  return job.state === 'done' || job.state === 'running' ? job.state : null;
}

export function stageView(row: DeviceStatusRow): StageView {
  const { status, stage } = row;
  switch (status) {
    case 'succeeded':
      return chain(STEPS.length, 'todo');
    case 'up-to-date':
      // A run that ended here, or nothing to do from the start.
      if (!alreadyOnTarget(row)) return chain(STEPS.length, 'todo');
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
    case 'upgrade-needed': {
      const ahead = preparedAhead(row);
      return ahead === 'done' ? chain(1, 'todo') : chain(0, ahead ?? 'todo');
    }
    default:
      return chain(0, 'todo');
  }
}

/** What the device does in the step that runs, as its job says: the
 * transfer of the prepare, the step of the install, or after the install
 * when the commit window ends. A device that waits for its window may
 * prepare ahead of it. A prepare job for an earlier prepare-attempt than
 * prepareAttempt, the member's, says that an ask to prepare again is on
 * its way. Empty when its job says nothing. */
export function jobDetail(row: DeviceStatusRow, prepareAttempt = 0): string {
  const { status, stage, prepare, install } = row;
  if (status === 'upgrade-needed') {
    if (prepare.state !== null && prepare.prepareAttempt < prepareAttempt) return 'waits to prepare again';
    if (prepare.state === 'running') return prepare.message ? `preparing · ${prepare.message}` : 'preparing';
    if (prepare.state === 'retrying') return `prepare retrying: ${prepare.message}`;
    if (prepare.state === 'failed') return `prepare failed: ${prepare.message}`;
    return prepare.state === 'done' ? 'prepared' : '';
  }
  if (status !== 'in-progress') return '';
  if (stage === 'prepare' && prepare.state === 'running') return prepare.message;
  if (stage === 'install' && install.state === 'running') return install.message;
  if ((stage === 'postcheck' || stage === 'commit') && install.state === 'done') return install.message;
  return '';
}

/** The percent of the image that the device has while its prepare
 * transfers it; null otherwise. */
export function jobProgress(row: DeviceStatusRow): number | null {
  const { status, stage, prepare } = row;
  const preparing = status === 'upgrade-needed' || (status === 'in-progress' && stage === 'prepare');
  return preparing && prepare.state === 'running' ? prepare.progress : null;
}

/** One line on what the device is doing or what stopped it; empty when
 * the status says it all. */
export function stageDetail(row: DeviceStatusRow): string {
  const view = stageView(row);
  const doing = jobDetail(row);
  // A waiting member's job says how its prepare ahead stands.
  if (row.status === 'upgrade-needed') return doing;
  const running = view.steps.find((s) => s.state === 'running');
  if (running) return `${STEP_LABEL[running.step]} running${doing ? ` · ${doing}` : ''}`;
  if (doing) return doing;
  if (view.steps[0].state === 'skipped') return 'already on the target release';
  const failed = view.steps.find((s) => s.state === 'failed');
  if (!failed) return '';
  const why = row.reason || `${STEP_LABEL[failed.step]} failed`;
  return view.rollback === 'running' ? `rolling back: ${why}` : why;
}
