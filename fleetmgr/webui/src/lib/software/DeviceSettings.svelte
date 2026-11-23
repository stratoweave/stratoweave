<script lang="ts">
  // Every setting of a device in one form, or its whole config entry as
  // JSON, with one Save. A section that is not edited follows the device
  // as polled; an edit holds until it is saved or reset. A save writes
  // only what the edits changed, into the entry as stored at the save.
  import type { Snippet } from 'svelte';

  import { errorText } from '#lib/core/errors.ts';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import FieldText from '#lib/core/ui/FieldText.svelte';
  import SegmentedControl from '#lib/core/ui/SegmentedControl.svelte';
  import { focusFirstError } from '#lib/core/ui/focus.ts';
  import DeviceConnectionFields from '#lib/software/DeviceConnectionFields.svelte';
  import DeviceGroups from '#lib/software/DeviceGroups.svelte';
  import {
    LOG_LEVELS,
    MOCK_FAILURES,
    SECRET_PLACEHOLDER,
    applyConfigText,
    applySettings,
    configText,
    configTextErrors,
    draftOf,
    editedConfig,
    rewriteDevice,
    settingsChanged,
    settingsErrors,
    settingsOf,
    type DeviceConfig,
    type Edits,
    type Errors,
    type SectionFields,
    type SectionKey,
    type Settings
  } from '#lib/software/device-config.ts';
  import type { Device, DeviceCampaign, Schedule } from '#lib/software/model.ts';

  interface Props {
    /** As the page polls it. */
    device: Device;
    /** Its config entry as polled, secrets masked. */
    config: DeviceConfig;
    schedules: Schedule[];
    /** null while they load. */
    campaigns: { campaigns: DeviceCampaign[]; loadError: string } | null;
    /** Reads the device again; resolves once the page shows the new read. */
    reload: () => Promise<void>;
    /** Whether there are changes to save. */
    dirty?: boolean;
  }

  let { device, config, schedules, campaigns, reload, dirty = $bindable(false) }: Props = $props();

  type View = 'form' | 'json';

  const uid = $props.id();
  const VIEWS: { value: View; label: string }[] = [
    { value: 'form', label: 'Form' },
    { value: 'json', label: 'JSON' }
  ];
  const TIP = {
    type: 'The platform type the flotilla knows the device by, e.g. iosxe.',
    schedule: "The maintenance windows campaigns upgrade the device in. Default: each campaign's default schedule.",
    checks:
      "Whether the BGP, interface and OSPF checks gate the device's upgrade. Unless they are off, the pre-check fails on a device whose adapters cannot read them.",
    precheckWait: "How long the pre-check waits for BGP, interfaces and OSPF to pass before it refuses. Empty keeps the flotilla's 45 s.",
    postcheckWait: "How long the post-check waits for BGP, interfaces and OSPF to pass before it refuses. Empty keeps the flotilla's 600 s.",
    approval: 'Require approval of each configuration change to this device.',
    syncCheck: "Check that the device's configuration is in sync before applying edits.",
    logLevel: "Level of the device's log file. Default: the log.device.level setting.",
    connection: 'Log at trace, with every NETCONF message to and from the device, configuration data included.',
    mock: 'Simulate the device instead of connecting to it.',
    duration: 'Seconds a whole mock upgrade takes, spread over its steps. Empty or 0 completes each step at once.',
    variance: "How much each upgrade's duration varies either way, in percent. 0 makes every upgrade take exactly the duration.",
    failure: 'The IOS XE failure the mock reproduces during an upgrade.',
    version: 'Release the mock runs before any upgrade; an install changes it.',
    model: 'Chassis product ID the mock reports.',
    serialNumber: 'Chassis serial number the mock reports.',
    json: `The device's whole config entry. Passwords and private keys show as ${SECRET_PLACEHOLDER}: leave that to keep the stored value.`
  };
  const LOG_OPTIONS = [
    { value: '', label: 'Default', title: '' },
    ...LOG_LEVELS.map((level) => ({ value: level, label: level[0].toUpperCase() + level.slice(1), title: '' }))
  ];
  const NO_ERRORS: Errors = {};

  let view = $state<View>('form');
  let edits = $state.raw<Edits>({});
  // The JSON as typed; null shows the settings as the form has them.
  let jsonText = $state<string | null>(null);
  let touched = $state(false);
  let saving = $state(false);
  let confirmingJson = $state(false);
  let leavingJson = $state(false);
  let message = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let box: HTMLElement | null = $state(null);
  // The details of a mock that is off show once a save finds one of them
  // wrong, until the mock is turned on or off: they must not fold away as
  // the value being fixed turns right.
  let mockFix = $state(false);

  let read = $derived(settingsOf(config));
  let draft = $derived(draftOf(read, edits));
  let errors = $derived(settingsErrors(read, edits));
  // The JSON view's entry: as read, with the form's edits in it. An edit
  // that no longer applies to the entry as read says why.
  let edited = $derived.by(() => {
    if (view !== 'json') return null;
    try {
      const entry = editedConfig(config, edits);
      return { entry, text: configText(entry), error: '' };
    } catch (applyError) {
      return { entry: config, text: configText(config), error: errorText(applyError, 'The edits do not apply.') };
    }
  });
  let jsonEdited = $derived(edited !== null && jsonText !== null && jsonText !== edited.text);
  let jsonError = $derived.by(() => {
    if (!edited) return '';
    if (edited.error) return edited.error;
    if (!touched || jsonText === null) return '';
    return configTextErrors(jsonText, device.name, edited.entry)['json'] ?? '';
  });
  let changed = $derived(settingsChanged(read, edits) || jsonEdited);
  let mockDetails = $derived(draft.mock.enabled || mockFix);

  let scheduleOptions = $derived.by(() => {
    const options = schedules.map((s) => ({ name: s.name, label: s.name }));
    const picked = draft.schedule.schedule;
    if (picked && !schedules.some((s) => s.name === picked)) {
      options.push({ name: picked, label: `${picked} (missing)` });
    }
    return options;
  });
  // Unbound, the device follows each campaign's default schedule.
  let defaultLabel = $derived.by(() => {
    if (!campaigns || campaigns.loadError) return 'campaign default';
    const names = new Set(campaigns.campaigns.map((c) => c.defaultSchedule || 'none'));
    return `${names.size > 0 ? [...names].join(', ') : 'none'} (default)`;
  });

  $effect(() => {
    dirty = changed;
  });

  /** The errors of a section, once the form has been touched. */
  function shown(key: SectionKey): Errors {
    return touched ? errors[key] : NO_ERRORS;
  }

  function set<K extends SectionKey>(key: K, next: Settings[K]): void {
    edits = { ...edits, [key]: { base: edits[key]?.base ?? read[key], draft: next } } as Edits;
    message = null;
  }

  function touch(): void {
    touched = true;
  }

  function fieldsOf<K extends SectionKey>(key: K): SectionFields<Settings[K]> {
    return { draft: draft[key], set: (next) => set(key, next), errors: shown(key), touch, disabled: saving };
  }

  function reset(): void {
    edits = {};
    jsonText = null;
    touched = false;
    mockFix = false;
    message = null;
  }

  // The form cannot show what was typed in the JSON, so leaving the JSON
  // view drops it, after asking.
  function pick(next: View): void {
    if (next === view) return;
    if (jsonEdited) {
      leavingJson = true;
      return;
    }
    jsonText = null;
    view = next;
  }

  function leaveJson(): void {
    leavingJson = false;
    jsonText = null;
    view = 'form';
  }

  async function save(): Promise<void> {
    touched = true;
    if (jsonEdited) {
      if (jsonError) await focusFirstError(box);
      else confirmingJson = true;
      return;
    }
    if (Object.values(errors).some((e) => Object.keys(e).length > 0)) {
      // The form shows where.
      jsonText = null;
      view = 'form';
      mockFix = Object.keys(errors.mock).length > 0;
      await focusFirstError(box);
      return;
    }
    const changes = edits;
    await commit(() => rewriteDevice(device.name, (entry) => applySettings(entry, changes)));
  }

  async function saveJson(): Promise<void> {
    confirmingJson = false;
    const text = jsonText;
    const changes = edits;
    if (text === null) return;
    // A placeholder takes the stored secret, or the one typed in the form.
    await commit(() => rewriteDevice(device.name, (entry) => applyConfigText(text, applySettings(entry, changes))));
  }

  async function commit(write: () => Promise<void>): Promise<void> {
    try {
      saving = true;
      message = null;
      await write();
      // The edits show until the read after the write is in.
      await reload();
      edits = {};
      jsonText = null;
      touched = false;
      mockFix = false;
      message = { type: 'success', text: 'Saved.' };
    } catch (saveError) {
      message = { type: 'error', text: errorText(saveError, 'Failed to save.') };
    } finally {
      saving = false;
    }
  }

  function jsonRows(text: string): number {
    return Math.min(30, Math.max(8, text.split('\n').length + 1));
  }
