<script lang="ts">
  import FieldDateTime from '$lib/core/ui/FieldDateTime.svelte';
  import FieldSelect from '$lib/core/ui/FieldSelect.svelte';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import { scheduleRulesText } from '$lib/maintenance/schedule-form';
  import { DEFAULT_MAX_CONCURRENCY, DEFAULT_TARGET_CONCURRENCY, type Schedule } from './model';
  import { perHourText, type PaceBy, type PlanningDraft } from './planning-form';
  import { formatDuration, toLocalInput } from '$lib/core/time';

  interface Props {
    schedules: Schedule[];
    draft: PlanningDraft;
    /** By field: deadline, target-concurrency, max-concurrency. */
    errors: Record<string, string>;
    disabled?: boolean;
    /** Mean install time in seconds, from the plan; without it the devices
     * at once are not shown as devices per hour. */
    installSeconds?: number | null;
    onchange: (next: PlanningDraft) => void;
  }

  let { schedules, draft, errors, disabled = false, installSeconds = null, onchange }: Props = $props();

  const uid = $props.id();

  const PACES: { value: PaceBy; label: string; help: string }[] = [
    { value: 'deadline', label: 'Deadline', help: 'Slowest pace that meets the deadline.' },
    { value: 'concurrency', label: 'At once', help: 'No deadline; this many devices upgrade at the same time.' }
  ];

  let scheduleOptions = $derived.by(() => {
    const options = [
      { value: '', label: 'none — one always-open window when no member is bound' },
      ...schedules.map((s) => ({ value: s.name, label: `${s.name} — ${scheduleRulesText(s)}` }))
    ];
    if (draft.defaultSchedule && !schedules.some((s) => s.name === draft.defaultSchedule)) {
      options.push({ value: draft.defaultSchedule, label: `${draft.defaultSchedule} (missing)` });
    }
    return options;
  });

  let minDeadline = toLocalInput(Date.now() / 1000);

  let perHour = $derived(installSeconds ? perHourText(draft, installSeconds) : '');

  let deadlineHint = $derived.by(() => {
    if (!draft.deadline) return '';
    const t = Date.parse(draft.deadline) / 1000;
    if (Number.isNaN(t)) return '';
    const left = t - Date.now() / 1000;
    if (left <= 0) return 'passed';
    return left < 60 ? 'in under a minute' : `in ${formatDuration(left - (left % 60))}`;
  });

  function patch(partial: Partial<PlanningDraft>): void {
    onchange({ ...draft, ...partial });
  }
</script>

<div class="planning">
  <FieldSelect
    label="Default schedule"
    value={draft.defaultSchedule}
    options={scheduleOptions}
    {disabled}
    onchange={(v) => patch({ defaultSchedule: v })}
  />
  <div class="row">
    <div class="field">
      <span class="field__label" id="{uid}-pace">Pace by</span>
      <div class="pace" role="radiogroup" aria-labelledby="{uid}-pace">
        {#each PACES as pace (pace.value)}
          <label class:active={draft.paceBy === pace.value} class:disabled>
            <input
              type="radio"
              name="{uid}-pace"
              value={pace.value}
              checked={draft.paceBy === pace.value}
              {disabled}
              onchange={() => patch({ paceBy: pace.value })}
            />
            {pace.label}
          </label>
        {/each}
      </div>
      <small class="field__meta">{PACES.find((p) => p.value === draft.paceBy)?.help}</small>
    </div>
    {#if draft.paceBy === 'deadline'}
      <FieldDateTime
        label="Deadline"
        value={draft.deadline}
        min={minDeadline}
        error={errors['deadline']}
        help={deadlineHint}
        {disabled}
        onchange={(v) => patch({ deadline: v })}
      />
    {:else}
      <FieldText
        label="At once"
        value={draft.targetConcurrency}
        error={errors['target-concurrency']}
        mono={true}
        {disabled}
        placeholder={`${DEFAULT_TARGET_CONCURRENCY}`}
        help="Devices upgrading at the same time."
        onchange={(v) => patch({ targetConcurrency: v })}
      />
    {/if}
    <FieldText
      label="Max at once"
      value={draft.maxConcurrency}
      error={errors['max-concurrency']}
      mono={true}
      {disabled}
      placeholder={`${DEFAULT_MAX_CONCURRENCY}`}
      help="Only when a window or the deadline falls behind."
      onchange={(v) => patch({ maxConcurrency: v })}
    />
  </div>
  {#if perHour}
    <p class="per-hour">{perHour}</p>
  {/if}
</div>

<style>
  .planning {
    display: grid;
    gap: 4px;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  .per-hour {
    margin: 0;
    font-size: 12px;
    color: var(--sw-text-secondary);
  }

  /* Two radios drawn as one segmented control, as tall as an input. */
  .pace {
    display: flex;
    gap: 3px;
    padding: 3px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
  }

  .pace label {
    position: relative;
    flex: 1;
    padding: 5px 10px;
    border: 1px solid transparent;
    border-radius: calc(var(--sw-radius-md) - 2px);
    color: var(--sw-text-secondary);
    font-size: 13px;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
  }

  .pace label:hover:not(.active, .disabled) {
    background: var(--sw-bg-hover);
    color: var(--sw-text-primary);
  }

  .pace label.active {
    border-color: var(--sw-accent-glow-strong);
    background: var(--sw-accent-glow);
    color: var(--sw-accent-bright);
  }

  .pace label.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pace label:has(input:focus-visible) {
    box-shadow: 0 0 0 2px var(--sw-accent);
  }

  .pace input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    opacity: 0;
    pointer-events: none;
  }
</style>
