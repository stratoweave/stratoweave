<script lang="ts">
  import { goto } from '$app/navigation';

  import { errorText } from '$lib/core/errors';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import Section from '$lib/core/ui/Section.svelte';
  import PlanningFields from '$lib/software/PlanningFields.svelte';
  import SelectionBuilder from '$lib/software/SelectionBuilder.svelte';
  import { campaignOwners } from '$lib/software/selection';
  import { restconfPatchJson } from '$lib/core/restconf/client';
  import {
    DATA_ROOT,
    DEFAULT_MAX_RATE,
    DEFAULT_TARGET_RATE,
    campaignCreatePatch,
    validateNewCampaign
  } from '$lib/software/model';
  import {
    emptyPlanningDraft,
    planningFromDraft,
    validatePlanningDraft,
    type PlanningDraft
  } from '$lib/software/planning-form';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let name = $state('');
  let targetRelease = $state('');
  let imageUrl = $state('');
  let allowStaging = $state(false);
  let members = $state<string[]>([]);
  let planning = $state<PlanningDraft>(emptyPlanningDraft());

  let touched = $state(false);
  let creating = $state(false);
  let createError = $state('');

  let errors = $derived({
    ...validateNewCampaign(
      { name, targetRelease, imageUrl, devices: members },
      data.campaigns.map((c) => c.name)
    ).errors,
    ...validatePlanningDraft(planning, Date.now() / 1000)
  });
  let visibleErrors = $derived(touched ? errors : ({} as Record<string, string>));

  async function handleCreate(): Promise<void> {
    touched = true;
    if (Object.keys(errors).length > 0) return;
    try {
      creating = true;
      createError = '';
      const campaign = name.trim();
      const p = planningFromDraft(planning);
      await restconfPatchJson(
        DATA_ROOT,
        campaignCreatePatch({
          name: campaign,
          targetRelease,
          imageUrl,
          devices: members,
          allowStaging,
          defaultSchedule: p.defaultSchedule || undefined,
          deadline: p.deadline,
          targetRate: p.targetRate === DEFAULT_TARGET_RATE ? null : p.targetRate,
          maxRate: p.maxRate === DEFAULT_MAX_RATE ? null : p.maxRate
        })
      );
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
    <h2>New campaign</h2>
    <p>
      Created in plan: declared and inspectable, doing nothing until you run it.
      The plan shows how the members fit the windows before anything is actuated.
    </p>
  </div>
</div>

{#if createError || data.loadError}
  <div class="error-state status">{createError || data.loadError}</div>
{/if}

<section class="card">
  <Section
    title="What"
    description="The release the members should be running, and where they fetch it."
    yangPath="software:software/upgrade-campaign"
  >
    <div class="grid-2">
      <FieldText
        label="Name"
        required={true}
        value={name}
        error={visibleErrors['name']}
        yangType="string"
        placeholder="e.g., xe-1718-emea"
        onchange={(v) => (name = v)}
        ontouch={() => (touched = true)}
      />
      <FieldText
        label="Target release"
        required={true}
        value={targetRelease}
        error={visibleErrors['target-release']}
        yangType="string"
        mono={true}
        placeholder="e.g., 17.18.03a"
        onchange={(v) => (targetRelease = v)}
        ontouch={() => (touched = true)}
      />
    </div>
    <FieldText
      label="Image URL"
      value={imageUrl}
      yangType="string"
      mono={true}
      placeholder="scp://user:password@host:/path/image.bin"
      help="The device fetches the image from here. The IOS XE adapter fails prepare without it."
      onchange={(v) => (imageUrl = v)}
    />
    <div class="cred-warning">
      A password embedded in the URL is readable wherever device configuration is readable,
      and is serialised by RPC debug logging.
    </div>
    <label class="staging">
      <input type="checkbox" bind:checked={allowStaging} />
      <span>Allow staging the image before the impacting step</span>
    </label>
  </Section>
</section>

<section class="card">
  <Section
    title="When"
    description="The shared maintenance schedule for members without a binding of their own, and the pace. Bound devices always follow their own schedule."
    yangPath="software:software/upgrade-campaign/default-schedule"
  >
    <PlanningFields
      schedules={data.schedules}
      draft={planning}
      errors={visibleErrors}
      onchange={(next) => {
        planning = next;
        touched = true;
      }}
    />
    <p class="note">
      Devices that do not fit the windows are not actuated and show as plan alarms.
      Windows are defined on the shared <a href="/schedules">schedules</a>.
    </p>
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
  .card {
    margin-bottom: 16px;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  .note {
    margin: 0;
    font-size: 12px;
    color: var(--sw-text-muted);
  }

  .note a {
    color: var(--sw-accent-bright);
  }

  .cred-warning {
    font-size: 12px;
    line-height: 1.6;
    color: var(--sw-warning);
    background: var(--sw-warning-dim);
    border: 1px solid rgb(var(--sw-warning-rgb) / 0.3);
    border-radius: 6px;
    padding: 9px 11px;
  }

  .staging {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
