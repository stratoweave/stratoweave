<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { invalidate } from '$app/navigation';

  import { errorText } from '$lib/core/errors';
  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import Pager, { paginate } from '$lib/core/ui/Pager.svelte';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import Section from '$lib/core/ui/Section.svelte';
  import { getListEntryPath, restconfDelete, restconfPatchJson } from '$lib/core/restconf/client';
  import { bindPatch, unbindDevice } from '$lib/maintenance/binding';
  import { SCHEDULE_COLOR_OTHER, scheduleColors } from '$lib/maintenance/palette';
  import { DATA_ROOT, FLEET_DEVICE_LIST_ROOT, type Device, type Schedule } from '$lib/software/model';
  import { nameMatcher } from '$lib/software/selection';
  import {
    IMPORT_BATCH,
    assignNodes,
    chunk,
    devicesPatch,
    parseImport,
    validateNewDevice,
    type NewDeviceInput
  } from '$lib/software/inventory';

  const PAGE_SIZE = 100;

  let {
    data
  }: {
    data: {
      nodes: string[];
      devices: Device[];
      schedules: Schedule[];
      scheduleFilter: string;
      loadError: string;
    };
  } = $props();

  let draft = $state<NewDeviceInput | null>(null);
  let importOpen = $state(false);
  let importText = $state('');
  let importType = $state('iosxe');
  let touched = $state(false);
  let saving = $state(false);
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let deleteTarget = $state<Device | null>(null);
  let deleting = $state(false);

  let filterText = $state('');
  let filterType = $state('');
  // Schedule selects hold '' (any or nothing chosen), 'none' or '=NAME'.
  let filterSchedule = $state(untrack(() => (data.scheduleFilter ? `=${data.scheduleFilter}` : '')));
  let page = $state(1);

  let types = $derived([...new Set(data.devices.map((d) => d.type))].sort());
  let scheduleNames = $derived(data.schedules.map((s) => s.name));
  let knownSchedules = $derived(new Set(scheduleNames));
  let colors = $derived(scheduleColors(scheduleNames));
  // Bindings to a schedule that does not exist: the planner places those
  // devices in no window.
  let missingSchedules = $derived(
    [...new Set([...data.devices.map((d) => d.schedule), data.scheduleFilter])]
      .filter((name) => name && !knownSchedules.has(name))
      .sort()
  );

  function scheduleMatches(device: Device, filter: string): boolean {
    if (filter === '') return true;
    if (filter === 'none') return device.schedule === '';
    return device.schedule === filter.slice(1);
  }

  // The API returns devices in no particular order; ranges and pages need one.
  let sorted = $derived([...data.devices].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
  let filtered = $derived.by(() => {
    const matchName = nameMatcher(filterText.trim());
    return sorted.filter(
      (d) => matchName(d.name) && (!filterType || d.type === filterType) && scheduleMatches(d, filterSchedule)
    );
  });
  let paged = $derived(paginate(filtered, page, PAGE_SIZE));
  let visible = $derived(paged.rows);

  // The selection is by name and survives filter and page changes; the bar
  // says how many selected devices the filter hides.
  let selected = $state(new Set<string>());
  // Last row clicked: a shift-click selects the range from it on this page.
  let anchor = $state('');
  let chosen = $derived(sorted.filter((d) => selected.has(d.name)));
  let chosenShown = $derived(filtered.filter((d) => selected.has(d.name)).length);
  let pageChosen = $derived(visible.filter((d) => selected.has(d.name)).length);
  let pageAllChosen = $derived(visible.length > 0 && pageChosen === visible.length);

  let bindChoice = $state('');
  let confirmBind = $state(false);
  let applying = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);
  // Shown in the bar, next to where the operator works on a long page.
  let bindError = $state('');
  let stopRequested = false;

  // Leaving the page stops an unbind between two writes.
  onDestroy(() => (stopRequested = true));

  let bindPlan = $derived.by(() => {
    if (!bindChoice) return null;
    const schedule = bindChoice === 'none' ? '' : bindChoice.slice(1);
    const change = chosen.filter((d) => d.schedule !== schedule);
    return { schedule, change, unchanged: chosen.length - change.length };
  });

  function devicesText(n: number): string {
    return `${n.toLocaleString()} device${n === 1 ? '' : 's'}`;
  }

  function namesText(devices: Device[]): string {
    const head = devices.slice(0, 3).map((d) => d.name).join(', ');
    return devices.length > 3 ? `${head} and ${(devices.length - 3).toLocaleString()} more` : head;
  }

  let bindMessage = $derived.by(() => {
    if (!bindPlan) return '';
    const { schedule, change, unchanged } = bindPlan;
    if (schedule) {
      const same = unchanged > 0 ? ` ${devicesText(unchanged)} already are.` : '';
      return `Bind ${devicesText(change.length)} (${namesText(change)}) to ${schedule}?${same} Campaigns with these devices re-plan; a running campaign can start a device as soon as its new window opens.`;
    }
    const same = unchanged > 0 ? ` ${devicesText(unchanged)} have none already.` : '';
    return `Unbind ${devicesText(change.length)} (${namesText(change)})?${same} They follow each campaign's default schedule. This writes one device at a time; leaving the page stops it.`;
  });

  function toggleRow(device: Device, shift: boolean): void {
    const on = !selected.has(device.name);
    const next = new Set(selected);
    const from = shift && anchor ? visible.findIndex((d) => d.name === anchor) : -1;
    const to = visible.findIndex((d) => d.name === device.name);
    if (from >= 0 && to >= 0) {
      for (const d of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (on) next.add(d.name);
        else next.delete(d.name);
      }
    } else if (on) {
      next.add(device.name);
    } else {
      next.delete(device.name);
    }
    anchor = device.name;
    selected = next;
  }

  function togglePage(): void {
    const next = new Set(selected);
    for (const d of visible) {
      if (pageAllChosen) next.delete(d.name);
      else next.add(d.name);
    }
    selected = next;
  }

  function selectAllMatching(): void {
    selected = new Set([...selected, ...filtered.map((d) => d.name)]);
  }

  function clearSelection(): void {
    selected = new Set();
    anchor = '';
    bindError = '';
  }

  async function handleBind(): Promise<void> {
    confirmBind = false;
    const plan = bindPlan;
    if (!plan || plan.change.length === 0) return;
    const names = plan.change.map((d) => d.name);
    applying = true;
    statusMessage = null;
    bindError = '';
    let done = 0;
    let current = '';
    try {
      if (plan.schedule) {
        await restconfPatchJson(DATA_ROOT, bindPatch(names, plan.schedule));
        done = names.length;
      } else {
        stopRequested = false;
        progress = { done, total: names.length };
        for (const name of names) {
          if (stopRequested) break;
          current = name;
          await unbindDevice(name);
          done += 1;
          progress = { done, total: names.length };
        }
      }
      if (done === names.length) {
        statusMessage = {
          type: 'success',
          text: plan.schedule
            ? `Bound ${devicesText(done)} to ${plan.schedule}.`
            : `Unbound ${devicesText(done)}.`
        };
        clearSelection();
        bindChoice = '';
      } else {
        bindError = `Stopped after unbinding ${done} of ${devicesText(names.length)}.`;
      }
    } catch (writeError) {
      const reason = errorText(writeError, 'the write failed');
      bindError = plan.schedule
        ? `Nothing bound: ${reason}`
        : `Unbound ${done} of ${devicesText(names.length)}; ${current} failed: ${reason}`;
    } finally {
      applying = false;
      progress = null;
      await invalidate('data:software');
    }
  }

  let validation = $derived(
    draft
      ? validateNewDevice(draft, data.devices.map((d) => d.name))
      : { ok: true, errors: {} as Record<string, string> }
  );
  let errors = $derived(touched ? validation.errors : ({} as Record<string, string>));

  function openNew(): void {
    draft = { name: '', type: 'iosxe', address: '', port: '' };
    importOpen = false;
    touched = false;
    statusMessage = null;
  }

  function openImport(): void {
    importOpen = true;
    draft = null;
    statusMessage = null;
  }

  function closeEditor(): void {
    draft = null;
    importOpen = false;
    touched = false;
  }

  function patch(partial: Partial<NewDeviceInput>): void {
    if (draft) draft = { ...draft, ...partial };
  }

  async function handleAdd(): Promise<void> {
    if (!draft) return;
    touched = true;
    if (!validation.ok) return;
    try {
      saving = true;
      statusMessage = null;
      const name = draft.name.trim();
      const entries = assignNodes([draft], data.devices, data.nodes);
      await restconfPatchJson(DATA_ROOT, devicesPatch(entries));
      statusMessage = { type: 'success', text: `Added device ${name}.` };
      closeEditor();
      await invalidate('data:software');
    } catch (saveError) {
      statusMessage = {
        type: 'error',
        text: errorText(saveError, 'Failed to add the device.')
      };
    } finally {
      saving = false;
    }
  }

  async function handleImport(): Promise<void> {
    try {
      saving = true;
      statusMessage = null;
      const existing = new Set(data.devices.map((d) => d.name));
      const result = parseImport(importText, importType.trim() || 'iosxe', existing);
      if (result.errors.length > 0) {
        statusMessage = {
          type: 'error',
          text: `Import not started: ${result.errors.slice(0, 5).join('; ')}${result.errors.length > 5 ? ` (+${result.errors.length - 5} more)` : ''}`
        };
        return;
      }
      if (result.inputs.length === 0) {
        statusMessage = {
          type: 'error',
          text:
            result.skippedExisting.length > 0
              ? `Nothing to import: all ${result.skippedExisting.length} names already exist.`
              : 'Nothing to import.'
        };
        return;
      }
      const entries = assignNodes(result.inputs, data.devices, data.nodes);
      for (const batch of chunk(entries, IMPORT_BATCH)) {
        await restconfPatchJson(DATA_ROOT, devicesPatch(batch));
      }
      const skipped =
        result.skippedExisting.length > 0 ? `, ${result.skippedExisting.length} already existed` : '';
      statusMessage = { type: 'success', text: `Imported ${entries.length} devices${skipped}.` };
      importText = '';
      closeEditor();
      await invalidate('data:software');
    } catch (importError) {
      statusMessage = {
        type: 'error',
        text: errorText(importError, 'Import failed.')
      };
    } finally {
      saving = false;
    }
  }

  async function handleDelete(): Promise<void> {
    const target = deleteTarget;
    if (!target) return;
    try {
      deleting = true;
      statusMessage = null;
      await restconfDelete(getListEntryPath(FLEET_DEVICE_LIST_ROOT, target.name));
      statusMessage = { type: 'success', text: `Removed device ${target.name}.` };
      await invalidate('data:software');
    } catch (deleteError) {
      statusMessage = {
        type: 'error',
        text: errorText(deleteError, 'Failed to remove the device.')
      };
    } finally {
      deleting = false;
      deleteTarget = null;
    }
  }
