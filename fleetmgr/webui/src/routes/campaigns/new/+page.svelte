<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';

  import FieldText from '$lib/core/ui/FieldText.svelte';
  import Section from '$lib/core/ui/Section.svelte';
  import SelectionBuilder from '$lib/software/SelectionBuilder.svelte';
  import { campaignOwners } from '$lib/software/selection';
  import { restconfPatchJson } from '$lib/core/restconf/client';
  import { DATA_ROOT, campaignCreatePatch, type Device } from '$lib/software/model';

  let {
    data
  }: {
    data: {
      devices: Device[];
      campaigns: import('$lib/software/model').Campaign[];
      images: import('$lib/software/model').CatalogImage[];
      matrix: import('$lib/software/model').MatrixEntry[];
      loadError: string;
    };
  } = $props();

  let name = $state('');
  let targetRelease = $state('');
  let imageUrl = $state('');
  let allowStaging = $state(false);
  let outsideCatalog = $state(false);

  let approvedImages = $derived(
    data.images
      .filter((i) => i.approvalState === 'approved')
      .sort((a, b) => (a.version < b.version ? 1 : -1))
  );
  let useCatalog = $derived(approvedImages.length > 0 && !outsideCatalog);

  function modelsCleared(version: string): string {
    if (data.matrix.length === 0) return '';
    const cleared = data.matrix.filter(
      (m) => m.targetVersion === version && m.approval !== 'excluded'
    ).length;
    return ` — approved, ${cleared} of ${data.matrix.length} models cleared`;
  }
  let members = $state<string[]>([]);

  let touched = $state(false);
  let validationKey = $state(0);
  let creating = $state(false);
  let statusMessage = $state<string>(untrack(() => data.loadError));

  let errors = $derived.by(() => {
    const e: Record<string, string> = {};
    const n = name.trim();
    if (!n) {
      e['name'] = 'A name is required.';
    } else if (data.campaigns.some((c) => c.name === n)) {
      e['name'] = `${n} is already in use.`;
    }
    if (!targetRelease.trim()) {
      e['target-release'] = 'A target release is required.';
    }
    if (members.length === 0) {
      e['device'] = 'Select at least one device.';
    }
    return e;
  });
  let visibleErrors = $derived(touched ? errors : ({} as Record<string, string>));

  async function handleCreate(): Promise<void> {
    touched = true;
    if (Object.keys(errors).length > 0) {
      validationKey += 1;
      return;
    }
    try {
      creating = true;
      statusMessage = '';
      const campaign = name.trim();
      await restconfPatchJson(
        DATA_ROOT,
        campaignCreatePatch({ name: campaign, targetRelease, imageUrl, devices: members, allowStaging })
      );
      await goto(`/campaigns/${encodeURIComponent(campaign)}`);
    } catch (createError) {
      statusMessage =
        createError instanceof Error ? createError.message : 'Failed to create the campaign.';
    } finally {
      creating = false;
    }
  }
</script>

<div class="page-header">
  <div>
    <h2>New campaign</h2>
    <p>
      Created in plan: declared and inspectable, doing nothing until you
      run it. Run fires all members at once.
    </p>
  </div>
</div>

