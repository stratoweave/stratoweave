<script lang="ts">
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { onLoaded } from '#lib/core/loading.svelte.ts';
  import { restconfPatchJson } from '#lib/core/restconf/client.ts';
  import FieldText from '#lib/core/ui/FieldText.svelte';
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import Section from '#lib/core/ui/Section.svelte';
  import Steps from '#lib/core/ui/Steps.svelte';
  import { memberImages, modelGroups, targetCounts, withPreselected } from '#lib/software/campaign-images.ts';
  import { DATA_ROOT, campaignCreatePatch, validateNewCampaign, type Device } from '#lib/software/model.ts';
  import ModelImages from '#lib/software/ModelImages.svelte';
  import SelectionBuilder from '#lib/software/SelectionBuilder.svelte';
  import { campaignOwners, emptySelection, type Selection } from '#lib/software/selection.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  // null until the reads are in.
  let inventory = $state.raw<Awaited<typeof data.inventory> | null>(null);
  onLoaded(() => data.inventory, (value) => (inventory = value));
  let devices = $derived(inventory?.devices ?? []);
  let campaigns = $derived(inventory?.campaigns ?? []);
  let images = $derived(inventory?.images ?? []);

  // The third step is the campaign's own page, which shows its plan.
  const STEPS = ['Devices', 'Images', 'Plan'];

  let step = $state(1);
  /** The first card of the step shown. */
  let stepCard: HTMLElement | undefined = $state();
  // Held here, so that Back to the devices finds the filters as they were.
  let selection = $state<Selection>(emptySelection());
  let selected = $state<string[]>([]);
  // model -> image name, kept across Back and Next.
  let picks = $state<Record<string, string>>({});
  let name = $state('');
  let allowStaging = $state(false);
  // A device that runs its image already has nothing to install; one on a
  // newer release would be downgraded, which can be what is wanted.
  let leaveOnTarget = $state(true);
  let leaveNewer = $state(false);

  let devicesTouched = $state(false);
  let touched = $state(false);
  let creating = $state(false);
  let createError = $state('');

  let owners = $derived(campaignOwners(campaigns));
  let scheduleNames = $derived((inventory?.schedules ?? []).map((s) => s.name));
  let byName = $derived(new Map(devices.map((d) => [d.name, d])));
  let grouped = $derived(
    modelGroups(selected.map((n) => byName.get(n)).filter((d): d is Device => d !== undefined))
  );
  let counts = $derived(targetCounts(grouped.groups, picks, images));
  let members = $derived(
    memberImages(grouped.groups, picks, images, { onTarget: leaveOnTarget, newer: leaveNewer })
  );
  /** Every grouped device is left out: the campaign would have none. */
  let allLeftOut = $derived(grouped.groups.length > 0 && members.length === 0);
  let errors = $derived(
    validateNewCampaign({ name, devices: members }, campaigns.map((c) => c.name)).errors
  );

  function devicesText(n: number): string {
    return n === 1 ? '1 device' : `${n.toLocaleString()} devices`;
  }

  /** Next and Back replace the card that had focus: focus goes to the
   * new step's heading instead of falling back to the page. */
  async function show(next: number): Promise<void> {
    step = next;
    await tick();
    const heading = stepCard?.querySelector<HTMLElement>('h2');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }

  function toImages(): void {
    devicesTouched = true;
    if (selected.length === 0) return;
    picks = withPreselected(grouped.groups, picks, images);
    void show(2);
  }

  async function create(): Promise<void> {
    touched = true;
    if (Object.keys(errors).length > 0) return;
    try {
      creating = true;
      createError = '';
      const campaign = name.trim();
      await restconfPatchJson(DATA_ROOT, campaignCreatePatch({ name: campaign, devices: members, allowStaging }));
      await goto(`/campaigns/${encodeURIComponent(campaign)}`, { refreshAll: true });
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

{#if step === 1}
  <section class="card" bind:this={stepCard}>
    <Section title="Devices">
      {#if inventory === null}
        <div class="empty-state" aria-busy="true">Loading devices…</div>
      {:else if inventory.loadError}
        <LoadError message={inventory.loadError} />
      {:else if devices.length === 0}
        <div class="empty-state">No devices in the inventory.</div>
      {:else}
        <SelectionBuilder
          inventory={devices}
          {owners}
          schedules={scheduleNames}
          bind:selection
          error={devicesTouched && selected.length === 0 ? 'Select at least one device.' : ''}
          onchange={(names) => (selected = names)}
        />
      {/if}
      <div class="editor-actions">
        <a class="btn btn-secondary" href="/campaigns">Cancel</a>
        <button
          class="btn btn-primary"
          type="button"
          onclick={toImages}
          disabled={inventory === null || !!inventory.loadError}
        >
          Next: images ({devicesText(selected.length)})
        </button>
      </div>
    </Section>
  </section>
{:else}
  <section class="card" bind:this={stepCard}>
    <Section title="Images" yangPath="software:software/upgrade-campaign/device/image">
      {#if grouped.groups.length === 0}
        <div class="empty-state">None of the selected devices has reported a model.</div>
      {:else}
        <ModelImages
          groups={grouped.groups}
          leftOut={grouped.leftOut}
          {images}
          {picks}
          showErrors={touched}
          onpick={(model, image) => (picks = { ...picks, [model]: image })}
        />
        {#if counts.onTarget > 0 || counts.newer > 0}
          <div class="target-checks">
            {#if counts.onTarget > 0}
              <label class="check">
                <input type="checkbox" bind:checked={leaveOnTarget} />
                <span>
                  Leave out the {devicesText(counts.onTarget)} that already
                  {counts.onTarget === 1 ? 'runs its image' : 'run their image'}
                </span>
              </label>
            {/if}
            {#if counts.newer > 0}
              <p class="downgrade">
                {devicesText(counts.newer)}
                {counts.newer === 1 ? 'runs' : 'run'} a newer release than {counts.newer === 1 ? 'its' : 'their'} image:
                the campaign would downgrade {counts.newer === 1 ? 'it' : 'them'}.
              </p>
              <label class="check">
                <input type="checkbox" bind:checked={leaveNewer} />
                <span>Leave out the {devicesText(counts.newer)} on a newer release</span>
              </label>
            {/if}
            <p class="hint">Based on the release each device last reported.</p>
          </div>
        {/if}
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
          placeholder="e.g. xe-1718-emea"
          onchange={(v) => (name = v)}
          ontouch={() => (touched = true)}
        />
      </div>
      <div class="staging">
        <input id="allow-staging" type="checkbox" bind:checked={allowStaging} aria-describedby="staging-help" />
        <label for="allow-staging">Allow staging the image before the impacting step</label>
        <p class="hint" id="staging-help">Devices copy their image before their window opens, with no outage.</p>
      </div>
      <div>
        <!-- In place before any message, so that a screen reader reads it. -->
        <div role="alert">
          {#if createError}
            <div class="error-state status">{createError}</div>
          {/if}
        </div>
        <div class="editor-actions">
          <button class="btn btn-secondary" type="button" onclick={() => void show(1)}>Back</button>
          <button class="btn btn-primary" type="button" onclick={create} disabled={creating}>
            {creating ? 'Creating…' : `Create plan (${devicesText(members.length)})`}
          </button>
        </div>
      </div>
      {#if touched && allLeftOut}
        <p class="field__meta field__meta--error all-left-out">
          Every selected device is left out above, so the campaign would have none.
        </p>
      {/if}
    </Section>
  </section>
{/if}

<style>
  .name {
    max-width: 420px;
  }

  .target-checks {
    display: grid;
    gap: 8px;
    margin-top: 14px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--sw-text-sm);
    cursor: pointer;
  }

  .downgrade {
    margin: 4px 0 0;
    font-size: var(--sw-text-sm);
    color: var(--sw-warning);
  }

  .hint {
    margin: 0;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
  }

  .all-left-out {
    text-align: right;
  }

  /* The help lines up with the label's text, past the box. */
  .staging {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 2px 8px;
    font-size: var(--sw-text-sm);
  }

  .staging label {
    cursor: pointer;
  }

  .staging .hint {
    grid-column: 2;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
