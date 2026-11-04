<script lang="ts">
  import { goto } from '$app/navigation';

  import { errorText } from '$lib/core/errors';
  import { restconfPatchJson } from '$lib/core/restconf/client';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import Section from '$lib/core/ui/Section.svelte';
  import Steps from '$lib/core/ui/Steps.svelte';
  import { memberImages, modelGroups, withPreselected } from '$lib/software/campaign-images';
  import { DATA_ROOT, campaignCreatePatch, validateNewCampaign, type Device } from '$lib/software/model';
  import ModelImages from '$lib/software/ModelImages.svelte';
  import SelectionBuilder from '$lib/software/SelectionBuilder.svelte';
  import { campaignOwners, emptySelection, type Selection } from '$lib/software/selection';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // The third step is the campaign's own page, which shows its plan.
  const STEPS = ['Devices', 'Images', 'Plan'];

  let step = $state(1);
  // Held here, so that Back to the devices finds the filters as they were.
  let selection = $state<Selection>(emptySelection());
  let selected = $state<string[]>([]);
  // model -> image name, kept across Back and Next.
  let picks = $state<Record<string, string>>({});
  let name = $state('');
  let allowStaging = $state(false);

  let devicesTouched = $state(false);
  let touched = $state(false);
  let creating = $state(false);
  let createError = $state('');

  let owners = $derived(campaignOwners(data.campaigns));
  let scheduleNames = $derived(data.schedules.map((s) => s.name));
  let byName = $derived(new Map(data.devices.map((d) => [d.name, d])));
  let grouped = $derived(
    modelGroups(selected.map((n) => byName.get(n)).filter((d): d is Device => d !== undefined))
  );
  let members = $derived(memberImages(grouped.groups, picks, data.images));
  let errors = $derived(
    validateNewCampaign({ name, devices: members }, data.campaigns.map((c) => c.name)).errors
  );

  function devicesText(n: number): string {
    return n === 1 ? '1 device' : `${n.toLocaleString()} devices`;
  }

  function toImages(): void {
    devicesTouched = true;
    if (selected.length === 0) return;
    picks = withPreselected(grouped.groups, picks, data.images);
    step = 2;
  }

  async function create(): Promise<void> {
    touched = true;
    if (Object.keys(errors).length > 0) return;
    try {
      creating = true;
      createError = '';
      const campaign = name.trim();
      await restconfPatchJson(DATA_ROOT, campaignCreatePatch({ name: campaign, devices: members, allowStaging }));
      await goto(`/campaigns/${encodeURIComponent(campaign)}`, { invalidateAll: true });
    } catch (error) {
      createError = errorText(error, 'Failed to create the campaign.');
    } finally {
      creating = false;
    }
  }
</script>

<div class="page-header">
  <div>
    <h1>New campaign</h1>
  </div>
</div>

<Steps steps={STEPS} current={step} />

{#if createError || data.loadError}
  <div class="error-state status">{createError || data.loadError}</div>
{/if}

{#if step === 1}
  <section class="card">
    <Section title="Devices">
      {#if data.devices.length === 0}
        <div class="empty-state">No devices in the inventory.</div>
      {:else}
        <SelectionBuilder
          inventory={data.devices}
          {owners}
          schedules={scheduleNames}
          bind:selection
          error={devicesTouched && selected.length === 0 ? 'Select at least one device.' : ''}
          onchange={(names) => (selected = names)}
        />
      {/if}
      <div class="editor-actions">
        <a class="btn btn-secondary" href="/campaigns">Cancel</a>
        <button class="btn btn-primary" type="button" onclick={toImages}>
          Next: images ({devicesText(selected.length)})
        </button>
      </div>
    </Section>
  </section>
{:else}
  <section class="card">
    <Section title="Images" yangPath="software:software/upgrade-campaign/device/image">
      {#if grouped.groups.length === 0}
        <div class="empty-state">None of the selected devices has reported a model.</div>
      {:else}
        <ModelImages
          groups={grouped.groups}
          leftOut={grouped.leftOut}
          images={data.images}
          {picks}
          showErrors={touched}
          onpick={(model, image) => (picks = { ...picks, [model]: image })}
        />
      {/if}
    </Section>
  </section>

  <section class="card">
    <Section title="Campaign" yangPath="software:software/upgrade-campaign">
      <div class="name">
        <FieldText
          label="Name"
          required={true}
          value={name}
          error={touched ? errors['name'] : ''}
          yangType="string"
          placeholder="e.g., xe-1718-emea"
          onchange={(v) => (name = v)}
          ontouch={() => (touched = true)}
        />
      </div>
      <label class="staging">
        <input type="checkbox" bind:checked={allowStaging} />
        <span>Allow staging the image before the impacting step</span>
      </label>
      <div class="editor-actions">
        <button class="btn btn-secondary" type="button" onclick={() => (step = 1)}>Back</button>
        <button class="btn btn-primary" type="button" onclick={create} disabled={creating}>
          {creating ? 'Creating…' : `Create plan (${devicesText(members.length)})`}
        </button>
      </div>
    </Section>
  </section>
{/if}

<style>
  .name {
    max-width: 420px;
  }

  .staging {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--sw-text-sm);
    cursor: pointer;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
