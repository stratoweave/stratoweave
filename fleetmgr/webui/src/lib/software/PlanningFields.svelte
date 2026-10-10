<script lang="ts">
  import FieldDateTime from '$lib/core/ui/FieldDateTime.svelte';
  import FieldSelect from '$lib/core/ui/FieldSelect.svelte';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import { scheduleRulesText } from '$lib/maintenance/schedule-form';
  import { DEFAULT_MAX_RATE, DEFAULT_TARGET_RATE, type Schedule } from './model';
  import { atOnceText, type PaceBy, type PlanningDraft } from './planning-form';
  import { formatDuration, toLocalInput } from '$lib/core/time';

  interface Props {
    schedules: Schedule[];
    draft: PlanningDraft;
    /** By field: deadline, target-rate, max-rate. */
    errors: Record<string, string>;
    disabled?: boolean;
    /** Mean install time in seconds, from the plan; without it the rates
     * are not shown as devices at once. */
    installSeconds?: number | null;
    onchange: (next: PlanningDraft) => void;
  }

  let { schedules, draft, errors, disabled = false, installSeconds = null, onchange }: Props = $props();

  const uid = $props.id();

  const PACES: { value: PaceBy; label: string; help: string }[] = [
    { value: 'deadline', label: 'Deadline', help: 'Slowest pace that meets the deadline.' },
    { value: 'rate', label: 'Target rate', help: 'No deadline; the target rate sets the pace.' }
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

  let atOnce = $derived(installSeconds ? atOnceText(draft, installSeconds) : '');

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
        label="Target rate"
        value={draft.targetRate}
        error={errors['target-rate']}
        mono={true}
        {disabled}
        placeholder={`${DEFAULT_TARGET_RATE}`}
        help="Devices per hour; 0 = spread over the windows."
        onchange={(v) => patch({ targetRate: v })}
      />
    {/if}
    <FieldText
      label="Max rate"
      value={draft.maxRate}
      error={errors['max-rate']}
      mono={true}
      {disabled}
      placeholder={`${DEFAULT_MAX_RATE}`}
      help="Devices per hour; 0 = no cap."
      onchange={(v) => patch({ maxRate: v })}
    />
  </div>
  {#if atOnce}
    <p class="at-once">{atOnce}</p>
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

  .at-once {
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
