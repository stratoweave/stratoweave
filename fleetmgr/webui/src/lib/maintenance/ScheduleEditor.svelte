<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';

  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import Section from '$lib/core/ui/Section.svelte';
  import {
    getListEntryPath,
    restconfDelete,
    restconfPatchJson,
    restconfPutJson,
    wrapListEntryBody
  } from '$lib/core/restconf/client';
  import WeekCalendar from '$lib/maintenance/WeekCalendar.svelte';
  import { HORIZON_DAYS, WEEKDAYS, occurrences } from '$lib/maintenance/occurrences';
  import { scheduleColors } from '$lib/maintenance/palette';
  import {
    draftFromSchedule,
    draftToSchedule,
    emptyDraft,
    formatTimeOfDay,
    newWindowDraft,
    parseTimeOfDay,
    parseUtcOffset,
    rowOfRule,
    ruleText,
    scheduleCreatePatch,
    scheduleToJson,
    validateScheduleDraft,
    type ScheduleDraft,
    type ScheduleUsage,
    type WindowDraft
  } from '$lib/maintenance/schedule-form';
  import { DATA_ROOT, SCHEDULE_LIST_ROOT, type MaintenanceWindow, type Schedule } from '$lib/software/model';
  import { clockLabel, dayLabel, sameLocalDay } from '$lib/software/plan-timeline';
  import { formatDuration, parseDuration } from '$lib/software/time';

  interface Props {
    /** null creates a new schedule. */
    schedule: Schedule | null;
    existingNames: string[];
    usage: ScheduleUsage;
    /** Unix seconds. */
    now: number;
  }

  let { schedule, existingNames, usage, now }: Props = $props();

  const isNew = untrack(() => schedule === null);
  let draft = $state<ScheduleDraft>(untrack(() => (schedule ? draftFromSchedule(schedule) : emptyDraft())));
  let touched = $state(false);
  let validationKey = $state(0);
  let saving = $state(false);
  let deleting = $state(false);
  let confirmDelete = $state(false);
  let statusMessage = $state<string>('');

  let validation = $derived(validateScheduleDraft(draft, existingNames, isNew));
  let errors = $derived(touched ? validation.errors : ({} as Record<string, string>));

  // The calendar follows the draft as it is typed: rows that do not parse
  // yet are simply not drawn.
  let preview = $derived(draftToSchedule(draft));
  let previewName = $derived(preview.name || 'new schedule');
  let previewSchedule = $derived<Schedule>({ ...preview, name: previewName });
  let colors = $derived(scheduleColors([...existingNames, previewName]));
  let upcomingAll = $derived(occurrences(previewSchedule, now, HORIZON_DAYS, now));
  let upcoming = $derived(upcomingAll.slice(0, 8));

  let usageText = $derived.by(() => {
    if (isNew) {
      return 'Created in one write. Devices bind to a schedule by name on their inventory entry and campaigns name one as their default; both re-plan whenever the schedule changes.';
    }
    const devices = `${usage.boundDevices} bound device${usage.boundDevices === 1 ? '' : 's'}`;
    const campaigns =
      usage.defaultOf.length > 0 ? `default of ${usage.defaultOf.join(', ')}` : 'default of no campaign';
    return `${devices} · ${campaigns}. Saving replaces the schedule; everything that references it re-plans.`;
  });

  function rulePreview(w: WindowDraft): string {
    const at = parseTimeOfDay(w.at);
    const duration = parseDuration(w.duration);
    const offset = parseUtcOffset(draft.utcOffset);
    if (at === null || duration === null || duration <= 0 || offset === null) return '';
    return ruleText({ at, duration, days: w.days }, offset);
  }

  function patchWindow(id: number, partial: Partial<WindowDraft>): void {
    draft = { ...draft, windows: draft.windows.map((w) => (w.id === id ? { ...w, ...partial } : w)) };
  }

  function toggleDay(w: WindowDraft, day: string): void {
    const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day];
    patchWindow(w.id, { days: WEEKDAYS.filter((d) => days.includes(d)) });
  }

  function addRule(): void {
    // Open the new rule an hour after the latest one so it does not collide
    // on the key.
    const ats = draft.windows.map((w) => parseTimeOfDay(w.at)).filter((a): a is number => a !== null);
    const at = ats.length > 0 ? (Math.max(...ats) + 3600) % 86400 : 79200;
    const h = Math.floor(at / 3600);
    const m = Math.floor((at % 3600) / 60);
    draft = {
      ...draft,
      windows: [...draft.windows, newWindowDraft({ at: `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}` })]
    };
  }

  // The calendar moves or resizes a rule, or adds one; the rows follow.
  function changeRuleFromCalendar(from: MaintenanceWindow, to: MaintenanceWindow): void {
    const row = rowOfRule(draft, from);
    if (!row) return;
    patchWindow(row.id, { at: formatTimeOfDay(to.at), duration: formatDuration(to.duration), days: [...to.days] });
    touched = true;
  }

  function addRuleFromCalendar(rule: MaintenanceWindow): void {
    // The opening time is the key: a rule with the same time and length
    // on other weekdays takes the new day instead.
    const same = draft.windows.find(
      (w) => w.days.length > 0 && parseTimeOfDay(w.at) === rule.at && parseDuration(w.duration) === rule.duration
    );
    if (same) {
      patchWindow(same.id, { days: WEEKDAYS.filter((d) => same.days.includes(d) || rule.days.includes(d)) });
    } else {
      const row = newWindowDraft({ at: formatTimeOfDay(rule.at), duration: formatDuration(rule.duration), days: [...rule.days] });
      draft = { ...draft, windows: [...draft.windows, row] };
    }
    touched = true;
  }

  function removeRule(id: number): void {
    draft = { ...draft, windows: draft.windows.filter((w) => w.id !== id) };
  }

  async function handleSave(): Promise<void> {
    touched = true;
    if (!validation.ok) {
      // Fields show their own error once blurred; a field never visited
      // would stay silent, so the banner names every problem.
      statusMessage = `Not saved: ${[...new Set(Object.values(validation.errors))].join(' ')}`;
      return;
    }
    // An existing entry keeps its name exactly as stored.
    const saved = { ...draftToSchedule(draft), ...(schedule ? { name: schedule.name } : {}) };
    try {
      saving = true;
      statusMessage = '';
      if (isNew) {
        await restconfPatchJson(DATA_ROOT, scheduleCreatePatch(saved));
      } else {
        // PUT replaces the whole entry: a rule removed here disappears,
        // which a merging PATCH could not do since `at` is the key.
        await restconfPutJson(
          getListEntryPath(SCHEDULE_LIST_ROOT, saved.name),
          wrapListEntryBody(SCHEDULE_LIST_ROOT, scheduleToJson(saved))
        );
      }
      // Not a preload made before the write (hovering Cancel makes one).
      await goto('/schedules', { invalidateAll: true });
    } catch (saveError) {
      statusMessage = saveError instanceof Error ? saveError.message : 'Failed to save the schedule.';
    } finally {
      saving = false;
    }
  }

  async function handleDelete(): Promise<void> {
    confirmDelete = false;
    if (!schedule) return;
    try {
      deleting = true;
      statusMessage = '';
      await restconfDelete(getListEntryPath(SCHEDULE_LIST_ROOT, schedule.name));
      await goto('/schedules', { invalidateAll: true });
    } catch (deleteError) {
      statusMessage = deleteError instanceof Error ? deleteError.message : 'Failed to delete the schedule.';
    } finally {
      deleting = false;
    }
  }

  let deleteMessage = $derived.by(() => {
    if (!schedule) return '';
    const refs: string[] = [];
    if (usage.boundDevices > 0) refs.push(`${usage.boundDevices} device(s) are bound to it`);
    if (usage.defaultOf.length > 0) refs.push(`${usage.defaultOf.join(', ')} default(s) to it`);
    const tail =
      refs.length > 0
        ? ` ${refs.join(' and ')}; the references stay behind and those devices plan into no window until they are re-pointed.`
        : '';
    return `Delete schedule ${schedule.name}?${tail}`;
  });
