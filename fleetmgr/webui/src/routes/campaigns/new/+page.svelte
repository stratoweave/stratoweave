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
  } from '$lib/software/model';
  import { formatDuration, parseDuration } from '$lib/software/time';

  let {
    data
  }: {
    data: {
      devices: Device[];
      campaigns: Campaign[];
      loadError: string;
    };
  } = $props();

  interface WindowDraft {
    id: number;
    start: string;
    duration: string;
  }

  let name = $state('');
  let targetRelease = $state('');
  let imageUrl = $state('');
  let allowStaging = $state(false);
  let members = $state<string[]>([]);
  let windows = $state<WindowDraft[]>([]);
  let deadline = $state('');
  let targetRate = $state('');
  let maxRate = $state('');
  let nextWindowId = 0;

  let touched = $state(false);
  let validationKey = $state(0);
  let creating = $state(false);
  let statusMessage = $state<string>(untrack(() => data.loadError));

  function addWindow(): void {
    // A new window opens when the previous one closes.
    const last = windows[windows.length - 1];
    const lastEnd = last ? (parseDuration(last.start) ?? 0) + (parseDuration(last.duration) ?? 0) : 0;
    windows = [
      ...windows,
      {
        id: nextWindowId++,
        start: lastEnd > 0 ? formatDuration(lastEnd) : '0',
        duration: last?.duration ?? '1h'
      }
    ];
  }

  function removeWindow(id: number): void {
    windows = windows.filter((w) => w.id !== id);
  }

  function patchWindow(id: number, partial: Partial<WindowDraft>): void {
    windows = windows.map((w) => (w.id === id ? { ...w, ...partial } : w));
  }

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
    for (const w of windows) {
      const start = parseDuration(w.start);
      const duration = parseDuration(w.duration);
      if (start === null) {
        e[`window-${w.id}-start`] = 'An offset like 0, 30m or 2h.';
      } else if (starts.has(start)) {
        e[`window-${w.id}-start`] = 'Two windows open at the same offset.';
      } else {
        starts.add(start);
      }
      if (duration === null || duration === 0) {
        e[`window-${w.id}-duration`] = 'A duration like 30m or 2h.';
      }
    }
    if (deadline.trim()) {
      const d = parseDuration(deadline);
      if (d === null || d === 0) {
        e['deadline'] = 'An offset like 4h or 1d.';
      } else if (windows.length === 0) {
        // The planner only cuts windows at the deadline; with none, nothing is placed.
        e['deadline'] = 'A deadline needs at least one window.';
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
          windows: windows.map((w) => ({
            start: parseDuration(w.start) ?? 0,
            duration: parseDuration(w.duration) ?? 0
          })),
          deadline: deadline.trim() ? parseDuration(deadline) : null,
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
    description="Maintenance windows and pace. Offsets count from the moment the campaign is set to run."
    yangPath="software:software/upgrade-campaign/window"
  >
    {#if windows.length === 0}
      <p class="note">
        No windows: the planner uses one window sized for the target rate and places every
        device in it.
      </p>
    {/if}
    {#each windows as w (w.id)}
      <div class="window-row">
        <FieldText
          label="Opens after"
          required={true}
          value={w.start}
          error={visibleErrors[`window-${w.id}-start`]}
          {validationKey}
          yangType="uint32"
          mono={true}
          placeholder="0, 30m, 2h"
          onchange={(v) => patchWindow(w.id, { start: v })}
          ontouch={() => (touched = true)}
        />
        <FieldText
          label="Lasts"
          required={true}
          value={w.duration}
          error={visibleErrors[`window-${w.id}-duration`]}
          {validationKey}
          yangType="uint32"
          mono={true}
          placeholder="1h"
          onchange={(v) => patchWindow(w.id, { duration: v })}
          ontouch={() => (touched = true)}
        />
        <button
          class="btn btn-ghost btn-sm remove"
          type="button"
          aria-label="Remove window"
          onclick={() => removeWindow(w.id)}
        >
          ✕
        </button>
      </div>
    {/each}
    <div>
      <button class="btn btn-secondary btn-sm" type="button" onclick={addWindow}>Add window</button>
    </div>
    <div class="grid-3">
      <FieldText
        label="Deadline"
        value={deadline}
        error={visibleErrors['deadline']}
        {validationKey}
        yangType="uint32"
        mono={true}
        placeholder="none"
        help="Finish by this offset. Windows are cut at it and the needed rate is computed backwards from it."
        onchange={(v) => (deadline = v)}
        ontouch={() => (touched = true)}
      />
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

  .window-row {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto;
    gap: 12px;
    align-items: start;
  }

  .remove {
    /* Line up with the inputs under the field labels. */
    margin-top: 24px;
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
    border: 1px solid rgba(251, 191, 36, 0.28);
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
