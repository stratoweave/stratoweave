<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { leaveNotice } from '#lib/core/notice.ts';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import FieldSelect from '#lib/core/ui/FieldSelect.svelte';
  import FieldText from '#lib/core/ui/FieldText.svelte';
  import Section from '#lib/core/ui/Section.svelte';
  import {
    getListEntryPath,
    restconfDelete,
    restconfPatchJson,
    restconfPutJson,
    wrapListEntryBody
  } from '#lib/core/restconf/client.ts';
  import WeekCalendar from '#lib/maintenance/WeekCalendar.svelte';
  import { HORIZON_DAYS, WEEKDAYS, occurrences } from '#lib/maintenance/occurrences.ts';
  import { scheduleColors } from '#lib/maintenance/palette.ts';
  import {
    REPEAT_OPTIONS,
    campaignsText,
    draftDuration,
    draftFromSchedule,
    draftKey,
    draftToSchedule,
    draftWindow,
    emptyDraft,
    endDayOptions,
    freeWindowId,
    labelledWindowText,
    newWindowDraft,
    parseTimeOfDay,
    rowOfRule,
    utcOffsetOptions,
    windowDraft,
    windowText,
    scheduleCreatePatch,
    scheduleToJson,
    usageChangeText,
    validateScheduleDraft,
    withDayToggled,
    withEnd,
    withEndDay,
    withRepeat,
    withRule,
    withStart,
    type Repeat,
    type ScheduleDraft,
    type ScheduleUsage,
    type WindowDraft
  } from '#lib/maintenance/schedule-form.ts';
  import { DATA_ROOT, SCHEDULE_LIST_ROOT, type MaintenanceWindow, type Schedule } from '#lib/software/model.ts';
  import { clockLabel, dayLabel, formatDuration, sameLocalDay } from '#lib/core/time.ts';

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
  const loaded = untrack(() => (schedule ? draftFromSchedule(schedule) : emptyDraft()));
  let draft = $state<ScheduleDraft>(loaded);
  // Whether there is anything to save, or to lose by leaving.
  const loadedKey = draftKey(loaded);
  let dirty = $derived(draftKey(draft) !== loadedKey);
  let touched = $state(false);
  let saving = $state(false);
  let deleting = $state(false);
  let confirmSave = $state(false);
  let confirmDelete = $state(false);
  let statusMessage = $state<string>('');
  // Where the operator asked to go with the changes unsaved.
  let leaveTo = $state<URL | null>(null);
  let leaving = false;
  // The window the calendar added or changed last, for a screen reader.
  let calendarMessage = $state('');
  let rulesEl: HTMLElement | null = $state(null);
  let addRuleButton: HTMLButtonElement | null = $state(null);

  // Leaving drops the changes, so it is asked first. A reload or a closed
  // tab gets the browser's own question.
  beforeNavigate(({ cancel, to, willUnload }) => {
    if (!dirty || leaving) return;
    cancel();
    if (!willUnload && to) leaveTo = to.url;
  });

  function leave(): void {
    const to = leaveTo;
    leaveTo = null;
    if (!to) return;
    leaving = true;
    void goto(to);
  }

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
    if (isNew) return '';
    const devices = `${usage.boundDevices.toLocaleString()} bound device${usage.boundDevices === 1 ? '' : 's'}`;
    const campaigns =
      usage.defaultOf.length > 0 ? `default for ${usage.defaultOf.join(', ')}` : 'not a campaign default';
    return `${devices} · ${campaigns}`;
  });

  function summary(w: WindowDraft): string {
    const window = draftWindow(w);
    return window ? windowText(window) : '';
  }

  function lengthText(w: WindowDraft): string {
    const duration = draftDuration(w);
    return duration !== null && duration > 0 ? formatDuration(duration) : '';
  }

  function patchWindow(id: number, next: (w: WindowDraft) => WindowDraft): void {
    draft = { ...draft, windows: draft.windows.map((w) => (w.id === id ? next(w) : w)) };
  }

  function addRule(): void {
    // Start the new window an hour after the latest one, so that it shows
    // apart on the calendar.
    const ats = draft.windows.map((w) => parseTimeOfDay(w.at)).filter((a): a is number => a !== null);
    const at = ats.length > 0 ? (Math.max(...ats) + 3600) % 86400 : 79200;
    draft = { ...draft, windows: [...draft.windows, newWindowDraft(freeWindowId(draft.windows), at - (at % 60))] };
  }

  // The calendar moves or resizes a window, or adds one; the rows follow.
  function changeRuleFromCalendar(from: MaintenanceWindow, to: MaintenanceWindow): void {
    const row = rowOfRule(draft, from);
    if (!row) return;
    patchWindow(row.id, (w) => withRule(w, to));
    touched = true;
    void showRule(row.id, 'changed');
  }

  function addRuleFromCalendar(rule: MaintenanceWindow): void {
    // A weekly window with the same start and length takes the new day
    // instead of a second window.
    const same = draft.windows.find((w) => {
      const window = draftWindow(w);
      return w.repeat !== 'daily' && window?.at === rule.at && window.duration === rule.duration;
    });
    if (same) {
      patchWindow(same.id, (w) => withRule(w, { ...rule, id: w.id, days: [...(draftWindow(w)?.days ?? []), ...rule.days] }));
      void showRule(same.id, 'changed');
    } else {
      const row = windowDraft({ ...rule, id: freeWindowId(draft.windows) });
      draft = { ...draft, windows: [...draft.windows, row] };
      void showRule(row.id, 'added');
    }
    touched = true;
  }

  // On a phone the form sits above the calendar, out of view: the row the
  // calendar added or changed lights up, and a screen reader hears which.
  async function showRule(id: number, what: 'added' | 'changed'): Promise<void> {
    const text = `Window ${draft.windows.findIndex((w) => w.id === id) + 1} ${what}`;
    // Emptied first, so that the same text twice is read twice.
    calendarMessage = '';
    await tick();
    calendarMessage = text;
    rulesEl
      ?.querySelector(`[data-rule="${id}"]`)
      ?.animate([{ backgroundColor: 'var(--sw-accent-glow-strong)' }, { backgroundColor: 'transparent' }], {
        duration: 1600,
        easing: 'ease-out'
      });
  }

  async function removeRule(id: number): Promise<void> {
    const index = draft.windows.findIndex((w) => w.id === id);
    draft = { ...draft, windows: draft.windows.filter((w) => w.id !== id) };
    // The button is gone: focus goes on to the window that moved up into
    // its place, or to Add window after the last one.
    await tick();
    const next = draft.windows[index];
    const field = next ? rulesEl?.querySelector<HTMLElement>(`[data-rule="${next.id}"] input`) : null;
    (field ?? addRuleButton)?.focus();
  }

  // Every campaign and device on the schedule re-plans into the changed
  // windows, so a save is asked first.
  let saveUsers = $derived(isNew ? '' : usageChangeText(usage));

  function handleSave(): void {
    touched = true;
    if (!validation.ok) {
      // The banner also names problems scrolled out of view.
      statusMessage = `Not saved: ${[...new Set(Object.values(validation.errors))].join(' ')}`;
      return;
    }
    if (saveUsers) {
      confirmSave = true;
      return;
    }
    void save();
  }

  async function save(): Promise<void> {
    confirmSave = false;
    // An existing entry keeps its name exactly as stored.
    const saved = { ...draftToSchedule(draft), ...(schedule ? { name: schedule.name } : {}) };
    try {
      saving = true;
      statusMessage = '';
      if (isNew) {
        await restconfPatchJson(DATA_ROOT, scheduleCreatePatch(saved));
      } else {
        // PUT replaces the whole entry: a window removed here disappears,
        // which a merging PATCH could not do.
        await restconfPutJson(
          getListEntryPath(SCHEDULE_LIST_ROOT, saved.name),
          wrapListEntryBody(SCHEDULE_LIST_ROOT, scheduleToJson(saved))
        );
      }
      leaveNotice(`${isNew ? 'Created' : 'Saved'} schedule ${saved.name}.`);
      leaving = true;
      // Not a preload made before the write (hovering Cancel makes one).
      await goto('/schedules', { refreshAll: true });
    } catch (saveError) {
      statusMessage = errorText(saveError, 'Failed to save the schedule.');
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
      leaveNotice(`Deleted schedule ${schedule.name}.`);
      leaving = true;
      await goto('/schedules', { refreshAll: true });
    } catch (deleteError) {
      statusMessage = errorText(deleteError, 'Failed to delete the schedule.');
    } finally {
      deleting = false;
    }
  }

  let deleteMessage = $derived.by(() => {
    if (!schedule) return '';
    const refs: string[] = [];
    const c = usage.defaultOf.length;
    if (c > 0) refs.push(`${campaignsText(usage.defaultOf)} default${c === 1 ? 's' : ''} to it`);
    const n = usage.boundDevices;
    if (n > 0) refs.push(`${n.toLocaleString()} device${n === 1 ? ' is' : 's are'} bound to it`);
    const tail =
      refs.length > 0
        ? ` ${refs.join(' and ')}; the references stay behind and those devices plan into no window until they are re-pointed.`
        : '';
    return `Delete schedule ${schedule.name}?${tail}`;
  });