</script>

<!-- A section of the form: its name, and its fields in the form's
     columns. Bare: its first line has no labels, so the name lines up with
     the controls. -->
{#snippet section(name: string, yang: string, body: Snippet, bare = false)}
  {@const id = `${uid}-${name.replace(/\W+/g, '-')}`}
  <div class="section" class:bare role="group" aria-labelledby={id}>
    <h3 {id} class="section-name" title={yang ? `YANG: ${yang}` : undefined}>{name}</h3>
    <div class="fields">{@render body()}</div>
  </div>
{/snippet}

<!-- A checkbox, with what it does as its tooltip and its description.
     Under: under an empty label, in line with the fields beside it. -->
{#snippet check(
  name: string,
  label: string,
  tooltip: string,
  checked: boolean,
  onchange: (next: boolean) => void,
  under = false
)}
  <div class="field">
    {#if under}<span class="field__label" aria-hidden="true">&nbsp;</span>{/if}
    <label class="check" title={tooltip}>
      <input
        type="checkbox"
        {checked}
        disabled={saving}
        aria-describedby={`${uid}-${name}-tip`}
        onchange={(e) => onchange(e.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
    <span id={`${uid}-${name}-tip`} class="sr-only">{tooltip}</span>
  </div>
{/snippet}

{#snippet select(
  name: string,
  label: string,
  tooltip: string,
  value: string,
  options: { value: string; label: string; title: string }[],
  onchange: (next: string) => void
)}
  {@const id = `${uid}-${name}`}
  <div class="field">
    <label class="field__label" for={id} title={tooltip}>{label}</label>
    <select
      {id}
      class="select compact"
      title={tooltip}
      aria-describedby={`${id}-tip`}
      {value}
      disabled={saving}
      onchange={(e) => onchange(e.currentTarget.value)}
    >
      {#each options as option (option.value)}
        <option value={option.value} title={option.title || undefined}>{option.label}</option>
      {/each}
    </select>
    <span id={`${id}-tip`} class="sr-only">{tooltip}</span>
  </div>
{/snippet}

{#snippet general()}
  <FieldText
    label="Type"
    required={true}
    value={draft.general.type}
    error={shown('general')['type']}
    mono={true}
    placeholder="iosxe"
    tooltip={TIP.type}
    disabled={saving}
    onchange={(type) => set('general', { ...draft.general, type })}
    ontouch={touch}
  />
  <div class="wide">
    <FieldText
      label="Description"
      value={draft.general.description}
      error={shown('general')['description']}
      disabled={saving}
      onchange={(description) => set('general', { ...draft.general, description })}
      ontouch={touch}
    />
  </div>
{/snippet}

{#snippet schedule()}
  <select
    class="select compact"
    aria-label="Maintenance schedule"
    title={TIP.schedule}
    aria-describedby={`${uid}-schedule-tip`}
    value={draft.schedule.schedule}
    disabled={saving}
    onchange={(e) => set('schedule', { schedule: e.currentTarget.value })}
  >
    <option value="">{defaultLabel}</option>
    {#each scheduleOptions as option (option.name)}
      <option value={option.name}>{option.label}</option>
    {/each}
  </select>
  <span id={`${uid}-schedule-tip`} class="sr-only">{TIP.schedule}</span>
{/snippet}

{#snippet redundancy()}
  <DeviceGroups {device} {...fieldsOf('membership')} />
{/snippet}

{#snippet checks()}
  {@render check('checks', 'Enabled', TIP.checks, draft.checks.enabled, (enabled) => set('checks', { ...draft.checks, enabled }), true)}
  <FieldText
    label="Pre-check wait (s)"
    value={draft.checks.precheckWait}
    error={shown('checks')['precheckWait']}
    mono={true}
    placeholder="45 (default)"
    tooltip={TIP.precheckWait}
    disabled={saving}
    onchange={(precheckWait) => set('checks', { ...draft.checks, precheckWait })}
    ontouch={touch}
  />
  <FieldText
    label="Post-check wait (s)"
    value={draft.checks.postcheckWait}
    error={shown('checks')['postcheckWait']}
    mono={true}
    placeholder="600 (default)"
    tooltip={TIP.postcheckWait}
    disabled={saving}
    onchange={(postcheckWait) => set('checks', { ...draft.checks, postcheckWait })}
    ontouch={touch}
  />
{/snippet}

{#snippet changes()}
  {@render check('approval', 'Approval required', TIP.approval, draft.changes.approvalRequired, (approvalRequired) =>
    set('changes', { ...draft.changes, approvalRequired })
  )}
  {@render check('sync-check', 'Sync check', TIP.syncCheck, draft.changes.syncCheck, (syncCheck) =>
    set('changes', { ...draft.changes, syncCheck })
  )}
{/snippet}

{#snippet logging()}
  {@render select('log-level', 'Log level', TIP.logLevel, draft.logging.logLevel, LOG_OPTIONS, (logLevel) =>
    set('logging', { ...draft.logging, logLevel })
  )}
  {@render check(
    'connection',
    'Connection debug',
    TIP.connection,
    draft.logging.connection,
    (connection) => set('logging', { ...draft.logging, connection }),
    true
  )}
{/snippet}

{#snippet mock()}
  {@render check(
    'mock',
    'Enabled',
    TIP.mock,
    draft.mock.enabled,
    (enabled) => {
      mockFix = false;
      set('mock', { ...draft.mock, enabled });
    },
    mockDetails
  )}
  {#if mockDetails}
    <FieldText
      label="Upgrade duration (s)"
      value={draft.mock.duration}
      error={shown('mock')['duration']}
      mono={true}
      placeholder="0 (default)"
      tooltip={TIP.duration}
      disabled={saving}
      onchange={(duration) => set('mock', { ...draft.mock, duration })}
      ontouch={touch}
    />
    <FieldText
      label="Variance (%)"
      value={draft.mock.variance}
      error={shown('mock')['variance']}
      mono={true}
      placeholder="20 (default)"
      tooltip={TIP.variance}
      disabled={saving}
      onchange={(variance) => set('mock', { ...draft.mock, variance })}
      ontouch={touch}
    />
    {@render select('failure', 'Failure', TIP.failure, draft.mock.failure, MOCK_FAILURES, (failure) =>
      set('mock', { ...draft.mock, failure })
    )}
    <!-- Under the first line's fields, not under Enabled. -->
    <div class="next-line">
      <FieldText
        label="Platform version"
        value={draft.mock.version}
        error={shown('mock')['version']}
        mono={true}
        placeholder="17.18.02 (default)"
        tooltip={TIP.version}
        disabled={saving}
        onchange={(version) => set('mock', { ...draft.mock, version })}
        ontouch={touch}
      />
    </div>
    <FieldText
      label="Model"
      value={draft.mock.model}
      error={shown('mock')['model']}
      mono={true}
      placeholder="C8000V (default)"
      tooltip={TIP.model}
      disabled={saving}
      onchange={(model) => set('mock', { ...draft.mock, model })}
      ontouch={touch}
    />
    <FieldText
      label="Serial number"
      value={draft.mock.serialNumber}
      error={shown('mock')['serialNumber']}
      mono={true}
      placeholder="9ABCDEFGHIJ (default)"
      tooltip={TIP.serialNumber}
      disabled={saving}
      onchange={(serialNumber) => set('mock', { ...draft.mock, serialNumber })}
      ontouch={touch}
    />
  {/if}
{/snippet}

<section class="card" aria-labelledby={`${uid}-title`} bind:this={box}>
  <div class="head">
    <h2 id={`${uid}-title`} class="panel-title">Settings</h2>
    <SegmentedControl options={VIEWS} value={view} ariaLabel="View" onchange={pick} />
  </div>

  {#if view === 'form'}
    <div class="form">
      {@render section('General', '', general)}
      <DeviceConnectionFields {...fieldsOf('connection')} {section} />
      {@render section('Schedule', '/fleet/device/schedule', schedule, true)}
      {@render section('Redundancy', '/fleet/device/redundancy-group', redundancy)}
      {@render section('Upgrade checks', '/fleet/device/upgrade-checks', checks)}
      {@render section('Configuration changes', '', changes, true)}
      {@render section('Logging', '/fleet/device/debug', logging)}
      {@render section('Mock', '/fleet/device/mock', mock, !mockDetails)}
    </div>
  {:else if edited}
    {@const text = jsonText ?? edited.text}
    <div class="json-view">
      <textarea
        class="input mono json"
        class:has-error={!!jsonError}
        rows={jsonRows(text)}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        aria-label="Configuration as JSON"
        title={TIP.json}
        aria-invalid={jsonError ? 'true' : undefined}
        aria-describedby={`${jsonError ? `${uid}-json-error ` : ''}${uid}-json-tip`}
        value={text}
        disabled={saving}
        oninput={(e) => {
          jsonText = e.currentTarget.value;
          message = null;
        }}
        onblur={touch}
      ></textarea>
      {#if jsonError}
        <small id={`${uid}-json-error`} class="field__meta field__meta--error">{jsonError}</small>
      {/if}
      <span id={`${uid}-json-tip`} class="sr-only">{TIP.json}</span>
    </div>
  {/if}

  <!-- Stays in view at the bottom while the form scrolls under it. -->
  <div class="save-bar">
    <div class="outcome">
      {#if changed}<span class="unsaved">Unsaved changes</span>{/if}
      <!-- In place before any message, so that a screen reader reads each one. -->
      <span role="status">
        {#if message?.type === 'success'}<span class="save-ok">{message.text}</span>{/if}
      </span>
      <span role="alert">
        {#if message?.type === 'error'}<span class="save-error">{message.text}</span>{/if}
      </span>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" type="button" disabled={saving || !changed} onclick={reset}>Reset</button>
      <button class="btn btn-primary" type="button" disabled={saving || !changed} onclick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
</section>

<ConfirmDialog
  open={confirmingJson}
  title="Save the JSON?"
  message="It replaces the device's whole configuration."
  confirmLabel="Save"
  confirmClass="btn-primary"
  oncancel={() => (confirmingJson = false)}
  onconfirm={saveJson}
/>

<ConfirmDialog
  open={leavingJson}
  title="Discard the JSON edits?"
  message="The form cannot show them."
  confirmLabel="Discard"
  cancelLabel="Keep editing"
  confirmClass="btn-danger"
  oncancel={() => (leavingJson = false)}
  onconfirm={leaveJson}
/>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sw-space-2) var(--sw-space-4);
    margin-bottom: var(--sw-space-1);
  }

  .head .panel-title {
    margin: 0;
  }

  .section {
    display: grid;
    grid-template-columns: 9rem minmax(0, 1fr);
    gap: var(--sw-space-2) var(--sw-space-4);
    padding: var(--sw-space-3) 0;
  }

  .section + .section {
    border-top: 1px solid var(--sw-border-subtle);
  }

  /* On the line of the labels beside it. */
  .section-name {
    font-size: var(--sw-text-sm);
    font-weight: 500;
    line-height: 18px;
    color: var(--sw-text-secondary);
  }

  /* On the line of the controls beside it, which are 34px tall. */
  .bare .section-name {
    padding-top: var(--sw-space-2);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sw-space-2) var(--sw-space-3);
    align-items: start;
  }

  .wide {
    grid-column: span 3;
  }

  .next-line {
    grid-column-start: 2;
  }

  /* Compact fields, also in the shared field components, which have no
     compact size: .input.compact's. */
  .form :global(.field) {
    gap: var(--sw-space-1);
  }

  .form :global(.field .input) {
    padding-block: 7px;
    padding-inline-start: 10px;
    font-size: var(--sw-text-xs);
  }

  /* The line under a field is for its error alone. */
  .form :global(.field__meta:not(.field__meta--error)) {
    display: none;
  }

  /* As tall as a compact input, so that it lines up with one. */
  .check {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: var(--sw-space-2);
    min-height: 34px;
    font-size: var(--sw-text-sm);
    cursor: pointer;
  }

  .select {
    width: 100%;
  }

  .json-view {
    display: grid;
    gap: var(--sw-space-1);
    padding: var(--sw-space-3) 0;
  }

  .json {
    min-height: 12rem;
    line-height: 1.5;
  }

  /* Sticks to the bottom edge of the scroller, past the scroller's
     padding, which a sticky box otherwise keeps clear of. */
  .save-bar {
    position: sticky;
    bottom: calc(-1 * var(--sw-space-8));
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sw-space-2) var(--sw-space-4);
    margin: 0 calc(-1 * var(--sw-space-5)) calc(-1 * var(--sw-space-5));
    padding: var(--sw-space-3) var(--sw-space-5);
    border-top: 1px solid var(--sw-border-subtle);
    border-radius: 0 0 calc(var(--sw-radius-md) - 1px) calc(var(--sw-radius-md) - 1px);
    background: var(--sw-bg-card);
  }

  /* A field that gets focus scrolls into view above the bar, not under it. */
  :global(.app-content:has(.save-bar)) {
    scroll-padding-bottom: 6rem;
  }

  .outcome {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--sw-space-1) var(--sw-space-3);
    font-size: var(--sw-text-xs);
  }

  .unsaved {
    color: var(--sw-text-secondary);
  }

  .save-ok {
    color: var(--sw-text-secondary);
  }

  .save-error {
    color: var(--sw-danger-text);
  }

  .actions {
    display: flex;
    gap: var(--sw-space-2);
    margin-left: auto;
  }

  /* The scroller's padding is smaller here. */
  @media (max-width: 960px) {
    .save-bar {
      bottom: calc(-1 * var(--sw-space-4));
    }
  }

  @media (max-width: 720px) {
    .section {
      grid-template-columns: minmax(0, 1fr);
    }

    .bare .section-name {
      padding-top: 0;
    }

    .fields {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .wide {
      grid-column: 1 / -1;
    }

    .next-line {
      grid-column-start: auto;
    }
  }

  @media (pointer: coarse) {
    .check {
      min-height: 44px;
    }
  }
</style>
