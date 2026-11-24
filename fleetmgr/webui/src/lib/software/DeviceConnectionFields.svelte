<script lang="ts">
  // The connection sections of a device's settings: its addresses, its
  // credentials and keys, and its extra adapters. A stored password or
  // private key never comes to the page: the fields say whether one is
  // stored, and take a new one.
  import { tick, type Snippet } from 'svelte';

  import FieldFile from '#lib/core/ui/FieldFile.svelte';
  import FieldText from '#lib/core/ui/FieldText.svelte';
  import {
    newRowId,
    type AdapterRow,
    type AddressRow,
    type ConnectionDraft,
    type KeyRow,
    type SectionFields
  } from '#lib/software/device-config.ts';
  import { CLI_ADAPTER } from '#lib/software/inventory.ts';

  interface Props extends SectionFields<ConnectionDraft> {
    /** Frames a section of the form: its name, its YANG path, its fields. */
    section: Snippet<[string, string, Snippet]>;
  }

  let { draft, set, errors, touch, disabled, section }: Props = $props();

  const uid = $props.id();
  // A stored private key shows as a file by this name.
  const STORED_KEY = { name: 'Stored', text: '' };

  const TIP = {
    addressName: 'Name of the address, e.g. oob or loopback.',
    address: 'Hostname or IP address.',
    port: "Port of the device type's adapter. Default: the adapter's own.",
    username: 'The adapters log in as this user, unless an extra adapter has credentials of its own.',
    password: 'Write-only: the stored password never shows. Type a new one to replace it.',
    keyName: 'Name of the key, e.g. its file name. The private key file must have no passphrase; a stored one never shows.',
    adapterType: 'Device type of the adapter, e.g. iosxe-cli beside the NETCONF adapter of an IOS XE device.',
    adapterAddress: 'The address to connect to. Default: the first.',
    adapterPort: "Port to connect to. Default: the adapter's own. The address's port is for the device type's adapter."
  };

  let names = $derived([...new Set(draft.addresses.map((r) => r.name.trim()).filter(Boolean))]);
  let firstAddress = $derived(draft.addresses[0]?.name.trim() ?? '');

  function patch<R extends { id: string }>(rows: R[], id: string, change: Partial<R>): R[] {
    return rows.map((r) => (r.id === id ? { ...r, ...change } : r));
  }

  function setAddress(id: string, change: Partial<AddressRow>): void {
    set({ ...draft, addresses: patch(draft.addresses, id, change) });
  }

  function setKey(id: string, change: Partial<KeyRow>): void {
    set({ ...draft, keys: patch(draft.keys, id, change) });
  }

  function setAdapter(id: string, change: Partial<AdapterRow>): void {
    set({ ...draft, adapters: patch(draft.adapters, id, change) });
  }

  // The sections render apart, in the form's frames, so rows are found by
  // ids that are this component's own.
  /** Focus goes to the new row's first field. */
  async function added(id: string): Promise<void> {
    await tick();
    document.querySelector<HTMLElement>(`[data-row="${uid}-${id}"] input`)?.focus();
  }

  /** The removed row's button is gone: focus goes to its list's Add. */
  async function removed(list: string): Promise<void> {
    await tick();
    document.querySelector<HTMLElement>(`[data-add="${uid}-${list}"]`)?.focus();
  }

  function addAddress(): void {
    const id = newRowId();
    set({ ...draft, addresses: [...draft.addresses, { id, name: '', address: '', port: '', original: null }] });
    void added(id);
  }

  function addKey(): void {
    const id = newRowId();
    const row = { id, name: '', file: null, stored: false, needsKey: true, original: null };
    set({ ...draft, keys: [...draft.keys, row] });
    void added(id);
  }

  function addAdapter(): void {
    const id = newRowId();
    // The first adapter is most likely the CLI of an IOS XE device.
    const type = draft.adapters.some((r) => r.type.trim() === CLI_ADAPTER) ? '' : CLI_ADAPTER;
    set({ ...draft, adapters: [...draft.adapters, { id, type, address: '', port: '', original: null }] });
    void added(id);
  }
</script>