</script>

<div class="page-header">
  <div>
    <div class="kick mono">/maintenance:schedules/schedule{isNew ? '' : `=${schedule?.name}`}</div>
    <h2>{isNew ? 'New schedule' : schedule?.name}</h2>
    <p>{usageText}</p>
  </div>
  <div class="actions">
    {#if !isNew}
      <button
        class="btn btn-secondary btn-danger-ghost"
        type="button"
        disabled={saving || deleting}
        onclick={() => (confirmDelete = true)}
      >
        Delete
      </button>
    {/if}
    <a class="btn btn-secondary" href="/schedules">Cancel</a>
    <button class="btn btn-primary" type="button" disabled={saving || deleting} onclick={handleSave}>
      {saving ? 'Saving…' : isNew ? 'Create schedule' : 'Save schedule'}
    </button>
  </div>
</div>

{#if statusMessage}
  <div class="error-state status">{statusMessage}</div>
{/if}

<div class="editor">
  <section class="card">
    <Section title="Schedule">
      <div class="grid-2">
        <FieldText
          label="Name"
          required={isNew}
          value={draft.name}
          error={errors['name']}
          {validationKey}
          mono={true}
          disabled={!isNew}
          placeholder="e.g., europe"
          onchange={(v) => (draft = { ...draft, name: v })}
          ontouch={() => (touched = true)}
        />
        <FieldText
          label="UTC offset"
          value={draft.utcOffset}
          error={errors['utc-offset']}
          {validationKey}
          mono={true}
          placeholder="+01:00"
          help="no daylight saving"
          onchange={(v) => (draft = { ...draft, utcOffset: v })}
          ontouch={() => (touched = true)}
        />
      </div>
    </Section>
    <Section title="Windows">
      {#each draft.windows as w, index (w.id)}
        <div class="rule">
          <div class="rule-head">
            <span class="kick">Rule {index + 1}</span>
            <span class="rule-preview mono">{rulePreview(w)}</span>
            <button
              class="btn btn-secondary btn-small btn-danger-ghost"
              type="button"
              onclick={() => removeRule(w.id)}
            >
              Remove
            </button>
          </div>
          <div class="rule-fields">
            <label class="field">
              <span class="field-label">Opens at</span>
              <input
                class="input mono"
                class:has-error={!!errors[`window.${w.id}.at`]}
                type="text"
                value={w.at}
                placeholder="22:00"
                oninput={(e) => patchWindow(w.id, { at: e.currentTarget.value })}
                onblur={() => (touched = true)}
              />
              <small class="field-error">{errors[`window.${w.id}.at`] ?? ''}</small>
            </label>
            <label class="field">
              <span class="field-label">Duration</span>
              <input
                class="input mono"
                class:has-error={!!errors[`window.${w.id}.duration`]}
                type="text"
                value={w.duration}
                placeholder="4h"
                oninput={(e) => patchWindow(w.id, { duration: e.currentTarget.value })}
                onblur={() => (touched = true)}
              />
              <small class="field-error">{errors[`window.${w.id}.duration`] ?? ''}</small>
            </label>
          </div>
          <div class="field">
            <span class="field-label">Weekdays</span>
            <div class="days">
              {#each WEEKDAYS as day (day)}
                <button
                  class="day-toggle"
                  class:on={w.days.includes(day)}
                  type="button"
                  aria-pressed={w.days.includes(day)}
                  onclick={() => toggleDay(w, day)}
                >
                  {day}
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/each}
      <div class="rule-actions">
        <button class="btn btn-secondary btn-small" type="button" onclick={addRule}>Add a rule</button>
        {#each validation.warnings as warning (warning)}
          <span class="warning">{warning}</span>
        {/each}
      </div>
    </Section>
  </section>

  <section class="card">
    <div class="grids-head">
      <h3 class="panel-title">Next seven days</h3>
      <span class="hint">drag to move or resize, across a day to add · your local time</span>
    </div>
    <WeekCalendar
      schedules={[previewSchedule]}
      {now}
      {colors}
      legend={false}
      hourPx={28}
      onrulechange={changeRuleFromCalendar}
      onrulecreate={addRuleFromCalendar}
    />
    <h3 class="panel-title upcoming-title">Windows the planner would use</h3>
    {#if upcoming.length === 0}
      <p class="hint">None within the planner's {HORIZON_DAYS} days.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Opens</th>
              <th>Closes</th>
              <th class="right">Length</th>
              <th>Rule</th>
            </tr>
          </thead>
          <tbody>
            {#each upcoming as o (o.start)}
              <tr>
                <td class="mono">{dayLabel(o.start)} {clockLabel(o.start)}</td>
                <td class="mono">{sameLocalDay(o.start, o.end) ? '' : `${dayLabel(o.end)} `}{clockLabel(o.end)}</td>
                <td class="mono right">{formatDuration(o.end - o.start)}</td>
                <td class="hint">{ruleText(o.rule, previewSchedule.utcOffset)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="hint">
        {upcomingAll.length} occurrence{upcomingAll.length === 1 ? '' : 's'} within the planner's {HORIZON_DAYS} days{upcomingAll.length > upcoming.length ? `, ${upcoming.length} shown` : ''}.
      </p>
    {/if}
  </section>
</div>

<ConfirmDialog
  open={confirmDelete}
  title="Delete schedule"
  message={deleteMessage}
  confirmLabel="Delete"
  confirmClass="btn-danger"
  oncancel={() => (confirmDelete = false)}
  onconfirm={handleDelete}
/>

<style>
  .actions {
    display: flex;
    gap: 8px;
  }

  .status {
    margin-bottom: 12px;
  }

  .editor {
    display: grid;
    grid-template-columns: minmax(360px, 440px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  @media (max-width: 1100px) {
    .editor {
      grid-template-columns: 1fr;
    }
  }

  .card {
    padding: 20px;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }

  .rule {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-elevated);
  }

  .rule-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .rule-preview {
    flex: 1;
    font-size: 11.5px;
    color: var(--sw-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rule-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .field {
    display: grid;
    gap: 6px;
    align-content: start;
  }

  .field-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--sw-text-label);
  }

  .input {
    width: 100%;
    padding: 9px 12px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    color: var(--sw-text-primary);
    font-size: 12px;
    outline: none;
  }

  .input:focus {
    border-color: var(--sw-accent);
    box-shadow: 0 0 0 3px var(--sw-accent-glow);
  }

  .input.has-error {
    border-color: var(--sw-danger);
    box-shadow: 0 0 0 3px var(--sw-danger-dim);
  }

  .field-error {
    min-height: 1rem;
    font-size: 11px;
    color: var(--sw-danger);
  }

  .days {
    display: flex;
    gap: 4px;
  }

  .day-toggle {
    flex: 1;
    min-height: 34px;
    border-radius: var(--sw-radius-sm);
    border: 1px solid var(--sw-border-default);
    background: var(--sw-bg-input);
    color: var(--sw-text-muted);
    font-family: var(--sw-font-mono);
    font-size: 11.5px;
    cursor: pointer;
  }

  .day-toggle:hover {
    border-color: var(--sw-text-muted);
  }

  .day-toggle.on {
    background: var(--sw-accent-glow);
    border-color: var(--sw-accent-glow-strong);
    color: var(--sw-accent);
  }

  .rule-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .warning {
    font-size: 12px;
    color: var(--sw-warning);
  }

  .grids-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .panel-title {
    margin: 0;
    font-size: 14px;
  }

  .upcoming-title {
    margin-top: 16px;
    margin-bottom: 8px;
  }

  .hint {
    font-size: 12px;
    color: var(--sw-text-muted);
    margin: 8px 0 0;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sw-text-muted);
    padding: 6px 10px;
    border-bottom: 1px solid var(--sw-border-default);
    white-space: nowrap;
    background: none;
  }

  td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--sw-border-default);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .right {
    text-align: right;
  }

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }

  .btn-small {
    padding: 4px 10px;
    font-size: 12px;
  }

  .btn-danger-ghost {
    color: var(--sw-danger);
  }
</style>
