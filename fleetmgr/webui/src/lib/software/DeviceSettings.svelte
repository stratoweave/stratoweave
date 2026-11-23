<script lang="ts">
  // Every setting of a device, one card for each group of them, each with
  // its own save. A card saves only its own leaves.
  import { errorText } from '#lib/core/errors.ts';
  import FieldText from '#lib/core/ui/FieldText.svelte';
  import { setDeviceSchedule } from '#lib/maintenance/binding.ts';
  import DeviceConnectionFields from '#lib/software/DeviceConnectionFields.svelte';
  import DeviceGroups from '#lib/software/DeviceGroups.svelte';
  import DeviceSettingsCard from '#lib/software/DeviceSettingsCard.svelte';
  import {
    LOG_LEVELS,
    MOCK_FAILURES,
    SECRET_PLACEHOLDER,
    applyConfigText,
    applyConnection,
    changeLeaves,
    checkLeaves,
    configText,
    configTextErrors,
    connectionErrors,
    connectionOf,
    generalLeaves,
    loggingLeaves,
    mockLeaves,
    rewriteDevice,
    sameConnection,
    type DeviceConfig
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
    /** The titles of the cards with changes to save. */
    dirty?: string[];
  }

  let { device, config, schedules, campaigns, reload, dirty = $bindable([]) }: Props = $props();

  const uid = $props.id();
  const CARDS = [
    'General',
    'Connection',
    'Maintenance schedule',
    'Redundancy groups',
    'Upgrade checks',
    'Configuration changes',
    'Logging and debug',
    'Mock',
    'Advanced'
  ];
  const TIP = {
    type: 'The platform type the flotilla knows the device by, e.g. iosxe.',
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

  // By card title; a bound prop with a fallback must not start undefined.
  let changed = $state<Record<string, boolean>>(Object.fromEntries(CARDS.map((title) => [title, false])));

  // null follows the device as polled; a pick holds until it is saved.
  let picked = $state<string | null>(null);
  let savingSchedule = $state(false);
  let scheduleMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let bound = $derived(device.schedule);
  let choice = $derived(picked ?? bound);
  let scheduleOptions = $derived.by(() => {
    const options = schedules.map((s) => ({ name: s.name, label: s.name }));
    if (bound && !schedules.some((s) => s.name === bound)) {
      options.push({ name: bound, label: `${bound} (missing)` });
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
    const cards: Record<string, boolean> = { ...changed, 'Maintenance schedule': choice !== bound };
    dirty = CARDS.filter((title) => cards[title]);
  });

  let mockRead = $derived(mockLeaves.read(config));

  async function saveSchedule(): Promise<void> {
    if (choice === bound) return;
    const schedule = choice;
    try {
      savingSchedule = true;
      scheduleMessage = null;
      await setDeviceSchedule(device.name, schedule);
      // The pick shows until the read after the write is in.
      await reload();
      picked = null;
      scheduleMessage = { type: 'success', text: schedule ? `Bound to ${schedule}.` : 'Unbound.' };
    } catch (saveError) {
      scheduleMessage = {
        type: 'error',
        text: errorText(saveError, 'Failed to save the schedule.')
      };
    } finally {
      savingSchedule = false;
    }
  }

  function jsonRows(text: string): number {
    return Math.min(30, Math.max(8, text.split('\n').length + 1));
  }
</script>

<!-- A checkbox, and a select, with what it does as its tooltip and its
     description. -->
{#snippet check(
  name: string,
  label: string,
  tooltip: string,
  checked: boolean,
  disabled: boolean,
  onchange: (next: boolean) => void
)}
  <label class="check" title={tooltip}>
    <input
      type="checkbox"
      {checked}
      {disabled}
      aria-describedby={`${uid}-${name}-tip`}
      onchange={(e) => onchange(e.currentTarget.checked)}
    />
    <span>{label}</span>
  </label>
  <span id={`${uid}-${name}-tip`} class="sr-only">{tooltip}</span>
{/snippet}

{#snippet select(
  name: string,
  label: string,
  tooltip: string,
  value: string,
  options: { value: string; label: string; title: string }[],
  disabled: boolean,
  onchange: (next: string) => void
)}
  {@const id = `${uid}-${name}`}
  <div class="field">
    <label class="field__label" for={id} title={tooltip}>{label}</label>
    <select
      {id}
      class="select"
      title={tooltip}
      aria-describedby={`${id}-tip`}
      {value}
      {disabled}
      onchange={(e) => onchange(e.currentTarget.value)}
    >
      {#each options as option (option.value)}
        <option value={option.value} title={option.title || undefined}>{option.label}</option>
      {/each}
    </select>
    <small class="field__meta">&nbsp;</small>
    <span id={`${id}-tip`} class="sr-only">{tooltip}</span>
  </div>
{/snippet}

<DeviceSettingsCard
  title="General"
  read={generalLeaves.read(config)}
  same={generalLeaves.same}
  validate={generalLeaves.validate}
  save={(draft, base) => rewriteDevice(device.name, (entry) => generalLeaves.apply(entry, base, draft))}
  {reload}
  bind:dirty={changed['General']}
>
  {#snippet fields(f)}
    <div class="grid">
      <FieldText
        label="Type"
        required={true}
        value={f.draft.type}
        error={f.errors['type']}
        mono={true}
        placeholder="iosxe"
        tooltip={TIP.type}
        disabled={f.disabled}
        onchange={(v) => f.set({ ...f.draft, type: v })}
        ontouch={f.touch}
      />
      <div class="wide">
        <FieldText
          label="Description"
          value={f.draft.description}
          error={f.errors['description']}
          disabled={f.disabled}
          onchange={(v) => f.set({ ...f.draft, description: v })}
          ontouch={f.touch}
        />
      </div>
    </div>
  {/snippet}
</DeviceSettingsCard>

<DeviceSettingsCard
  title="Connection"
  read={connectionOf(config)}
  same={sameConnection}
  validate={connectionErrors}
  save={(draft, base) => rewriteDevice(device.name, (entry) => applyConnection(entry, base, draft))}
  {reload}
  bind:dirty={changed['Connection']}
>
  {#snippet fields(f)}
    <DeviceConnectionFields {...f} />
  {/snippet}
</DeviceSettingsCard>

<section class="card">
  <h2 class="panel-title" title="YANG: /fleet/device/schedule">Maintenance schedule</h2>
  <div class="binding">
    <select
      class="select binding-select"
      aria-label="Maintenance schedule"
      value={choice}
      disabled={savingSchedule}
      onchange={(e) => {
        picked = e.currentTarget.value;
        scheduleMessage = null;
      }}
    >
      <option value="">{defaultLabel}</option>
      {#each scheduleOptions as option (option.name)}
        <option value={option.name}>{option.label}</option>
      {/each}
    </select>
    <button class="btn btn-primary" type="button" disabled={savingSchedule || choice === bound} onclick={saveSchedule}>
      {savingSchedule ? 'Saving…' : 'Save'}
    </button>
    <!-- In place before any message, so that a screen reader reads each one. -->
    <span role="status">
      {#if scheduleMessage?.type === 'success'}<span class="save-ok">{scheduleMessage.text}</span>{/if}
    </span>
    <span role="alert">
      {#if scheduleMessage?.type === 'error'}<span class="save-error">{scheduleMessage.text}</span>{/if}
    </span>
  </div>
</section>

<DeviceGroups {device} {reload} bind:dirty={changed['Redundancy groups']} />

<DeviceSettingsCard
  title="Upgrade checks"
  yangPath="/fleet/device/upgrade-checks"
  read={checkLeaves.read(config)}
  same={checkLeaves.same}
  validate={checkLeaves.validate}
  save={(draft, base) => rewriteDevice(device.name, (entry) => checkLeaves.apply(entry, base, draft))}
  {reload}
  bind:dirty={changed['Upgrade checks']}
>
  {#snippet fields(f)}
    <div class="checks">
      {@render check('checks', 'Enabled', TIP.checks, f.draft.enabled, f.disabled, (v) => f.set({ ...f.draft, enabled: v }))}
    </div>
    <div class="grid">
      <FieldText
        label="Pre-check wait (s)"
        value={f.draft.precheckWait}
        error={f.errors['precheckWait']}
        mono={true}
        placeholder="45 (default)"
        tooltip={TIP.precheckWait}
        disabled={f.disabled}
        onchange={(v) => f.set({ ...f.draft, precheckWait: v })}
        ontouch={f.touch}
      />
      <FieldText
        label="Post-check wait (s)"
        value={f.draft.postcheckWait}
        error={f.errors['postcheckWait']}
        mono={true}
        placeholder="600 (default)"
        tooltip={TIP.postcheckWait}
        disabled={f.disabled}
        onchange={(v) => f.set({ ...f.draft, postcheckWait: v })}
        ontouch={f.touch}
      />
    </div>
  {/snippet}
</DeviceSettingsCard>

<DeviceSettingsCard
  title="Configuration changes"
  read={changeLeaves.read(config)}
  same={changeLeaves.same}
  validate={changeLeaves.validate}
  save={(draft, base) => rewriteDevice(device.name, (entry) => changeLeaves.apply(entry, base, draft))}
  {reload}
  bind:dirty={changed['Configuration changes']}
>
  {#snippet fields(f)}
    <div class="checks">
      {@render check('approval', 'Approval required', TIP.approval, f.draft.approvalRequired, f.disabled, (v) =>
        f.set({ ...f.draft, approvalRequired: v })
      )}
      {@render check('sync-check', 'Sync check', TIP.syncCheck, f.draft.syncCheck, f.disabled, (v) => f.set({ ...f.draft, syncCheck: v }))}
    </div>
  {/snippet}
</DeviceSettingsCard>

<DeviceSettingsCard
  title="Logging and debug"
  yangPath="/fleet/device/debug"
  read={loggingLeaves.read(config)}
  same={loggingLeaves.same}
  validate={loggingLeaves.validate}
  save={(draft, base) => rewriteDevice(device.name, (entry) => loggingLeaves.apply(entry, base, draft))}
  {reload}
  bind:dirty={changed['Logging and debug']}
>
  {#snippet fields(f)}
    <div class="grid">
      {@render select('log-level', 'Log level', TIP.logLevel, f.draft.logLevel, LOG_OPTIONS, f.disabled, (v) =>
        f.set({ ...f.draft, logLevel: v })
      )}
    </div>
    <div class="checks">
      {@render check('connection', 'Connection debug', TIP.connection, f.draft.connection, f.disabled, (v) =>
        f.set({ ...f.draft, connection: v })
      )}
    </div>
  {/snippet}
</DeviceSettingsCard>

<DeviceSettingsCard
  title="Mock"
  yangPath="/fleet/device/mock"
  fold={true}
  open={mockRead.enabled}
  read={mockRead}
  same={mockLeaves.same}
  validate={mockLeaves.validate}
  save={(draft, base) => rewriteDevice(device.name, (entry) => mockLeaves.apply(entry, base, draft))}
  {reload}
  bind:dirty={changed['Mock']}
>
  {#snippet fields(f)}
    <div class="checks">
      {@render check('mock', 'Enabled', TIP.mock, f.draft.enabled, f.disabled, (v) => f.set({ ...f.draft, enabled: v }))}
    </div>
    <div class="grid">
      <FieldText
        label="Upgrade duration (s)"
        value={f.draft.duration}
        error={f.errors['duration']}
        mono={true}
        placeholder="0 (default)"
        tooltip={TIP.duration}
        disabled={f.disabled}
        onchange={(v) => f.set({ ...f.draft, duration: v })}
        ontouch={f.touch}
      />
      <FieldText
        label="Variance (%)"
        value={f.draft.variance}
        error={f.errors['variance']}
        mono={true}
        placeholder="20 (default)"
        tooltip={TIP.variance}
        disabled={f.disabled}
        onchange={(v) => f.set({ ...f.draft, variance: v })}
        ontouch={f.touch}
      />
      {@render select('failure', 'Failure', TIP.failure, f.draft.failure, MOCK_FAILURES, f.disabled, (v) =>
        f.set({ ...f.draft, failure: v })
      )}
      <FieldText
        label="Platform version"
        value={f.draft.version}
        error={f.errors['version']}
        mono={true}
        placeholder="17.18.02 (default)"
        tooltip={TIP.version}
        disabled={f.disabled}
        onchange={(v) => f.set({ ...f.draft, version: v })}
        ontouch={f.touch}
      />
      <FieldText
        label="Model"
        value={f.draft.model}
        error={f.errors['model']}
        mono={true}
        placeholder="C8000V (default)"
        tooltip={TIP.model}
        disabled={f.disabled}
        onchange={(v) => f.set({ ...f.draft, model: v })}
        ontouch={f.touch}
      />
      <FieldText
        label="Serial number"
        value={f.draft.serialNumber}
        error={f.errors['serialNumber']}
        mono={true}
        placeholder="9ABCDEFGHIJ (default)"
        tooltip={TIP.serialNumber}
        disabled={f.disabled}
        onchange={(v) => f.set({ ...f.draft, serialNumber: v })}
        ontouch={f.touch}
      />
    </div>
  {/snippet}
</DeviceSettingsCard>

<DeviceSettingsCard
  title="Advanced"
  yangPath={`/fleet/device=${device.name}`}
  fold={true}
  open={false}
  read={configText(config)}
  same={(a, b) => a === b}
  validate={(text) => configTextErrors(text, device.name, config)}
  save={(text) => rewriteDevice(device.name, (entry) => applyConfigText(text, entry))}
  confirm={{
    title: 'Save configuration',
    message: `Replace the configuration of ${device.name} with this JSON? Settings it leaves out are removed.`,
    label: 'Save'
  }}
  {reload}
  bind:dirty={changed['Advanced']}
>
  {#snippet fields(f)}
    {@const error = f.errors['json'] ?? ''}
    <div class="field">
      <label class="field__label" for={`${uid}-json`} title={TIP.json}>Configuration as JSON</label>
      <textarea
        id={`${uid}-json`}
        class="input mono json"
        class:has-error={!!error}
        rows={jsonRows(f.draft)}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        title={TIP.json}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={`${error ? `${uid}-json-meta ` : ''}${uid}-json-tip`}
        value={f.draft}
        disabled={f.disabled}
        oninput={(e) => f.set(e.currentTarget.value)}
        onblur={f.touch}
      ></textarea>
      <small id={`${uid}-json-meta`} class="field__meta" class:field__meta--error={!!error}>{error || ' '}</small>
      <span id={`${uid}-json-tip`} class="sr-only">{TIP.json}</span>
    </div>
  {/snippet}
</DeviceSettingsCard>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 16px;
  }

  .wide {
    grid-column: span 2;
  }

  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 28px;
    margin-bottom: 16px;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--sw-text-sm);
    cursor: pointer;
  }

  .select {
    width: 100%;
  }

  .json {
    min-height: 12rem;
    line-height: 1.5;
  }

  .binding {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .binding-select {
    width: min(100%, 260px);
  }

  .save-ok {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
  }

  .save-error {
    font-size: var(--sw-text-xs);
    color: var(--sw-danger-text);
  }

  @media (max-width: 720px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .wide {
      grid-column: auto;
    }
  }
</style>