<!-- A row's Remove, under an empty label so that it lines up with the
     fields beside it. -->
{#snippet remove(label: string, onclick: () => void)}
  <div class="field remove">
    <span class="field__label" aria-hidden="true">&nbsp;</span>
    <button class="btn btn-ghost btn-sm row-remove" type="button" aria-label={label} {disabled} {onclick}>Remove</button>
  </div>
{/snippet}

{#snippet addresses()}
  {#each draft.addresses as row, i (row.id)}
    <div class="entry" role="group" aria-label={`Address ${i + 1}`} data-row={`${uid}-${row.id}`}>
      <FieldText
        label="Name"
        value={row.name}
        error={errors[`address.name.${row.id}`]}
        mono={true}
        placeholder="e.g. oob"
        tooltip={TIP.addressName}
        {disabled}
        onchange={(v) => setAddress(row.id, { name: v })}
        ontouch={touch}
      />
      <FieldText
        label="Address"
        value={row.address}
        error={errors[`address.address.${row.id}`]}
        mono={true}
        placeholder="hostname or IP"
        tooltip={TIP.address}
        {disabled}
        onchange={(v) => setAddress(row.id, { address: v })}
        ontouch={touch}
      />
      <FieldText
        label="Port"
        value={row.port}
        error={errors[`address.port.${row.id}`]}
        mono={true}
        placeholder="Default"
        tooltip={TIP.port}
        {disabled}
        onchange={(v) => setAddress(row.id, { port: v })}
        ontouch={touch}
      />
      {@render remove(`Remove address ${row.name.trim() || i + 1}`, () => {
        set({ ...draft, addresses: draft.addresses.filter((r) => r.id !== row.id) });
        void removed('address');
      })}
    </div>
  {/each}
  <button class="btn btn-secondary btn-sm add" type="button" data-add={`${uid}-address`} {disabled} onclick={addAddress}>
    Add address
  </button>
{/snippet}

{#snippet credentials()}
  <FieldText
    label="Username"
    value={draft.username}
    error={errors['username']}
    autocomplete="off"
    tooltip={TIP.username}
    {disabled}
    onchange={(v) => set({ ...draft, username: v })}
    ontouch={touch}
  />
  <div class="field">
    <label class="field__label" for={`${uid}-password`} title={TIP.password}>Password</label>
    <div class="password-row">
      <input
        id={`${uid}-password`}
        class="input compact"
        type="password"
        autocomplete="new-password"
        placeholder={draft.passwordSet ? 'Stored' : 'Not set'}
        title={TIP.password}
        aria-describedby={`${uid}-password-tip`}
        value={draft.password}
        {disabled}
        oninput={(e) => set({ ...draft, password: e.currentTarget.value })}
        onblur={touch}
      />
      {#if draft.passwordSet}
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          title="Remove the stored password"
          {disabled}
          onclick={() => set({ ...draft, password: '', passwordSet: false })}
        >
          Clear
        </button>
      {/if}
    </div>
    <span id={`${uid}-password-tip`} class="sr-only">{TIP.password}</span>
  </div>
  {#each draft.keys as row, i (row.id)}
    <div class="entry key-entry" role="group" aria-label={`Key ${i + 1}`} data-row={`${uid}-${row.id}`}>
      <FieldText
        label="Key name"
        value={row.name}
        error={errors[`key.name.${row.id}`]}
        mono={true}
        placeholder="e.g. id_ed25519"
        tooltip={TIP.keyName}
        {disabled}
        onchange={(v) => setKey(row.id, { name: v })}
        ontouch={touch}
      />
      <FieldFile
        label="Private key"
        value={row.file ?? (row.stored ? STORED_KEY : null)}
        error={errors[`key.file.${row.id}`]}
        {disabled}
        onchange={(file) => {
          // A key added with no name is named after its file.
          const name = file && !row.name.trim() ? file.name : row.name;
          setKey(row.id, { name, file, stored: false });
          touch();
        }}
      />
      {@render remove(`Remove key ${row.name.trim() || i + 1}`, () => {
        set({ ...draft, keys: draft.keys.filter((r) => r.id !== row.id) });
        void removed('key');
      })}
    </div>
  {/each}
  <button class="btn btn-secondary btn-sm add" type="button" data-add={`${uid}-key`} {disabled} onclick={addKey}>
    Add key
  </button>
{/snippet}

{#snippet adapters()}
  {#each draft.adapters as row, i (row.id)}
    {@const addressError = errors[`adapter.address.${row.id}`] ?? ''}
    <div class="entry" role="group" aria-label={`Extra adapter ${i + 1}`} data-row={`${uid}-${row.id}`}>
      <FieldText
        label="Type"
        value={row.type}
        error={errors[`adapter.type.${row.id}`]}
        mono={true}
        placeholder={CLI_ADAPTER}
        suggestions={[CLI_ADAPTER]}
        tooltip={TIP.adapterType}
        {disabled}
        onchange={(v) => setAdapter(row.id, { type: v })}
        ontouch={touch}
      />
      <div class="field">
        <label class="field__label" for={`${uid}-${row.id}-address`} title={TIP.adapterAddress}>Address</label>
        <select
          id={`${uid}-${row.id}-address`}
          class="select compact"
          class:has-error={!!addressError}
          title={TIP.adapterAddress}
          aria-invalid={addressError ? 'true' : undefined}
          aria-describedby={`${addressError ? `${uid}-${row.id}-address-meta ` : ''}${uid}-${row.id}-address-tip`}
          value={row.address}
          {disabled}
          onchange={(e) => setAdapter(row.id, { address: e.currentTarget.value })}
        >
          <option value="">{firstAddress ? `${firstAddress} (default)` : 'First (default)'}</option>
          {#each names as name (name)}
            <option value={name}>{name}</option>
          {/each}
          {#if row.address && !names.includes(row.address)}
            <option value={row.address}>{row.address} (missing)</option>
          {/if}
        </select>
        {#if addressError}
          <small id={`${uid}-${row.id}-address-meta`} class="field__meta field__meta--error">{addressError}</small>
        {/if}
        <span id={`${uid}-${row.id}-address-tip`} class="sr-only">{TIP.adapterAddress}</span>
      </div>
      <FieldText
        label="Port"
        value={row.port}
        error={errors[`adapter.port.${row.id}`]}
        mono={true}
        placeholder={row.type.trim() === CLI_ADAPTER ? '22 (default)' : 'Default'}
        tooltip={TIP.adapterPort}
        {disabled}
        onchange={(v) => setAdapter(row.id, { port: v })}
        ontouch={touch}
      />
      {@render remove(`Remove extra adapter ${row.type.trim() || i + 1}`, () => {
        set({ ...draft, adapters: draft.adapters.filter((r) => r.id !== row.id) });
        void removed('adapter');
      })}
    </div>
  {/each}
  <button class="btn btn-secondary btn-sm add" type="button" data-add={`${uid}-adapter`} {disabled} onclick={addAdapter}>
    Add adapter
  </button>
{/snippet}

{@render section('Addresses', '/fleet/device/address', addresses)}
{@render section('Credentials', '/fleet/device/credentials', credentials)}
{@render section('Extra adapters', '/fleet/device/extra-adapter', adapters)}

<style>
  /* An entry of a list takes the form's columns, so that names, addresses
     and ports line up from one list to the next. */
  .entry {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    row-gap: var(--sw-space-2);
  }

  .key-entry > :global(:nth-child(2)) {
    grid-column: span 2;
  }

  .remove {
    justify-items: start;
  }

  /* On a line of its own, under the entries. */
  .add {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .password-row {
    display: flex;
    gap: var(--sw-space-2);
  }

  /* As tall as the inputs beside them. */
  .remove .btn,
  .password-row .btn {
    min-height: 34px;
  }

  .select {
    width: 100%;
  }

  /* The entries under the first read as rows of a table: the labels are
     the first entry's, and theirs are for screen readers. */
  @media (min-width: 721px) {
    .entry + .entry :global(.field__label) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  @media (max-width: 720px) {
    .key-entry > :global(:nth-child(2)) {
      grid-column: auto;
    }

    /* A key's Remove has a line of its own, under the key. */
    .key-entry .remove > .field__label {
      display: none;
    }

    /* Each entry of a list stands apart from the next. */
    .entry + .entry {
      padding-top: var(--sw-space-2);
      border-top: 1px dashed var(--sw-border-subtle);
    }
  }

  @media (pointer: coarse) {
    .remove .btn,
    .password-row .btn {
      min-height: 44px;
    }
  }
</style>
