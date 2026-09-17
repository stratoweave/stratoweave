<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidate } from '$app/navigation';

  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import Section from '$lib/core/ui/Section.svelte';
  import { getListEntryPath, restconfDelete, restconfPatchJson } from '$lib/core/restconf/client';
  import { DATA_ROOT, FLEET_DEVICE_LIST_ROOT, type Device } from '$lib/software/model';
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
  }: { data: { nodes: string[]; devices: Device[]; loadError: string } } = $props();

  let draft = $state<NewDeviceInput | null>(null);
  let importOpen = $state(false);
  let importText = $state('');
  let importType = $state('iosxe');
  let touched = $state(false);
  let validationKey = $state(0);
  let saving = $state(false);
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(
    untrack(() => (data.loadError ? { type: 'error', text: data.loadError } : null))
  );
  let deleteTarget = $state<Device | null>(null);
  let deleting = $state(false);

  let filterText = $state('');
  let filterType = $state('');
  let page = $state(1);

  let types = $derived([...new Set(data.devices.map((d) => d.type))].sort());

  function nameMatches(name: string, filter: string): boolean {
    if (!filter) return true;
    if (filter.includes('*') || filter.includes('?')) {
      const rx = new RegExp(
        `^${filter.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')}$`,
        'i'
      );
      return rx.test(name);
    }
    return name.toLowerCase().includes(filter.toLowerCase());
  }

  let filtered = $derived(
    data.devices.filter(
      (d) => nameMatches(d.name, filterText.trim()) && (!filterType || d.type === filterType)
    )
  );
  let pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  let currentPage = $derived(Math.min(page, pageCount));
  let visible = $derived(filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));

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
    validationKey += 1;
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
    if (!validation.ok) {
      validationKey += 1;
      return;
    }
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
        text: saveError instanceof Error ? saveError.message : 'Failed to add the device.'
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
        text: importError instanceof Error ? importError.message : 'Import failed.'
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
        text: deleteError instanceof Error ? deleteError.message : 'Failed to remove the device.'
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
    <button class="btn btn-secondary" type="button" onclick={openImport} disabled={saving}>
      Import
    </button>
    <button class="btn btn-primary" type="button" onclick={openNew} disabled={saving}>
      Add device
    </button>
  </div>
</div>

{#if statusMessage}
  <div class={statusMessage.type === 'error' ? 'error-state status' : 'success-banner status'}>
    {statusMessage.text}
  </div>
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
      <select class="filter-select" bind:value={filterType} onchange={() => (page = 1)}>
        <option value="">all types</option>
        {#each types as t (t)}
          <option value={t}>{t}</option>
        {/each}
      </select>
      <span class="filter-count">{filtered.length} of {data.devices.length}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Type</th>
            <th>Address</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each visible as device (device.name)}
            <tr>
              <td>
                <a class="device-name" href={`/devices/${encodeURIComponent(device.name)}`}>{device.name}</a>
              </td>
              <td>{device.type}</td>
              <td class="mono">{device.address || '—'}</td>
              <td class="col-action">
                <button
                  class="btn btn-secondary btn-small btn-danger-ghost"
                  type="button"
                  disabled={saving || deleting}
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
    {#if pageCount > 1}
      <div class="pager">
        <button class="btn btn-secondary btn-small" type="button" disabled={currentPage <= 1} onclick={() => (page = currentPage - 1)}>
          ‹
        </button>
        <span>page {currentPage} / {pageCount}</span>
        <button class="btn btn-secondary btn-small" type="button" disabled={currentPage >= pageCount} onclick={() => (page = currentPage + 1)}>
          ›
        </button>
      </div>
    {/if}
  {/if}
</section>

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
          {validationKey}
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
          {validationKey}
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
          {validationKey}
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
          {validationKey}
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

  .filter-select {
    padding: 7px 10px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    color: var(--sw-text-primary);
    font-size: 12px;
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

  .pager {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 10px;
    font-size: 12px;
    color: var(--sw-text-secondary);
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
