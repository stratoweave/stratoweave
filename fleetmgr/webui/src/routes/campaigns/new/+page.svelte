<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';

  import FieldText from '$lib/core/ui/FieldText.svelte';
  import Section from '$lib/core/ui/Section.svelte';
  import SelectionBuilder from '$lib/software/SelectionBuilder.svelte';
  import { campaignOwners } from '$lib/software/selection';
  import { restconfPatchJson } from '$lib/core/restconf/client';
  import {
    DATA_ROOT,
    DEFAULT_MAX_RATE,
    DEFAULT_TARGET_RATE,
    campaignCreatePatch,
    type Campaign,
    type Device
  ,
    type Schedule
  } from '$lib/software/model';
  import { formatDuration, formatLocalTime } from '$lib/software/time';

  let {
    data
  }: {
    data: {
      devices: Device[];
      campaigns: Campaign[];
      schedules: Schedule[];
      loadError: string;
    };
  } = $props();


  let name = $state('');
  let targetRelease = $state('');
  let imageUrl = $state('');
  let allowStaging = $state(false);
  let members = $state<string[]>([]);
  let defaultSchedule = $state('');
  let deadline = $state('');
  let targetRate = $state('');
  let maxRate = $state('');
  let nextWindowId = 0;

  function scheduleRules(s: Schedule): string {
    if (s.windows.length === 0) return 'no windows';
    return s.windows
      .map(
        (w) =>
          `${w.days.length > 0 ? w.days.join(',') + ' ' : 'daily '}${formatLocalTime(w.at, s.utcOffset)} for ${formatDuration(w.duration)}`
      )
      .join(' · ');
  }

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
    const starts = new Set<number>();
    if (deadline.trim()) {
      const d = Date.parse(deadline);
      if (Number.isNaN(d)) {
        e['deadline'] = 'A date and time.';
      } else if (d <= Date.now()) {
        e['deadline'] = 'The deadline is in the past.';
      }
    }
    for (const [key, text] of [
      ['target-rate', targetRate],
      ['max-rate', maxRate]
    ] as const) {
      if (text.trim() && !/^\d+$/.test(text.trim())) {
        e[key] = 'A whole number of devices per hour.';
      }
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
        campaignCreatePatch({
          name: campaign,
          targetRelease,
          imageUrl,
          devices: members,
          allowStaging,
          defaultSchedule: defaultSchedule || undefined,
          deadline: deadline.trim() ? Math.floor(Date.parse(deadline) / 1000) : null,
          targetRate: targetRate.trim() ? Number(targetRate) : null,
          maxRate: maxRate.trim() ? Number(maxRate) : null
        })
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
      Created in plan: declared and inspectable, doing nothing until you run it.
      The plan shows how the members fit the windows before anything is actuated.
    </p>
  </div>
</div>

{#if statusMessage}
  <div class="error-state status">{statusMessage}</div>
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
        {validationKey}
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
        {validationKey}
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
      {validationKey}
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
    <label class="field">
      <span class="field-label">Default schedule</span>
      <select class="input" bind:value={defaultSchedule} onchange={() => (touched = true)}>
        <option value="">none — one always-open window</option>
        {#each data.schedules as s (s.name)}
          <option value={s.name}>{s.name} — {scheduleRules(s)}</option>
        {/each}
      </select>
    </label>
    <div class="grid-3">
      <label class="field">
        <span class="field-label">Deadline</span>
        <input
          class="input mono"
          type="datetime-local"
          bind:value={deadline}
          onchange={() => (touched = true)}
        />
        {#if visibleErrors['deadline']}
          <span class="field-error">{visibleErrors['deadline']}</span>
        {/if}
      </label>
      <FieldText
        label="Target rate"
        value={targetRate}
        error={visibleErrors['target-rate']}
        {validationKey}
        yangType="uint32"
        mono={true}
        placeholder={`${DEFAULT_TARGET_RATE}`}
        help="Devices per hour. The planner goes faster only when the deadline needs it; 0 = no preference."
        onchange={(v) => (targetRate = v)}
        ontouch={() => (touched = true)}
      />
      <FieldText
        label="Max rate"
        value={maxRate}
        error={visibleErrors['max-rate']}
        {validationKey}
        yangType="uint32"
        mono={true}
        placeholder={`${DEFAULT_MAX_RATE}`}
        help="Hard cap in devices per hour. A deadline that needs more raises an alarm; 0 = no cap."
        onchange={(v) => (maxRate = v)}
        ontouch={() => (touched = true)}
      />
    </div>
    <p class="note">Devices that do not fit the windows are not actuated and show as plan alarms.</p>
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

  .grid-3 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }



  .note {
    margin: 0;
    font-size: 12px;
    color: var(--sw-text-muted);
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