</script>

<div class="page-header">
  <div>
    <h2>Devices</h2>
    <p>
      The fleet inventory. Entries added here get the lab credentials
      (admin/admin) and are placed onto internal workers automatically.
      Lab deploys usually onboard devices over RESTCONF once their
      addresses are known.
    </p>
  </div>
  <div class="header-buttons">
    <button class="btn btn-secondary" type="button" onclick={openImport} disabled={saving || applying}>
      Import
    </button>
    <button class="btn btn-primary" type="button" onclick={openNew} disabled={saving || applying}>
      Add device
    </button>
  </div>
</div>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

{#if statusMessage}
  <div class={statusMessage.type === 'error' ? 'error-state status' : 'success-banner status'}>
    {statusMessage.text}
  </div>
{/if}

{#if draft}
  <section class="card editor-card">
    <Section
      title="Add device"
      description="An address makes it a real endpoint; mock entries need none."
      yangPath="fleetmgr:fleet/device"
    >
      <div class="grid-2">
        <FieldText
          label="Name"
          required={true}
          value={draft.name}
          error={errors['name']}
          yangType="string"
          placeholder="e.g., ce1"
          onchange={(value) => patch({ name: value })}
          ontouch={() => (touched = true)}
        />
        <FieldText
          label="Type"
          required={true}
          value={draft.type}
          error={errors['type']}
          yangType="string"
          mono={true}
          placeholder="iosxe"
          onchange={(value) => patch({ type: value })}
          ontouch={() => (touched = true)}
        />
        <FieldText
          label="Management address"
          value={draft.address}
          error={errors['address']}
          yangType="inet:host"
          mono={true}
          placeholder="hostname or IP"
          onchange={(value) => patch({ address: value })}
          ontouch={() => (touched = true)}
        />
        <FieldText
          label="NETCONF port"
          value={draft.port}
          error={errors['port']}
          yangType="uint16"
          mono={true}
          placeholder="830"
          onchange={(value) => patch({ port: value })}
          ontouch={() => (touched = true)}
        />
      </div>
      <div class="editor-actions">
        <button class="btn btn-secondary" type="button" onclick={closeEditor} disabled={saving}>
          Cancel
        </button>
        <button class="btn btn-primary" type="button" onclick={handleAdd} disabled={saving}>
          {saving ? 'Adding…' : 'Add device'}
        </button>
      </div>
    </Section>
  </section>
{/if}

{#if importOpen}
  <section class="card editor-card">
    <Section
      title="Import devices"
      description="One device per line: name[,address[,port]]. Lines starting with # are ignored; existing names are skipped."
      yangPath="fleetmgr:fleet/device"
    >
      <FieldText
        label="Type for all imported devices"
        value={importType}
        yangType="string"
        mono={true}
        placeholder="iosxe"
        onchange={(value) => (importType = value)}
      />
      <textarea
        class="import-text mono"
        rows="10"
        placeholder="ce1,192.0.2.11&#10;ce2,192.0.2.12,830&#10;mock-001"
        bind:value={importText}
      ></textarea>
      <div class="editor-actions">
        <button class="btn btn-secondary" type="button" onclick={closeEditor} disabled={saving}>
          Cancel
        </button>
        <button class="btn btn-primary" type="button" onclick={handleImport} disabled={saving}>
          {saving ? 'Importing…' : 'Import'}
        </button>
      </div>
    </Section>
  </section>
{/if}

<section class="card">
  {#if data.devices.length === 0}
    <div class="empty-state">No devices yet. Add or import some, or seed the fleet from a lab deploy.</div>
  {:else}
    <div class="filter-row">
      <input
        class="filter-input mono"
        type="text"
        placeholder="filter by name (glob with * and ?)"
        bind:value={filterText}
        oninput={() => (page = 1)}
      />
      <select class="select compact" bind:value={filterType} onchange={() => (page = 1)}>
        <option value="">all types</option>
        {#each types as t (t)}
          <option value={t}>{t}</option>
        {/each}
      </select>
      <select class="select compact" bind:value={filterSchedule} onchange={() => (page = 1)}>
        <option value="">all schedules</option>
        <option value="none">no schedule</option>
        {#each scheduleNames as name (name)}
          <option value={`=${name}`}>{name}</option>
        {/each}
        {#each missingSchedules as name (name)}
          <option value={`=${name}`}>{name} (missing)</option>
        {/each}
      </select>
      <span class="filter-count">{filtered.length} of {data.devices.length}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-check">
              <input
                type="checkbox"
                aria-label="Select the devices on this page"
                checked={pageAllChosen}
                indeterminate={pageChosen > 0 && !pageAllChosen}
                disabled={applying || visible.length === 0}
                onchange={togglePage}
              />
            </th>
            <th>Device</th>
            <th>Type</th>
            <th>Address</th>
            <th>Schedule</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each visible as device (device.name)}
            <tr class:chosen={selected.has(device.name)}>
              <td class="col-check">
                <!-- preventDefault on a shift mousedown keeps the browser from selecting text. -->
                <input
                  type="checkbox"
                  aria-label={`Select ${device.name}`}
                  checked={selected.has(device.name)}
                  disabled={applying}
                  onmousedown={(e) => e.shiftKey && e.preventDefault()}
                  onclick={(e) => toggleRow(device, e.shiftKey)}
                />
              </td>
              <td>
                <a class="device-name" href={`/devices/${encodeURIComponent(device.name)}`}>{device.name}</a>
              </td>
              <td>{device.type}</td>
              <td class="mono">{device.address || '—'}</td>
              <td>
                {#if !device.schedule}
                  <span class="dim" title="No binding: each campaign's default schedule applies">—</span>
                {:else if knownSchedules.has(device.schedule)}
                  <a class="schedule-name mono" href={`/schedules/${encodeURIComponent(device.schedule)}`}>
                    <span class="swatch" style:background={colors.get(device.schedule) ?? SCHEDULE_COLOR_OTHER}></span>
                    {device.schedule}
                  </a>
                {:else}
                  <span class="mono missing" title="No schedule by this name: the device is placed in no window">
                    {device.schedule} (missing)
                  </span>
                {/if}
              </td>
              <td class="col-action">
                <button
                  class="btn btn-secondary btn-small btn-danger-ghost"
                  type="button"
                  disabled={saving || deleting || applying}
                  onclick={() => (deleteTarget = device)}
                >
                  Remove
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (page = p)} />
    {#if chosen.length > 0}
      <div class="selection-bar">
        <span class="tn"><strong>{chosen.length.toLocaleString()}</strong> selected</span>
        {#if chosen.length > chosenShown}
          <span class="dim tn">{(chosen.length - chosenShown).toLocaleString()} hidden by the filter</span>
        {/if}
        {#if chosenShown < filtered.length}
          <button class="link-button tn" type="button" disabled={applying} onclick={selectAllMatching}>
            Select all {filtered.length.toLocaleString()}{filtered.length < data.devices.length ? ' matching' : ''}
          </button>
        {/if}
        <button class="link-button" type="button" disabled={applying} onclick={clearSelection}>Clear</button>
        <span class="spacer"></span>
        <label class="dim" for="bind-choice">Schedule</label>
        <select
          id="bind-choice"
          class="select compact"
          bind:value={bindChoice}
          disabled={applying}
          onchange={() => (bindError = '')}
        >
          <option value="" disabled>choose…</option>
          <option value="none">none (campaign default)</option>
          {#each scheduleNames as name (name)}
            <option value={`=${name}`}>{name}</option>
          {/each}
        </select>
        {#if scheduleNames.length === 0}
          <a class="link-button" href="/schedules/new">create a schedule</a>
        {/if}
        {#if bindPlan && bindPlan.change.length === 0}
          <span class="dim">already set on all selected</span>
        {/if}
        {#if progress}
          <span class="tn">Unbinding {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…</span>
          <button class="btn btn-secondary btn-small" type="button" onclick={() => (stopRequested = true)}>
            Stop
          </button>
        {:else}
          <button
            class="btn btn-primary btn-small"
            type="button"
            disabled={applying || !bindPlan || bindPlan.change.length === 0}
            onclick={() => (confirmBind = true)}
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        {/if}
        {#if bindError}
          <div class="bar-error">{bindError}</div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<ConfirmDialog
  open={confirmBind}
  title={bindPlan?.schedule ? 'Bind devices' : 'Unbind devices'}
  message={bindMessage}
  confirmLabel={bindPlan?.schedule ? 'Bind' : 'Unbind'}
  confirmClass="btn-primary"
  oncancel={() => (confirmBind = false)}
  onconfirm={handleBind}
/>

<ConfirmDialog
  open={deleteTarget !== null}
  title="Remove device"
  message={`Remove ${deleteTarget?.name ?? ''} from the fleet? The orchestrator disconnects from it.`}
  confirmLabel={deleting ? 'Removing…' : 'Remove'}
  oncancel={() => (deleteTarget = null)}
  onconfirm={handleDelete}
/>

<style>
  .status {
    margin-bottom: 12px;
  }

  .success-banner {
    padding: 10px 14px;
    border-radius: var(--sw-radius-md);
    border: 1px solid rgb(var(--sw-accent-rgb) / 0.35);
    background: var(--sw-accent-glow);
    color: var(--sw-text-primary);
    font-size: 13px;
  }

  .header-buttons {
    display: flex;
    gap: 8px;
  }

  .card {
    padding: 20px;
    margin-bottom: 16px;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .filter-input {
    flex: 1;
    max-width: 320px;
    padding: 7px 10px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    color: var(--sw-text-primary);
    font-size: 12px;
    outline: none;
  }

  .filter-input:focus {
    border-color: var(--sw-accent);
  }

  .filter-row .select,
  #bind-choice {
    width: 10rem;
  }

  .filter-count {
    font-size: 12px;
    color: var(--sw-text-muted);
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
  }

  td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--sw-border-default);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .device-name {
    font-weight: 600;
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .device-name:hover {
    color: var(--sw-accent);
  }

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
    white-space: nowrap;
  }

  .col-action {
    text-align: right;
    white-space: nowrap;
  }

  .col-check {
    width: 1%;
    padding-right: 0;
  }

  .col-check input {
    display: block;
    accent-color: var(--sw-accent);
    cursor: pointer;
  }

  tbody tr.chosen td {
    background: var(--sw-accent-glow);
  }

  .schedule-name {
    color: var(--sw-accent-bright);
    text-decoration: none;
    font-size: 12.5px;
  }

  .schedule-name:hover {
    color: var(--sw-accent);
  }

  .swatch {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    margin-right: 6px;
    vertical-align: middle;
  }

  .missing {
    color: var(--sw-warning);
    font-size: 12.5px;
  }

  .dim {
    color: var(--sw-text-muted);
  }

  /* Sticks to the bottom of the view while a long page scrolls. */
  .selection-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 12px;
    padding: 10px 14px;
    border: 1px solid var(--sw-accent-glow-strong);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-elevated);
    box-shadow: var(--sw-shadow-sticky);
    font-size: 13px;
  }

  .spacer {
    flex: 1;
  }

  .link-button {
    background: none;
    border: none;
    padding: 0;
    color: var(--sw-accent-bright);
    font: inherit;
    cursor: pointer;
  }

  .link-button:hover:not(:disabled) {
    color: var(--sw-accent);
    text-decoration: underline;
  }

  .bar-error {
    flex-basis: 100%;
    font-size: 12px;
    color: var(--sw-danger);
  }

  .link-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-small {
    padding: 4px 10px;
    font-size: 12px;
  }

  .btn-danger-ghost {
    color: var(--sw-danger);
  }

  .grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  .import-text {
    width: 100%;
    padding: 9px 12px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    color: var(--sw-text-primary);
    font-size: 12px;
    resize: vertical;
    outline: none;
    white-space: pre;
  }

  .import-text:focus {
    border-color: var(--sw-accent);
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