{#if statusMessage}
  <div class="error-state status">{statusMessage}</div>
{/if}

<section class="card">
  <Section
    title="What"
    description="The release the members should be running."
    yangPath="software:software/upgrade-campaign"
  >
    <div class="grid-2">
      <FieldText
        label="Name"
        required={true}
        value={name}
        error={visibleErrors['name']}
        {validationKey}
        yangType="string"
        placeholder="e.g., xe-1718-emea"
        onchange={(v) => (name = v)}
        ontouch={() => (touched = true)}
      />
      {#if useCatalog}
        <div class="picker">
          <span class="kick picker-label">target-release <span class="req">*</span></span>
          <select
            class="fld mono"
            value={targetRelease}
            onchange={(e) => (targetRelease = e.currentTarget.value)}
          >
            <option value="" disabled>pick an approved image</option>
            {#each approvedImages as image (image.version)}
              <option value={image.version}>{image.version}{modelsCleared(image.version)}</option>
            {/each}
          </select>
          {#if touched && errors['target-release']}
            <span class="err">{errors['target-release']}</span>
          {/if}
        </div>
      {:else}
        <FieldText
          label="Target release"
          required={true}
          value={targetRelease}
          error={visibleErrors['target-release']}
          {validationKey}
          yangType="string"
          mono={true}
          placeholder="e.g., 17.18.03a"
          onchange={(v) => (targetRelease = v)}
          ontouch={() => (touched = true)}
        />
      {/if}
    </div>
    {#if useCatalog}
      <div class="cat-note">
        Approved images only, from the <a href="/images">catalogue</a>. File name, checksum,
        storage and ROMMON requirements and the rollback path come with the record — there is
        no image URL to type.
        <button class="link" type="button" onclick={() => (outsideCatalog = true)}>
          Use a release outside the catalogue
        </button>
      </div>
    {:else}
      <FieldText
        label="Image URL"
        value={imageUrl}
        {validationKey}
        yangType="string"
        mono={true}
        placeholder="scp://user:password@host:/path/image.bin"
        help="Fallback while the release is not in the catalogue. The IOS XE adapter fails prepare without it."
        onchange={(v) => (imageUrl = v)}
      />
      <div class="cred-warning">
        Credentials belong to the image server record, not to this campaign. A password
        embedded in a per-campaign URL is readable wherever device configuration is readable,
        and is serialised by RPC debug logging.
      </div>
      {#if approvedImages.length > 0}
        <button class="link" type="button" onclick={() => { outsideCatalog = false; targetRelease = ''; }}>
          Back to the catalogue picker
        </button>
      {/if}
    {/if}
    <label class="staging">
      <input type="checkbox" bind:checked={allowStaging} />
      <span>Allow staging the image before the impacting step</span>
    </label>
  </Section>
</section>

<section class="card">
  <Section title="Who" description="Expanded to explicit members at create time.">
    {#if data.devices.length === 0}
      <div class="empty-state">No devices in the inventory.</div>
    {:else}
      <SelectionBuilder
        inventory={data.devices}
        owners={campaignOwners(data.campaigns)}
        matrix={data.matrix}
        error={touched ? errors['device'] : ''}
        onchange={(names) => (members = names)}
      />
    {/if}
    <div class="editor-actions">
      <a class="btn btn-secondary" href="/campaigns">Cancel</a>
      <button class="btn btn-primary" type="button" onclick={handleCreate} disabled={creating}>
        {creating
          ? 'Creating…'
          : `Create in plan (${members.length.toLocaleString()} device${members.length === 1 ? '' : 's'})`}
      </button>
    </div>
  </Section>
</section>

<style>
  .status {
    margin-bottom: 12px;
  }

  .card {
    padding: 20px;
    margin-bottom: 16px;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }


  .picker {
    display: grid;
    gap: 5px;
    align-content: start;
  }

  .picker-label {
    display: block;
  }

  .req {
    color: var(--sw-danger);
    font-weight: 700;
  }

  .fld {
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: 6px;
    color: var(--sw-text-primary);
    padding: 8px 10px;
    font-size: 12.5px;
    outline: none;
    width: 100%;
  }

  .err {
    font-size: 11px;
    color: var(--sw-danger);
  }

  .cat-note {
    font-size: 12px;
    color: var(--sw-text-muted);
    line-height: 1.6;
  }

  .cred-warning {
    font-size: 12px;
    line-height: 1.6;
    color: var(--sw-warning);
    background: var(--sw-warning-dim);
    border: 1px solid rgba(251, 191, 36, 0.28);
    border-radius: 6px;
    padding: 9px 11px;
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--sw-accent);
    font-size: 12px;
    cursor: pointer;
  }

  .link:hover {
    color: #8b5cf6;
  }

  .staging {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
  }






  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
  }


  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