</script>

<div class="page-header">
  <div>
    <h1 title={`YANG: /maintenance:schedules/schedule${isNew ? '' : `=${schedule?.name}`}`}>
      {isNew ? 'New schedule' : schedule?.name}
    </h1>
    {#if usageText}<p>{usageText}</p>{/if}
  </div>
  <div class="page-actions">
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
    {#if dirty}
      <span class="unsaved">Unsaved changes</span>
    {/if}
    <a class="btn btn-secondary" href="/schedules">Cancel</a>
    <button
      class="btn btn-primary"
      type="button"
      disabled={saving || deleting || (!isNew && !dirty)}
      onclick={handleSave}
    >
      {saving ? 'Saving…' : isNew ? 'Create schedule' : 'Save schedule'}
    </button>
  </div>
</div>

<!-- In place before any message, so that a screen reader reads each one. -->
<div role="alert">
  {#if statusMessage}
    <div class="error-state status">{statusMessage}</div>
  {/if}
</div>

<div class="editor">
  <section class="card">
    <Section title="Schedule">
      <div class="grid-2">
        <FieldText
          label="Name"
          required={isNew}
          value={draft.name}
          error={errors['name']}
          mono={true}
          disabled={!isNew}
          placeholder="e.g. europe"
          onchange={(v) => (draft = { ...draft, name: v })}
          ontouch={() => (touched = true)}
        />
        <FieldSelect
          label="Time zone"
          value={String(draft.utcOffset)}
          options={utcOffsetOptions(draft.utcOffset)}
          help="No daylight saving"
          onchange={(v) => (draft = { ...draft, utcOffset: Number(v) })}
        />
      </div>
    </Section>
    <Section title="Windows">
      {#if draft.windows.length > 0}
        <div class="rules" bind:this={rulesEl}>
          {#each draft.windows as w, index (w.id)}
            {@const atError = errors[`window.${w.id}.at`]}
            {@const endError = errors[`window.${w.id}.end`]}
            {@const daysError = errors[`window.${w.id}.days`]}
            <div class="rule" data-rule={w.id}>
              <div class="rule-head">
                <span class="kick">Window {index + 1}</span>
                <span class="rule-preview">{summary(w)}</span>
                <button
                  class="btn btn-secondary btn-sm btn-danger-ghost"
                  type="button"
                  aria-label={`Remove window ${index + 1}`}
                  onclick={() => removeRule(w.id)}
                >
                  Remove
                </button>
              </div>
              <div class="rows">
                <label class="row-label" for={`w${w.id}-label`}>Label</label>
                <div class="row-ctl">
                  <input
                    id={`w${w.id}-label`}
                    class="input label"
                    value={w.label}
                    placeholder="Optional"
                    oninput={(e) => patchWindow(w.id, (x) => ({ ...x, label: e.currentTarget.value }))}
                  />
                </div>

                <label class="row-label" for={`w${w.id}-at`}>Starts</label>
                <div class="row-ctl">
                  <input
                    id={`w${w.id}-at`}
                    class="input mono time"
                    class:has-error={!!atError}
                    aria-invalid={atError ? 'true' : undefined}
                    value={w.at}
                    placeholder="22:00"
                    oninput={(e) => patchWindow(w.id, (x) => withStart(x, e.currentTarget.value))}
                    onblur={() => (touched = true)}
                  />
                </div>
                {#if atError}<small class="row-error">{atError}</small>{/if}

                <label class="row-label" for={`w${w.id}-end`}>Ends</label>
                <div class="row-ctl">
                  <input
                    id={`w${w.id}-end`}
                    class="input mono time"
                    class:has-error={!!endError}
                    aria-invalid={endError ? 'true' : undefined}
                    value={w.end}
                    placeholder="02:00"
                    oninput={(e) => patchWindow(w.id, (x) => withEnd(x, e.currentTarget.value))}
                    onblur={() => (touched = true)}
                  />
                  <select
                    class="select compact"
                    aria-label={`Window ${index + 1} ends on`}
                    value={String(w.endDay)}
                    onchange={(e) => patchWindow(w.id, (x) => withEndDay(x, Number(e.currentTarget.value)))}
                  >
                    {#each endDayOptions(w.endDay) as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                  <span class="length">{lengthText(w)}</span>
                </div>
                {#if endError}<small class="row-error">{endError}</small>{/if}

                <label class="row-label" for={`w${w.id}-repeat`}>Repeat</label>
                <div class="row-ctl">
                  <select
                    id={`w${w.id}-repeat`}
                    class="select compact repeat"
                    value={w.repeat}
                    onchange={(e) => patchWindow(w.id, (x) => withRepeat(x, e.currentTarget.value as Repeat))}
                  >
                    {#each REPEAT_OPTIONS as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </div>
                {#if w.repeat === 'weekly'}
                  <div class="row-ctl days" role="group" aria-label={`Window ${index + 1} weekdays`}>
                    {#each WEEKDAYS as day (day)}
                      <button
                        class="day-toggle"
                        class:on={w.days.includes(day)}
                        type="button"
                        aria-pressed={w.days.includes(day)}
                        onclick={() => {
                          patchWindow(w.id, (x) => withDayToggled(x, day));
                          touched = true;
                        }}
                      >
                        {day[0].toUpperCase() + day.slice(1)}
                      </button>
                    {/each}
                  </div>
                  {#if daysError}<small class="row-error">{daysError}</small>{/if}
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
      <div class="rule-actions">
        <button class="btn btn-secondary btn-sm" type="button" bind:this={addRuleButton} onclick={addRule}>
          Add window
        </button>
        {#each validation.warnings as warning (warning)}
          <span class="warning">{warning}</span>
        {/each}
      </div>
    </Section>
  </section>

  <section class="card">
    <div class="grids-head">
      <h2 class="panel-title">Next seven days</h2>
      <!-- A touch has to be held before it drags: a swipe scrolls. -->
      <span class="hint">
        <span class="drag-fine">Drag</span><span class="drag-coarse">Hold, then drag</span> to add, move or resize
        windows · local time
      </span>
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
    <p class="sr-only" role="status">{calendarMessage}</p>
    <h2 class="panel-title upcoming-title">Upcoming windows</h2>
    {#if upcoming.length === 0}
      <p class="hint">None within the planner's {HORIZON_DAYS} days.</p>
    {:else}
      <div class="table-wrap">
        <table class="dense">
          <thead>
            <tr>
              <th>Opens</th>
              <th>Closes</th>
              <th class="right">Length</th>
              <th>Window</th>
            </tr>
          </thead>
          <tbody>
            {#each upcoming as o (`${o.rule.id}@${o.start}`)}
              <tr>
                <td class="mono">{dayLabel(o.start)} {clockLabel(o.start)}</td>
                <td class="mono">{sameLocalDay(o.start, o.end) ? '' : `${dayLabel(o.end)} `}{clockLabel(o.end)}</td>
                <td class="mono right">{formatDuration(o.end - o.start)}</td>
                <td class="hint">{labelledWindowText(o.rule)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="hint">
        {upcomingAll.length.toLocaleString()} window{upcomingAll.length === 1 ? '' : 's'} in the planner's {HORIZON_DAYS}-day horizon{upcomingAll.length > upcoming.length ? `, first ${upcoming.length.toLocaleString()} shown` : ''}.
      </p>
    {/if}
  </section>
</div>

<ConfirmDialog
  open={confirmSave}
  title="Save schedule"
  message={`Save ${schedule?.name}? ${saveUsers}`}
  confirmLabel="Save"
  confirmClass="btn-primary"
  oncancel={() => (confirmSave = false)}
  onconfirm={save}
/>

<ConfirmDialog
  open={confirmDelete}
  title="Delete schedule"
  message={deleteMessage}
  confirmLabel="Delete"
  confirmClass="btn-danger"
  oncancel={() => (confirmDelete = false)}
  onconfirm={handleDelete}
/>

<ConfirmDialog
  open={leaveTo !== null}
  title="Discard unsaved changes?"
  message={isNew ? 'The new schedule is not created yet.' : `The changes to ${schedule?.name} are not saved.`}
  confirmLabel="Discard"
  cancelLabel="Keep editing"
  confirmClass="btn-danger"
  oncancel={() => (leaveTo = null)}
  onconfirm={leave}
/>

<style>
  .editor {
    display: grid;
    grid-template-columns: minmax(0, 440px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  @media (max-width: 1100px) {
    .editor {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }

  .unsaved {
    align-self: center;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
  }

  /* A phone's actions start at the left: the note goes above them rather
     than push Save onto a line of its own. */
  @media (max-width: 720px) {
    .unsaved {
      order: -1;
      flex-basis: 100%;
    }
  }

  /* The windows part with a line, not a box in the card. Each reaches 10px
     past the fields, room for the light after a calendar edit; the
     negative margins keep the fields in line with the ones above. */
  .rules {
    display: grid;
    margin: -12px -10px;
  }

  .rule {
    position: relative;
    display: grid;
    gap: 10px;
    padding: 12px 10px;
    border-radius: var(--sw-radius-sm);
  }

  .rule + .rule::before {
    content: '';
    position: absolute;
    top: 0;
    left: 10px;
    right: 10px;
    border-top: 1px solid var(--sw-border-subtle);
  }

  .rule-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .rule-preview {
    flex: 1;
    min-width: 0;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Label column and controls, the way a calendar event inspector lays
     out starts, ends and repeat. */
  .rows {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    align-items: center;
    gap: 8px 12px;
  }

  .row-label {
    justify-self: end;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
  }

  .row-ctl {
    grid-column: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .row-error {
    grid-column: 2;
    margin-top: -4px;
    font-size: var(--sw-text-xs);
    color: var(--sw-danger);
  }

  .time {
    width: 84px;
    flex: none;
    padding: 7px 10px;
    font-size: 12px;
  }

  .length {
    margin-left: auto;
    font-family: var(--sw-font-mono);
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
    white-space: nowrap;
  }

  .repeat {
    min-width: 160px;
  }

  .label {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    font-size: 12px;
  }

  .days {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
  }

  .day-toggle {
    min-width: 0;
    min-height: 30px;
    border-radius: var(--sw-radius-sm);
    border: 1px solid var(--sw-border-default);
    background: var(--sw-bg-input);
    color: var(--sw-text-muted);
    font-size: var(--sw-text-xs);
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
    font-size: var(--sw-text-xs);
    color: var(--sw-warning);
  }

  .grids-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    margin-bottom: 12px;
  }

  .panel-title {
    margin: 0;
    font-size: var(--sw-text-md);
  }

  .upcoming-title {
    margin-top: 16px;
    margin-bottom: 8px;
  }

  .hint {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
    margin: 8px 0 0;
  }

  .drag-coarse {
    display: none;
  }

  @media (pointer: coarse) {
    .drag-fine {
      display: none;
    }

    .drag-coarse {
      display: inline;
    }
  }
</style>
